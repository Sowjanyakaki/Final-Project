import { createMCPClient } from '@ai-sdk/mcp';

export type OsmNearbyResult = {
  items: Array<{ name: string; type: string; distanceMeters?: number }>;
  uncertain: boolean;
  note?: string;
};

type OsmNearbyInput = {
  lat: number;
  lng: number;
  category: string;
};

const TOOL_BY_CATEGORY: Record<string, string> = {
  transit: 'find_nearby_places',
  amenities: 'find_nearby_places',
  // analyze_commute needs a second (work) coordinate pair — this single-point
  // {lat,lng,category} interface has no way to supply one. Routing 'commute'
  // here is a known limitation (confirmed against the real MCP server's tool
  // signature), not a placeholder: the call below will not produce a
  // meaningful result until this tool's contract grows a second point.
  commute: 'analyze_commute',
  // find_schools_nearby is a dedicated, purpose-built tool on the real
  // server (schools/colleges/universities/kindergartens, filtered and
  // distance-sorted) — cleaner than the generic 'amenities' lookup, which
  // would mix schools in among restaurants, banks, etc.
  schools: 'find_schools_nearby',
  education: 'find_schools_nearby',
};

function resolveToolName(category: string): string {
  return TOOL_BY_CATEGORY[category] ?? 'analyze_neighborhood';
}

/**
 * OSM tag *keys* (not free-form words) that find_nearby_places groups
 * results by — confirmed against the real server (osm_mcp_server/server.py):
 * it checks `if category in tags` for each of these keys.
 */
function categoriesForFindNearbyPlaces(category: string): string[] {
  return category === 'transit'
    ? ['public_transport', 'railway', 'highway']
    : ['amenity', 'shop'];
}

function buildToolArgs(toolName: string, input: OsmNearbyInput): Record<string, unknown> {
  if (toolName === 'find_nearby_places') {
    return {
      latitude: input.lat,
      longitude: input.lng,
      categories: categoriesForFindNearbyPlaces(input.category),
    };
  }
  if (toolName === 'analyze_neighborhood' || toolName === 'find_schools_nearby') {
    return { latitude: input.lat, longitude: input.lng };
  }
  // analyze_commute (see note above) — best-effort single-point args; expect
  // this to come back uncertain until the tool contract supports two points.
  return { latitude: input.lat, longitude: input.lng, category: input.category };
}

type FindNearbyPlacesResult = {
  categories?: Record<string, Record<string, Array<{ name?: unknown }>>>;
};

/**
 * find_nearby_places's real response nests places two levels deep:
 * { categories: { amenity: { restaurant: [...places], cafe: [...] }, shop: {...} } }
 * — confirmed against the live server; there is no flat places/results array.
 */
function normalizeFindNearbyPlaces(raw: unknown): OsmNearbyResult['items'] {
  const categories = (raw as FindNearbyPlacesResult)?.categories;
  if (!categories || typeof categories !== 'object') return [];

  const items: OsmNearbyResult['items'] = [];
  for (const [categoryName, subcategories] of Object.entries(categories)) {
    if (!subcategories || typeof subcategories !== 'object') continue;
    for (const [subcategoryName, places] of Object.entries(subcategories)) {
      if (!Array.isArray(places)) continue;
      for (const place of places) {
        if (typeof place?.name === 'string') {
          items.push({ name: place.name, type: `${categoryName}/${subcategoryName}` });
        }
      }
    }
  }
  return items;
}

type AnalyzeNeighborhoodResult = {
  categories?: Record<string, { features?: Array<{ name?: unknown; distance?: unknown }> }>;
};

/**
 * analyze_neighborhood's real response (confirmed against the live server's
 * actual `return {...}` statement, not just its internal variable names —
 * the function's local `results` dict is returned under the key
 * "categories", one level shallower than find_nearby_places'
 * categories[tagKey][subcategory] nesting):
 * { location, scores: {...}, categories: { groceries: { count, features: [{name, distance, ...}], metrics }, restaurants: {...} } }
 */
function normalizeAnalyzeNeighborhood(raw: unknown): OsmNearbyResult['items'] {
  const categories = (raw as AnalyzeNeighborhoodResult)?.categories;
  if (!categories || typeof categories !== 'object') return [];

  const items: OsmNearbyResult['items'] = [];
  for (const [categoryName, categoryData] of Object.entries(categories)) {
    const features = categoryData?.features;
    if (!Array.isArray(features)) continue;
    for (const feature of features) {
      if (typeof feature?.name === 'string') {
        items.push({
          name: feature.name,
          type: categoryName,
          distanceMeters: typeof feature.distance === 'number' ? feature.distance : undefined,
        });
      }
    }
  }
  return items;
}

type FindSchoolsNearbyResult = {
  schools?: Array<{
    name?: unknown;
    amenity_type?: unknown;
    school_type?: unknown;
    distance?: unknown;
  }>;
};

/**
 * find_schools_nearby's real response (confirmed against the live server's
 * actual return statement): a flat `schools` array, not the nested
 * categories[tagKey][subcategory] shape find_nearby_places uses. Real OSM
 * data frequently leaves `school_type` ("" per the server's own
 * `tags.get("school", "")`) empty — falls back to `amenity_type`, which the
 * query always populates since that's the OSM tag being searched on
 * (school/university/kindergarten/college).
 */
function normalizeFindSchoolsNearby(raw: unknown): OsmNearbyResult['items'] {
  const schools = (raw as FindSchoolsNearbyResult)?.schools;
  if (!Array.isArray(schools)) return [];

  const items: OsmNearbyResult['items'] = [];
  for (const school of schools) {
    if (typeof school?.name !== 'string') continue;
    const kind = (typeof school.school_type === 'string' && school.school_type) || school.amenity_type || 'school';
    items.push({
      name: school.name,
      type: `school/${kind}`,
      distanceMeters: typeof school.distance === 'number' ? school.distance : undefined,
    });
  }
  return items;
}

type ToolResultEnvelope = {
  content?: Array<{ type?: unknown; text?: unknown }>;
  structuredContent?: { result?: unknown };
  isError?: unknown;
};

/**
 * The AI SDK's MCP client returns the raw MCP `CallToolResult` envelope from
 * `tool.execute()` — {content, structuredContent, isError} — not the tool's
 * payload directly (confirmed against the live server: find_nearby_places'
 * actual payload sits at `structuredContent.result`, with a JSON-stringified
 * copy also in `content[0].text`). Unwrap to that payload before normalizing.
 * Already-unwrapped inputs (e.g. plain objects in unit tests) pass through
 * unchanged, since neither `structuredContent` nor a text `content` part
 * exists on them.
 */
function unwrapToolResult(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const envelope = raw as ToolResultEnvelope;
  if (envelope.isError) return null;

  if (envelope.structuredContent && typeof envelope.structuredContent === 'object' && 'result' in envelope.structuredContent) {
    return envelope.structuredContent.result;
  }

  const textPart = envelope.content?.find((part) => part?.type === 'text' && typeof part.text === 'string');
  if (textPart && typeof textPart.text === 'string') {
    try {
      return JSON.parse(textPart.text);
    } catch {
      return null;
    }
  }

  return raw;
}

function normalizeRawResult(toolName: string, raw: unknown): OsmNearbyResult['items'] {
  const unwrapped = unwrapToolResult(raw);
  if (!unwrapped || typeof unwrapped !== 'object') return [];
  if (toolName === 'find_nearby_places') return normalizeFindNearbyPlaces(unwrapped);
  if (toolName === 'analyze_neighborhood') return normalizeAnalyzeNeighborhood(unwrapped);
  if (toolName === 'find_schools_nearby') return normalizeFindSchoolsNearby(unwrapped);
  return [];
}

type OsmToolMap = Record<string, { execute?: (args: unknown, options: unknown) => Promise<unknown> }>;

// The real OSM MCP server proxies to the public Overpass API, which is slow
// (~3-4s per query, confirmed live) and doesn't reliably scale with
// concurrent requests — 12 "parallel" lookups for one Explore-screen page
// load still took ~34s live, and a probe request once failed to connect to
// overpass-api.de outright. Caching by rounded coordinate + category means
// a repeat lookup (routine here: GET /api/shortlist re-resolves the same
// handful of listings' locations on every page load) doesn't re-pay that
// cost. Deliberately NOT caching uncertain/failed results, so a transient
// upstream failure is retried rather than "stuck" for the TTL.
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { result: OsmNearbyResult; expiresAt: number }>();

function cacheKey(input: OsmNearbyInput): string {
  return `${input.lat.toFixed(4)},${input.lng.toFixed(4)},${input.category}`;
}

function getCached(input: OsmNearbyInput): OsmNearbyResult | undefined {
  const key = cacheKey(input);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

function setCached(input: OsmNearbyInput, result: OsmNearbyResult): void {
  cache.set(cacheKey(input), { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test-only: clears the module-level OSM result cache between test cases. */
export function __clearOsmCacheForTests(): void {
  cache.clear();
}

async function runQuery(tools: OsmToolMap, input: OsmNearbyInput): Promise<OsmNearbyResult> {
  const toolName = resolveToolName(input.category);
  const tool = tools[toolName];

  if (!tool || typeof tool.execute !== 'function') {
    return {
      items: [],
      uncertain: true,
      note: `OSM MCP server does not expose the "${toolName}" tool`,
    };
  }

  const raw = await tool.execute(buildToolArgs(toolName, input), {
    toolCallId: `osmNearby-${toolName}`,
    messages: [],
  });
  const items = normalizeRawResult(toolName, raw);

  if (items.length === 0) {
    return {
      items: [],
      uncertain: true,
      note: `No ${input.category} data available near this location`,
    };
  }

  return { items, uncertain: false };
}

export interface OsmSession {
  query(input: OsmNearbyInput): Promise<OsmNearbyResult>;
  close(): Promise<void>;
}

const NOOP_SESSION_NOTE = (note: string): OsmSession => ({
  query: async () => ({ items: [], uncertain: true, note }),
  close: async () => {},
});

/**
 * Opens one MCP connection and discovers its tools once, so a caller making
 * several lookups (e.g. transit + amenities for several listings) doesn't
 * pay a fresh connect+handshake+tool-discovery round trip per lookup.
 * Confirmed live: a single osmNearby()-style call costs ~4s just to connect
 * and discover tools before the actual query even runs — with up to 12 such
 * lookups on one Explore-screen page load, that overhead alone dominated
 * page load time (observed 8s–65s). Reusing one session cuts that to a
 * single connect+discover for the whole page load.
 *
 * Never throws: a missing URL or a failed connection both return a session
 * whose `query()` always resolves `{ uncertain: true, note }` instead of
 * rejecting, so callers don't need a try/catch around every lookup.
 */
export async function openOsmSession(): Promise<OsmSession> {
  const url = process.env.OSM_MCP_URL;
  if (!url) {
    return NOOP_SESSION_NOTE('OSM_MCP_URL is not configured');
  }

  let client: Awaited<ReturnType<typeof createMCPClient>>;
  let tools: OsmToolMap;
  try {
    client = await createMCPClient({
      transport: { type: 'http', url: `${url.replace(/\/$/, '')}/mcp` },
    });
    tools = (await client.tools()) as unknown as OsmToolMap;
  } catch (error) {
    return NOOP_SESSION_NOTE(`OSM MCP lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    query: async (input) => {
      const cached = getCached(input);
      if (cached) return cached;

      const result = await runQuery(tools, input).catch((error) => ({
        items: [],
        uncertain: true as const,
        note: `OSM MCP lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      }));
      if (!result.uncertain) setCached(input, result);
      return result;
    },
    close: () => client.close().catch(() => {}),
  };
}

/**
 * Wraps the OpenStreetMap MCP server (connected over streamable HTTP at
 * `/mcp` — see docs/ARCHITECTURE.md §3.2a) as a single normalized lookup.
 * Never throws: any missing config, missing tool, empty result, or upstream
 * failure comes back as `{ items: [], uncertain: true, note }` so the
 * agent's system prompt can enforce "state uncertainty, never guess"
 * without a try/catch at every call site.
 *
 * The deployed fork (D:\NextLeap\OpenStreetMap_MCP, __init__.py) runs the
 * official `mcp` Python SDK's FastMCP with `transport="streamable-http"`
 * when Railway's PORT env var is present — not SSE behind a supergateway/
 * mcp-proxy bridge as originally planned. Confirmed live: a bare SSE
 * connection to the URL's root 404s; a streamable-HTTP POST to `/mcp`
 * returns a real `initialize` response.
 *
 * For a single one-off lookup (e.g. the orchestrator's per-turn tool call).
 * Making several lookups in one request (e.g. the shortlist route)? Use
 * `openOsmSession()` instead to avoid paying connect+discover per lookup.
 */
export async function osmNearby(input: OsmNearbyInput): Promise<OsmNearbyResult> {
  // Checked here too (session.query() also checks it) so a cached result
  // skips opening a connection at all, not just the query itself.
  const cached = getCached(input);
  if (cached) return cached;

  const session = await openOsmSession();
  try {
    return await session.query(input);
  } finally {
    await session.close();
  }
}
