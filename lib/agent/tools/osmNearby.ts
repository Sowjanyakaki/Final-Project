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
  if (toolName === 'analyze_neighborhood') {
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
  return [];
}

/**
 * Wraps the OpenStreetMap MCP server (connected over SSE — see
 * docs/ARCHITECTURE.md §3.2a) as a single normalized lookup. Never throws:
 * any missing config, missing tool, empty result, or upstream failure comes
 * back as `{ items: [], uncertain: true, note }` so the agent's system
 * prompt can enforce "state uncertainty, never guess" without a try/catch
 * at every call site.
 */
export async function osmNearby(input: OsmNearbyInput): Promise<OsmNearbyResult> {
  const url = process.env.OSM_MCP_URL;
  if (!url) {
    return { items: [], uncertain: true, note: 'OSM_MCP_URL is not configured' };
  }

  let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
  try {
    client = await createMCPClient({
      transport: { type: 'sse', url },
    });

    const tools = await client.tools();
    const toolName = resolveToolName(input.category);
    const tool = (
      tools as unknown as Record<string, { execute?: (args: unknown, options: unknown) => Promise<unknown> }>
    )[toolName];

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
  } catch (error) {
    return {
      items: [],
      uncertain: true,
      note: `OSM MCP lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}
