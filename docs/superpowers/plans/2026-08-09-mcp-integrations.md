# MCP Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two MCP/REST-wrapping tool functions the agent will use — `osmNearby` (OpenStreetMap MCP over SSE) and the Booking MCP family (`listBookingSlots`, `createBookingHold`, `cancelBookingHold`, `rescheduleBookingHold`) — as pure, independently-testable async functions with clean input/output contracts.

**Architecture:** Each tool lives in its own file under `lib/agent/tools/`, has no dependency on the agent loop or any framework request/response object, and can be imported and registered as an AI SDK tool by the (separately planned) orchestration-agent subsystem. `osmNearby` talks to the OSM MCP server via the AI SDK's MCP client over SSE transport (per `docs/ARCHITECTURE.md` §3.2a — the upstream server only speaks stdio, so it's bridged to SSE at deploy time; the app always connects over SSE). The Booking MCP tools are plain authenticated `fetch` calls to a REST API (per `docs/ARCHITECTURE.md` §3.5a). Every external call (MCP client, `fetch`) is mocked at the module boundary in tests, so `npm test` requires no live credentials or network access.

**Tech Stack:** TypeScript, Vitest, AI SDK (`experimental_createMCPClient`, SSE transport), native `fetch`, Node's `node:crypto`.

## Global Constraints

- Testing: Vitest for all tests (per `docs/ARCHITECTURE.md` §1) — external calls (MCP client, `fetch`) are mocked at the module boundary; `npm test` must be runnable with zero live credentials/network.
- Env vars already exist in `.env.local.example` from the prior scaffold plan: `OSM_MCP_URL`, `BOOKING_MCP_URL`, `BOOKING_MCP_API_KEY`. This plan only reads them via `process.env` — it does not introduce new env vars.
- OSM MCP transport is SSE, decided (`docs/ARCHITECTURE.md` §3.2a): `experimental_createMCPClient({ transport: { type: 'sse', url: OSM_MCP_URL } })`. Never implement or assume a stdio transport in application code — that lives in the separate forked-repo bridge, out of scope here.
- Booking MCP auth (`docs/ARCHITECTURE.md` §3.5a): every request carries header `X-API-Key: process.env.BOOKING_MCP_API_KEY` and `Content-Type: application/json`.
- Booking MCP endpoint contracts, verbatim from §3.5a: `POST /list_slots {dayPreference, timePreference}` → `{slots: [{id, startIso, label}]}`; `POST /create_hold {topic, code, slot}` → `{holdId, status}`; `POST /cancel_hold {code}`; `POST /reschedule_hold {code, newSlot}`.
- Uncertainty must be explicit, never guessed: if `osmNearby`'s upstream call fails or returns nothing, it must return a structured `{items: [], uncertain: true, note}` result — it must never throw for that case and never return an empty result that looks confident.
- No PII: none of these tool functions read, forward, or log owner/agent contact fields. Not directly exercised by this subsystem's data, but keep any free-text fields (e.g. `topic`) limited to listing/locality info, never renter or owner contact details.
- TypeScript strict mode is assumed already configured by the scaffold plan; all new files must type-check under it.
- File paths below use `/`; on Windows this is still correct inside TS/JS source and Vitest config — only shell commands need Windows-native path syntax.

---

## File Structure

```
lib/agent/tools/
├── osmNearby.ts               # OSM MCP wrapper (SSE transport) — Task 1
├── osmNearby.test.ts
├── requireEnv.ts               # shared "read required env var or throw" helper — Task 2
├── requireEnv.test.ts
├── types.ts                    # shared BookingSlot type — Task 2
├── listBookingSlots.ts         # Booking MCP: POST /list_slots — Task 3
├── listBookingSlots.test.ts
├── createBookingHold.ts        # Booking MCP: POST /create_hold — Task 4
├── createBookingHold.test.ts
├── cancelBookingHold.ts        # Booking MCP: POST /cancel_hold — Task 5
├── cancelBookingHold.test.ts
├── rescheduleBookingHold.ts    # Booking MCP: POST /reschedule_hold — Task 6
└── rescheduleBookingHold.test.ts
```

`BookingSlot` is defined once in `types.ts` and imported everywhere it's needed (`listBookingSlots.ts`, `createBookingHold.ts`, `rescheduleBookingHold.ts`) — no file redefines or re-exports its own copy. `requireEnv.ts` centralizes the "env var must exist or throw a clear error" logic so all four Booking MCP tools share one implementation instead of four copies.

---

### Task 1: `osmNearby` — OpenStreetMap MCP wrapper (SSE transport)

**Files:**
- Create: `lib/agent/tools/osmNearby.ts`
- Test: `lib/agent/tools/osmNearby.test.ts`

**Interfaces:**
- Consumes: `process.env.OSM_MCP_URL`; the AI SDK's `experimental_createMCPClient` export from the `ai` package.
- Produces: `export async function osmNearby(input: { lat: number; lng: number; category: string }): Promise<OsmNearbyResult>` and `export type OsmNearbyResult = { items: Array<{ name: string; type: string; distanceMeters?: number }>; uncertain: boolean; note?: string }`. The orchestration-agent subsystem will import both from `lib/agent/tools/osmNearby`.

**Before writing code — verify the AI SDK export name in this project's installed version:**

```bash
node -e "console.log(Object.keys(require('ai')).filter(k => k.toLowerCase().includes('mcp')))"
```

If this prints `experimental_createMCPClient`, use the import shown in Step 3 below unmodified. If it instead prints nothing (newer AI SDK versions moved MCP client creation to the separate `@ai-sdk/mcp` package as `createMCPClient`), replace the import line in Step 3 with:

```ts
import { createMCPClient as experimental_createMCPClient } from '@ai-sdk/mcp';
```

...and add `@ai-sdk/mcp` to `package.json` dependencies (`npm install @ai-sdk/mcp`) before running the tests. Everything else in this task — the SSE transport shape, the `tools()`/`execute()` interface, the test mocks — is identical either way, since both exports share the same `{ transport: { type: 'sse', url } }` config shape and the same `tools()` → `execute(args, options)` interface. The rest of this task assumes the `ai` export exists; adjust only the one import line if it doesn't.

- [ ] **Step 1: Write the failing test file**

Create `lib/agent/tools/osmNearby.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { experimental_createMCPClient } from 'ai';
import { osmNearby } from './osmNearby';

vi.mock('ai', () => ({
  experimental_createMCPClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(experimental_createMCPClient);

describe('osmNearby', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OSM_MCP_URL = 'https://osm-mcp.example.com/sse';
  });

  it('calls find_nearby_places for an "amenities" category and returns normalized items', async () => {
    const executeFindNearby = vi.fn().mockResolvedValue({
      places: [
        { name: 'Forum Mall', category: 'shopping', distance_m: 450 },
        { name: 'Apollo Pharmacy', category: 'pharmacy', distance_m: 120 },
      ],
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        find_nearby_places: { execute: executeFindNearby },
        analyze_commute: { execute: vi.fn() },
        analyze_neighborhood: { execute: vi.fn() },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(result).toEqual({
      items: [
        { name: 'Forum Mall', type: 'shopping', distanceMeters: 450 },
        { name: 'Apollo Pharmacy', type: 'pharmacy', distanceMeters: 120 },
      ],
      uncertain: false,
    });
    expect(executeFindNearby).toHaveBeenCalledTimes(1);
  });

  it('calls find_nearby_places for a "transit" category and marks uncertain on an empty result set', async () => {
    const executeFindNearby = vi.fn().mockResolvedValue({ places: [] });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        find_nearby_places: { execute: executeFindNearby },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'transit' });

    expect(result).toEqual({
      items: [],
      uncertain: true,
      note: 'No transit data available near this location',
    });
    expect(executeFindNearby).toHaveBeenCalledTimes(1);
  });

  it('calls analyze_commute for a "commute" category and marks uncertain (never throws) when the call rejects', async () => {
    const executeAnalyzeCommute = vi.fn().mockRejectedValue(new Error('upstream timeout'));
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        analyze_commute: { execute: executeAnalyzeCommute },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'commute' });

    expect(result.items).toEqual([]);
    expect(result.uncertain).toBe(true);
    expect(result.note).toContain('upstream timeout');
    expect(executeAnalyzeCommute).toHaveBeenCalledTimes(1);
  });

  it('calls analyze_neighborhood for any other category (general livability)', async () => {
    const executeAnalyzeNeighborhood = vi.fn().mockResolvedValue({
      points: [{ name: 'Koramangala 5th Block', type: 'residential_area' }],
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        analyze_neighborhood: { execute: executeAnalyzeNeighborhood },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'livability' });

    expect(result.uncertain).toBe(false);
    expect(result.items).toEqual([{ name: 'Koramangala 5th Block', type: 'residential_area', distanceMeters: undefined }]);
    expect(executeAnalyzeNeighborhood).toHaveBeenCalledTimes(1);
  });

  it('returns uncertain when OSM_MCP_URL is not configured, without throwing', async () => {
    delete process.env.OSM_MCP_URL;

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(result.uncertain).toBe(true);
    expect(result.items).toEqual([]);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/agent/tools/osmNearby.test.ts`
Expected: FAIL — `Cannot find module './osmNearby'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/agent/tools/osmNearby.ts`:

```ts
import { experimental_createMCPClient } from 'ai';

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

type RawPlace = {
  name?: unknown;
  type?: unknown;
  category?: unknown;
  distance_m?: unknown;
};

const TOOL_BY_CATEGORY: Record<string, string> = {
  transit: 'find_nearby_places',
  amenities: 'find_nearby_places',
  commute: 'analyze_commute',
};

function resolveToolName(category: string): string {
  return TOOL_BY_CATEGORY[category] ?? 'analyze_neighborhood';
}

function buildToolArgs(input: OsmNearbyInput): Record<string, unknown> {
  return {
    latitude: input.lat,
    longitude: input.lng,
    category: input.category,
  };
}

function normalizeRawResult(raw: unknown): OsmNearbyResult['items'] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const list =
    (Array.isArray(obj.places) && obj.places) ||
    (Array.isArray(obj.points) && obj.points) ||
    (Array.isArray(obj.results) && obj.results) ||
    [];

  return (list as RawPlace[])
    .filter((p): p is RawPlace & { name: string } => typeof p?.name === 'string')
    .map((p) => ({
      name: p.name,
      type: typeof p.type === 'string' ? p.type : typeof p.category === 'string' ? p.category : 'unknown',
      distanceMeters: typeof p.distance_m === 'number' ? p.distance_m : undefined,
    }));
}

export async function osmNearby(input: OsmNearbyInput): Promise<OsmNearbyResult> {
  const url = process.env.OSM_MCP_URL;
  if (!url) {
    return { items: [], uncertain: true, note: 'OSM_MCP_URL is not configured' };
  }

  let client: Awaited<ReturnType<typeof experimental_createMCPClient>> | undefined;
  try {
    client = await experimental_createMCPClient({
      transport: { type: 'sse', url },
    });

    const tools = await client.tools();
    const toolName = resolveToolName(input.category);
    const tool = (tools as Record<string, { execute?: (args: unknown, options: unknown) => Promise<unknown> }>)[
      toolName
    ];

    if (!tool || typeof tool.execute !== 'function') {
      return {
        items: [],
        uncertain: true,
        note: `OSM MCP server does not expose the "${toolName}" tool`,
      };
    }

    const raw = await tool.execute(buildToolArgs(input), {
      toolCallId: `osmNearby-${toolName}`,
      messages: [],
    });
    const items = normalizeRawResult(raw);

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/agent/tools/osmNearby.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/osmNearby.ts lib/agent/tools/osmNearby.test.ts
git commit -m "feat: add osmNearby MCP tool wrapper with uncertainty handling"
```

---

### Task 2: Shared `BookingSlot` type and `requireEnv` helper

**Files:**
- Create: `lib/agent/tools/types.ts`
- Create: `lib/agent/tools/requireEnv.ts`
- Test: `lib/agent/tools/requireEnv.test.ts`

**Interfaces:**
- Consumes: nothing external.
- Produces: `export type BookingSlot = { id: string; startIso: string; label: string }` from `lib/agent/tools/types`; `export function requireEnv(name: string): string` from `lib/agent/tools/requireEnv` (throws `Error("<name> is not configured")` if the env var is unset or empty). Tasks 3–6 import both.

`types.ts` holds only a type declaration, which is erased at compile time — there is nothing to unit test in that file, so this task's test coverage is for `requireEnv.ts` only.

- [ ] **Step 1: Write the failing test for `requireEnv`**

Create `lib/agent/tools/requireEnv.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { requireEnv } from './requireEnv';

describe('requireEnv', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the value when the env var is set', () => {
    process.env.SOME_TEST_VAR = 'hello';
    expect(requireEnv('SOME_TEST_VAR')).toBe('hello');
  });

  it('throws a clear error when the env var is missing', () => {
    delete process.env.SOME_TEST_VAR;
    expect(() => requireEnv('SOME_TEST_VAR')).toThrow('SOME_TEST_VAR is not configured');
  });

  it('throws when the env var is set but empty', () => {
    process.env.SOME_TEST_VAR = '';
    expect(() => requireEnv('SOME_TEST_VAR')).toThrow('SOME_TEST_VAR is not configured');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/agent/tools/requireEnv.test.ts`
Expected: FAIL — `Cannot find module './requireEnv'`.

- [ ] **Step 3: Write the implementation**

Create `lib/agent/tools/types.ts`:

```ts
export type BookingSlot = {
  id: string;
  startIso: string;
  label: string;
};
```

Create `lib/agent/tools/requireEnv.ts`:

```ts
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/agent/tools/requireEnv.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/types.ts lib/agent/tools/requireEnv.ts lib/agent/tools/requireEnv.test.ts
git commit -m "feat: add shared BookingSlot type and requireEnv helper for Booking MCP tools"
```

---

### Task 3: `listBookingSlots` — Booking MCP `POST /list_slots`

**Files:**
- Create: `lib/agent/tools/listBookingSlots.ts`
- Test: `lib/agent/tools/listBookingSlots.test.ts`

**Interfaces:**
- Consumes: `requireEnv` from `./requireEnv`; `BookingSlot` from `./types`; global `fetch`; `process.env.BOOKING_MCP_URL`, `process.env.BOOKING_MCP_API_KEY`.
- Produces: `export async function listBookingSlots(input: { dayPreference: string; timePreference: string }): Promise<{ slots: BookingSlot[] }>` from `lib/agent/tools/listBookingSlots`. Task 4 and the orchestration-agent subsystem both consume the `BookingSlot` shape this returns.

- [ ] **Step 1: Write the failing test file**

Create `lib/agent/tools/listBookingSlots.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listBookingSlots } from './listBookingSlots';

describe('listBookingSlots', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.BOOKING_MCP_URL = 'https://booking-mcp.example.com';
    process.env.BOOKING_MCP_API_KEY = 'test-api-key';
  });

  it('returns slots on a successful 2-slot response', async () => {
    const slots = [
      { id: 'slot-1', startIso: '2026-08-12T10:00:00+05:30', label: 'Wed 10:00 AM' },
      { id: 'slot-2', startIso: '2026-08-12T15:00:00+05:30', label: 'Wed 3:00 PM' },
    ];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ slots }),
    } as Response);

    const result = await listBookingSlots({ dayPreference: 'wednesday', timePreference: 'morning' });

    expect(result).toEqual({ slots });
    expect(fetch).toHaveBeenCalledWith(
      'https://booking-mcp.example.com/list_slots',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ dayPreference: 'wednesday', timePreference: 'morning' }),
      }),
    );
  });

  it('returns an empty slots array when there is no availability', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ slots: [] }),
    } as Response);

    const result = await listBookingSlots({ dayPreference: 'sunday', timePreference: 'evening' });

    expect(result).toEqual({ slots: [] });
  });

  it('throws a clear error on a non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'calendar backend unavailable',
    } as Response);

    await expect(
      listBookingSlots({ dayPreference: 'wednesday', timePreference: 'morning' }),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/agent/tools/listBookingSlots.test.ts`
Expected: FAIL — `Cannot find module './listBookingSlots'`.

- [ ] **Step 3: Write the implementation**

Create `lib/agent/tools/listBookingSlots.ts`:

```ts
import { requireEnv } from './requireEnv';
import type { BookingSlot } from './types';

type ListBookingSlotsInput = {
  dayPreference: string;
  timePreference: string;
};

type ListBookingSlotsOutput = {
  slots: BookingSlot[];
};

export async function listBookingSlots(
  input: ListBookingSlotsInput,
): Promise<ListBookingSlotsOutput> {
  const baseUrl = requireEnv('BOOKING_MCP_URL');
  const apiKey = requireEnv('BOOKING_MCP_API_KEY');

  const response = await fetch(`${baseUrl}/list_slots`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Booking MCP list_slots failed with status ${response.status}: ${bodyText || response.statusText}`,
    );
  }

  const data = (await response.json()) as { slots?: BookingSlot[] };
  return { slots: Array.isArray(data.slots) ? data.slots : [] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/agent/tools/listBookingSlots.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/listBookingSlots.ts lib/agent/tools/listBookingSlots.test.ts
git commit -m "feat: add listBookingSlots Booking MCP tool"
```

---

### Task 4: `createBookingHold` — Booking MCP `POST /create_hold`

**Files:**
- Create: `lib/agent/tools/createBookingHold.ts`
- Test: `lib/agent/tools/createBookingHold.test.ts`

**Interfaces:**
- Consumes: `requireEnv` from `./requireEnv`; `BookingSlot` from `./types` (produced by Task 2/3); global `fetch`; `randomBytes` from `node:crypto`.
- Produces: `export async function createBookingHold(input: { sessionId: string; listingId: string; topic: string; slot: BookingSlot }): Promise<{ confirmationCode: string; holdId: string; status: string }>` and `export function generateConfirmationCode(): string` from `lib/agent/tools/createBookingHold`. `input.sessionId` and `input.listingId` are accepted for the caller's own bookkeeping (e.g. writing a local `bookings` row) — per `docs/ARCHITECTURE.md` §3.5a the Booking MCP's `create_hold` request body is only `{topic, code, slot}`, so those two fields are never sent over the wire.
- This tool must run in a Node.js runtime (not Edge) because it uses `node:crypto` — the orchestration-agent subsystem's API route that calls it must not set `export const runtime = 'edge'`.

- [ ] **Step 1: Write the failing test file**

Create `lib/agent/tools/createBookingHold.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBookingHold } from './createBookingHold';
import type { BookingSlot } from './types';

const slot: BookingSlot = { id: 'slot-1', startIso: '2026-08-12T10:00:00+05:30', label: 'Wed 10:00 AM' };

describe('createBookingHold', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.BOOKING_MCP_URL = 'https://booking-mcp.example.com';
    process.env.BOOKING_MCP_API_KEY = 'test-api-key';
  });

  it('generates an NL-XXXX confirmation code and returns the hold details', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ holdId: 'hold-123', status: 'tentative' }),
    } as Response);

    const result = await createBookingHold({
      sessionId: 'session-1',
      listingId: 'listing-1',
      topic: 'Green Meadows, Koramangala',
      slot,
    });

    expect(result.confirmationCode).toMatch(/^NL-[0-9A-F]{4}$/);
    expect(result.holdId).toBe('hold-123');
    expect(result.status).toBe('tentative');

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://booking-mcp.example.com/create_hold');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual(
      expect.objectContaining({ 'X-API-Key': 'test-api-key', 'Content-Type': 'application/json' }),
    );
    expect(JSON.parse(options.body as string)).toEqual({
      topic: 'Green Meadows, Koramangala',
      code: result.confirmationCode,
      slot,
    });
  });

  it('throws when the Booking MCP rejects the hold as not approved (403)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'hold not approved',
    } as Response);

    await expect(
      createBookingHold({ sessionId: 's1', listingId: 'l1', topic: 'Test Society, Test Area', slot }),
    ).rejects.toThrow(/403/);
  });

  it('throws on a 500 error from the Booking MCP', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'calendar backend unavailable',
    } as Response);

    await expect(
      createBookingHold({ sessionId: 's1', listingId: 'l1', topic: 'Test Society, Test Area', slot }),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/agent/tools/createBookingHold.test.ts`
Expected: FAIL — `Cannot find module './createBookingHold'`.

- [ ] **Step 3: Write the implementation**

Create `lib/agent/tools/createBookingHold.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { requireEnv } from './requireEnv';
import type { BookingSlot } from './types';

type CreateBookingHoldInput = {
  sessionId: string;
  listingId: string;
  topic: string;
  slot: BookingSlot;
};

type CreateBookingHoldOutput = {
  confirmationCode: string;
  holdId: string;
  status: string;
};

export function generateConfirmationCode(): string {
  return `NL-${randomBytes(2).toString('hex').toUpperCase()}`;
}

export async function createBookingHold(
  input: CreateBookingHoldInput,
): Promise<CreateBookingHoldOutput> {
  const baseUrl = requireEnv('BOOKING_MCP_URL');
  const apiKey = requireEnv('BOOKING_MCP_API_KEY');
  const code = generateConfirmationCode();

  const response = await fetch(`${baseUrl}/create_hold`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ topic: input.topic, code, slot: input.slot }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Booking MCP create_hold failed with status ${response.status}: ${bodyText || response.statusText}`,
    );
  }

  const data = (await response.json()) as { holdId: string; status: string };
  return { confirmationCode: code, holdId: data.holdId, status: data.status };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/agent/tools/createBookingHold.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/createBookingHold.ts lib/agent/tools/createBookingHold.test.ts
git commit -m "feat: add createBookingHold Booking MCP tool with app-generated confirmation code"
```

---

### Task 5: `cancelBookingHold` — Booking MCP `POST /cancel_hold`

**Files:**
- Create: `lib/agent/tools/cancelBookingHold.ts`
- Test: `lib/agent/tools/cancelBookingHold.test.ts`

**Interfaces:**
- Consumes: `requireEnv` from `./requireEnv`; global `fetch`.
- Produces: `export async function cancelBookingHold(input: { code: string }): Promise<{ status: string }>` from `lib/agent/tools/cancelBookingHold`, for voice commands like "cancel my visit."

- [ ] **Step 1: Write the failing test file**

Create `lib/agent/tools/cancelBookingHold.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cancelBookingHold } from './cancelBookingHold';

describe('cancelBookingHold', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.BOOKING_MCP_URL = 'https://booking-mcp.example.com';
    process.env.BOOKING_MCP_API_KEY = 'test-api-key';
  });

  it('cancels a hold and returns its status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'cancelled' }),
    } as Response);

    const result = await cancelBookingHold({ code: 'NL-A742' });

    expect(result).toEqual({ status: 'cancelled' });
    expect(fetch).toHaveBeenCalledWith(
      'https://booking-mcp.example.com/cancel_hold',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ code: 'NL-A742' }),
      }),
    );
  });

  it('throws a clear error when the hold code is not found (404)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'hold not found',
    } as Response);

    await expect(cancelBookingHold({ code: 'NL-0000' })).rejects.toThrow(/404/);
  });

  it('throws on a 500 error from the Booking MCP', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'calendar backend unavailable',
    } as Response);

    await expect(cancelBookingHold({ code: 'NL-A742' })).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/agent/tools/cancelBookingHold.test.ts`
Expected: FAIL — `Cannot find module './cancelBookingHold'`.

- [ ] **Step 3: Write the implementation**

Create `lib/agent/tools/cancelBookingHold.ts`:

```ts
import { requireEnv } from './requireEnv';

type CancelBookingHoldInput = {
  code: string;
};

type CancelBookingHoldOutput = {
  status: string;
};

export async function cancelBookingHold(
  input: CancelBookingHoldInput,
): Promise<CancelBookingHoldOutput> {
  const baseUrl = requireEnv('BOOKING_MCP_URL');
  const apiKey = requireEnv('BOOKING_MCP_API_KEY');

  const response = await fetch(`${baseUrl}/cancel_hold`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: input.code }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Booking MCP cancel_hold failed with status ${response.status}: ${bodyText || response.statusText}`,
    );
  }

  const data = (await response.json()) as { status: string };
  return { status: data.status };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/agent/tools/cancelBookingHold.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/cancelBookingHold.ts lib/agent/tools/cancelBookingHold.test.ts
git commit -m "feat: add cancelBookingHold Booking MCP tool"
```

---

### Task 6: `rescheduleBookingHold` — Booking MCP `POST /reschedule_hold`

**Files:**
- Create: `lib/agent/tools/rescheduleBookingHold.ts`
- Test: `lib/agent/tools/rescheduleBookingHold.test.ts`

**Interfaces:**
- Consumes: `requireEnv` from `./requireEnv`; `BookingSlot` from `./types`; global `fetch`.
- Produces: `export async function rescheduleBookingHold(input: { code: string; newSlot: BookingSlot }): Promise<{ holdId: string; status: string }>` from `lib/agent/tools/rescheduleBookingHold`, for voice commands like "actually, move it to Wednesday."

- [ ] **Step 1: Write the failing test file**

Create `lib/agent/tools/rescheduleBookingHold.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rescheduleBookingHold } from './rescheduleBookingHold';
import type { BookingSlot } from './types';

const newSlot: BookingSlot = { id: 'slot-9', startIso: '2026-08-13T10:00:00+05:30', label: 'Thu 10:00 AM' };

describe('rescheduleBookingHold', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.BOOKING_MCP_URL = 'https://booking-mcp.example.com';
    process.env.BOOKING_MCP_API_KEY = 'test-api-key';
  });

  it('reschedules a hold and returns its holdId and status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ holdId: 'hold-123', status: 'tentative' }),
    } as Response);

    const result = await rescheduleBookingHold({ code: 'NL-A742', newSlot });

    expect(result).toEqual({ holdId: 'hold-123', status: 'tentative' });
    expect(fetch).toHaveBeenCalledWith(
      'https://booking-mcp.example.com/reschedule_hold',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ code: 'NL-A742', newSlot }),
      }),
    );
  });

  it('throws a clear error when the hold code is not found (404)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'hold not found',
    } as Response);

    await expect(rescheduleBookingHold({ code: 'NL-0000', newSlot })).rejects.toThrow(/404/);
  });

  it('throws on a 500 error from the Booking MCP', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'calendar backend unavailable',
    } as Response);

    await expect(rescheduleBookingHold({ code: 'NL-A742', newSlot })).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/agent/tools/rescheduleBookingHold.test.ts`
Expected: FAIL — `Cannot find module './rescheduleBookingHold'`.

- [ ] **Step 3: Write the implementation**

Create `lib/agent/tools/rescheduleBookingHold.ts`:

```ts
import { requireEnv } from './requireEnv';
import type { BookingSlot } from './types';

type RescheduleBookingHoldInput = {
  code: string;
  newSlot: BookingSlot;
};

type RescheduleBookingHoldOutput = {
  holdId: string;
  status: string;
};

export async function rescheduleBookingHold(
  input: RescheduleBookingHoldInput,
): Promise<RescheduleBookingHoldOutput> {
  const baseUrl = requireEnv('BOOKING_MCP_URL');
  const apiKey = requireEnv('BOOKING_MCP_API_KEY');

  const response = await fetch(`${baseUrl}/reschedule_hold`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: input.code, newSlot: input.newSlot }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Booking MCP reschedule_hold failed with status ${response.status}: ${bodyText || response.statusText}`,
    );
  }

  const data = (await response.json()) as { holdId: string; status: string };
  return { holdId: data.holdId, status: data.status };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/agent/tools/rescheduleBookingHold.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/rescheduleBookingHold.ts lib/agent/tools/rescheduleBookingHold.test.ts
git commit -m "feat: add rescheduleBookingHold Booking MCP tool"
```

---

## Final Verification

- [ ] Run the full suite for this subsystem: `npx vitest run lib/agent/tools`
Expected: PASS — 6 test files, no network calls made (all `fetch`/MCP client access is mocked), no env vars required to be real (tests set dummy `process.env` values themselves).
- [ ] Confirm no test in `lib/agent/tools/**` reaches out to a real network or requires a live `OSM_MCP_URL`/`BOOKING_MCP_URL`/`BOOKING_MCP_API_KEY` — grep for `vi.mock` / `vi.stubGlobal('fetch'` in each test file to confirm the boundary is mocked, matching `docs/ARCHITECTURE.md` §1's testing decision.
