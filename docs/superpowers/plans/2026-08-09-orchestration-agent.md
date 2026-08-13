# Orchestration / Agent Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the conversational agent core — the deterministic tool functions (`searchListings`, `retrieveNeighborhoodDocs`, `applyShortlistEdit`), the Groq-backed `streamText` orchestrator that wires them (plus the MCP-integration tools) together with a grounding-enforcing system prompt and tool-call logging, session bootstrap, and the three Next.js API routes that expose all of this to the companion UI.

**Architecture:** Three standalone, deterministic tool functions read/write Postgres via Drizzle (no LLM involved) and are unit-tested against a mocked `db`. `lib/agent/orchestrator.ts` registers those three tools plus three tools owned by the mcp-integrations subsystem (`osmNearby`, `listBookingSlots`, `createBookingHold`) into an AI SDK `streamText` call against Groq's `llama-3.3-70b-versatile`, wrapping every tool's `execute` in a logging higher-order function that writes to `toolCallLog`. `lib/agent/session.ts` gets-or-creates a `sessions` row keyed by a cookie id. Three route handlers (`/api/agent`, `/api/shortlist`, `/api/booking`) expose the conversation, the current shortlist, and the booking flow respectively.

**Tech Stack:** Next.js 15 App Router (route handlers), TypeScript, Drizzle ORM (Postgres/pgvector), AI SDK (`ai` package: `streamText`, `tool`), `@ai-sdk/groq` (model `llama-3.3-70b-versatile`), `zod` (tool parameter schemas), Vitest (all tests, `db`/Groq/`ai`/cross-subsystem tools fully mocked — zero live credentials required to run `npm test`).

## Global Constraints

- LLM calls go through `@ai-sdk/groq`, model id `llama-3.3-70b-versatile`, via the AI SDK's tool-calling loop (`streamText` with a `tools` object) — never call the Groq HTTP API directly.
- All tests use Vitest. The Groq provider call, `streamText`/`tool` from the `ai` package, and every tool function imported from another subsystem are mocked at the module boundary. `npm test` must be runnable with zero live credentials and zero network access.
- Import shared modules via the `@/` path alias (Next.js default tsconfig mapping `@/*` → repo root), e.g. `@/lib/db/client`, `@/lib/db/schema` — this repo's scaffold plan configures this alias.
- Do NOT modify or reimplement `lib/db/schema.ts` or `lib/db/client.ts` — both already exist (from the "Project Scaffold & Database" plan) exporting Drizzle tables `listings`, `neighborhoodDocs`, `sessions`, `shortlistItems`, `toolCallLog`, `bookings` (camelCase columns, per `docs/ARCHITECTURE.md` §4) and `db: NodePgDatabase<typeof schema>`. Import them, never redefine them.
- Do NOT implement `embedText` (`lib/rag/embed.ts`, data-ingestion subsystem), `osmNearby` (`lib/agent/tools/osmNearby.ts`), `listBookingSlots`, or `createBookingHold` (`lib/agent/tools/listBookingSlots.ts` / `lib/agent/tools/createBookingHold.ts`, both mcp-integrations subsystem). Treat them as already implemented and importable; every test that touches them mocks them via `vi.mock(...)`.
- No PII (owner/agent names, phone numbers) is ever logged, stored, or returned by any file in this plan — none of these files touch raw scrape data, so this is inherited by construction, not something to re-implement here.
- Every tool invocation reachable from the agent must produce a `toolCallLog` row (`toolName`, `input`, `output`) — this is required for the Edit Correctness and Grounding evals (owned by the evals subsystem, which reads this table).

---

## Canonical Interfaces Consumed From Other Subsystems

These are already implemented elsewhere. Mock them in tests; never implement them here.

```ts
// lib/rag/embed.ts (data-ingestion subsystem)
export async function embedText(text: string): Promise<number[]>; // 384-length vector

// lib/agent/tools/osmNearby.ts (mcp-integrations subsystem)
export type OsmNearbyResult = {
  items: Array<{ name: string; type: string; distanceMeters?: number }>;
  uncertain: boolean;
  note?: string;
};
export async function osmNearby(input: { lat: number; lng: number; category: string }): Promise<OsmNearbyResult>;

// lib/agent/tools/listBookingSlots.ts (mcp-integrations subsystem)
export type BookingSlot = { id: string; startIso: string; label: string };
export async function listBookingSlots(input: { dayPreference: string; timePreference: string }): Promise<{ slots: BookingSlot[] }>;

// lib/agent/tools/createBookingHold.ts (mcp-integrations subsystem)
export async function createBookingHold(input: {
  sessionId: string;
  listingId: string;
  topic: string;
  slot: BookingSlot;
}): Promise<{ confirmationCode: string; holdId: string; status: string }>;
```

---

### Task 1: `searchListings` deterministic ranking tool

**Files:**
- Create: `lib/agent/tools/searchListings.ts`
- Test: `lib/agent/tools/searchListings.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`; `listings` table from `@/lib/db/schema` (columns: `id, sourceUrl, societyName, locality, lat, lng, rent, bedrooms, furnishing, amenities, sqft, availabilityStatus, scrapedAt`, per `docs/ARCHITECTURE.md` §4).
- Produces:
  ```ts
  export type Listing = typeof listings.$inferSelect;
  export interface ListingConstraints {
    budgetMax?: number;
    bedrooms?: number;
    locality?: string;
    mustHaves?: string[];
  }
  export async function searchListings(constraints: ListingConstraints): Promise<Listing[]>;
  ```
  Task 3 (`applyShortlistEdit`) imports `searchListings` and `ListingConstraints`. Task 5 (`orchestrator.ts`) registers `searchListings` as a tool.

- [ ] **Step 1: Write the failing test**

Create `lib/agent/tools/searchListings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { searchListings } from './searchListings';

vi.mock('@/lib/db/client', () => ({
  db: { select: vi.fn() },
}));

function mockDbRows(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValue({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  } as never);
}

const baseRow = {
  sourceUrl: 'https://bengaluru.rent/x',
  lat: 12.9,
  lng: 77.6,
  furnishing: 'semi-furnished',
  sqft: 900,
  scrapedAt: new Date('2026-01-01T00:00:00Z'),
};

const fixtureRows = [
  { ...baseRow, id: '1', societyName: 'Alpha', locality: 'Koramangala', rent: 30000, bedrooms: 2, amenities: ['parking', 'lift'], availabilityStatus: 'available' },
  { ...baseRow, id: '2', societyName: 'Beta', locality: 'Koramangala', rent: 45000, bedrooms: 2, amenities: ['parking'], availabilityStatus: 'available' },
  { ...baseRow, id: '3', societyName: 'Gamma', locality: 'Koramangala', rent: 38000, bedrooms: 2, amenities: ['lift'], availabilityStatus: 'available' },
  { ...baseRow, id: '4', societyName: 'Delta', locality: 'Koramangala', rent: 39000, bedrooms: 2, amenities: ['parking', 'lift', 'gym'], availabilityStatus: 'available' },
  { ...baseRow, id: '5', societyName: 'Epsilon', locality: 'Koramangala', rent: 20000, bedrooms: 2, amenities: ['parking'], availabilityStatus: 'not_for_rent' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('searchListings', () => {
  it('excludes over-budget rows', async () => {
    mockDbRows(fixtureRows);
    const results = await searchListings({ budgetMax: 40000, bedrooms: 2 });
    expect(results.map((r) => r.id)).not.toContain('2');
  });

  it('excludes rows missing a required must-have amenity', async () => {
    mockDbRows(fixtureRows);
    const results = await searchListings({ budgetMax: 40000, bedrooms: 2, mustHaves: ['parking'] });
    expect(results.map((r) => r.id)).not.toContain('3');
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining(['1', '4']));
  });

  it('always excludes not_for_rent rows even if they would otherwise match', async () => {
    mockDbRows(fixtureRows);
    const results = await searchListings({ budgetMax: 50000, bedrooms: 2 });
    expect(results.map((r) => r.id)).not.toContain('5');
  });

  it('ranks by closeness to budget, most-matching must-haves as tiebreak', async () => {
    mockDbRows(fixtureRows);
    // budgetMax=40000, no mustHaves: candidates are 1 (diff 10000), 3 (diff 2000), 4 (diff 1000).
    // id 2 (45000) is excluded by budget; id 5 is excluded as not_for_rent.
    const results = await searchListings({ budgetMax: 40000, bedrooms: 2 });
    expect(results.map((r) => r.id)).toEqual(['4', '3', '1']);
  });

  it('breaks ties on budget-distance by must-have match count', async () => {
    mockDbRows(fixtureRows);
    // budgetMax=40000, mustHaves=['parking']: candidates are 1 (rent 30000, diff 10000) and 4 (rent 39000, diff 1000).
    // id 3 excluded (no parking). Expect closest-to-budget first regardless of match count (both match here).
    const results = await searchListings({ budgetMax: 40000, bedrooms: 2, mustHaves: ['parking'] });
    expect(results.map((r) => r.id)).toEqual(['4', '1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/agent/tools/searchListings.test.ts`
Expected: FAIL — `Cannot find module './searchListings'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/agent/tools/searchListings.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { listings } from '@/lib/db/schema';

export type Listing = typeof listings.$inferSelect;

export interface ListingConstraints {
  budgetMax?: number;
  bedrooms?: number;
  locality?: string;
  mustHaves?: string[];
}

/**
 * Deterministic (non-LLM) search over the listings table.
 * Always excludes anything not currently available, applies budget/bedrooms/
 * locality/must-have filters, then ranks by closeness to budget first and
 * must-have match count second.
 */
export async function searchListings(constraints: ListingConstraints): Promise<Listing[]> {
  const conditions = [eq(listings.availabilityStatus, 'available')];
  if (constraints.locality) {
    conditions.push(eq(listings.locality, constraints.locality));
  }
  if (constraints.bedrooms !== undefined) {
    conditions.push(eq(listings.bedrooms, constraints.bedrooms));
  }

  const rows = (await db
    .select()
    .from(listings)
    .where(and(...conditions))) as Listing[];

  const mustHaves = constraints.mustHaves ?? [];

  const filtered = rows.filter((row) => {
    // Defense in depth: never surface a not_for_rent row even if the SQL
    // predicate above changes or the mock/test bypasses it.
    if (row.availabilityStatus !== 'available') return false;
    if (constraints.budgetMax !== undefined && row.rent > constraints.budgetMax) return false;
    const amenities = Array.isArray(row.amenities) ? (row.amenities as string[]) : [];
    return mustHaves.every((mustHave) => amenities.includes(mustHave));
  });

  const scored = filtered.map((row) => {
    const amenities = Array.isArray(row.amenities) ? (row.amenities as string[]) : [];
    const matchCount = mustHaves.filter((m) => amenities.includes(m)).length;
    const budgetDistance = constraints.budgetMax !== undefined ? Math.abs(row.rent - constraints.budgetMax) : 0;
    return { row, matchCount, budgetDistance };
  });

  scored.sort((a, b) => {
    if (a.budgetDistance !== b.budgetDistance) return a.budgetDistance - b.budgetDistance;
    return b.matchCount - a.matchCount;
  });

  return scored.map((s) => s.row);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/agent/tools/searchListings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/searchListings.ts lib/agent/tools/searchListings.test.ts
git commit -m "feat(agent): add deterministic searchListings tool"
```

---

### Task 2: `retrieveNeighborhoodDocs` grounded RAG tool

**Files:**
- Create: `lib/agent/tools/retrieveNeighborhoodDocs.ts`
- Test: `lib/agent/tools/retrieveNeighborhoodDocs.test.ts`

**Interfaces:**
- Consumes: `embedText` from `@/lib/rag/embed` (mocked in tests); `db` from `@/lib/db/client`; `neighborhoodDocs` table from `@/lib/db/schema` (columns: `id, locality, sourceTitle, sourceUrl, chunkText, embedding, fetchedAt`).
- Produces:
  ```ts
  export interface RetrieveNeighborhoodDocsInput { locality: string; topic: string }
  export interface NeighborhoodChunk { chunkText: string; sourceTitle: string; sourceUrl: string }
  export interface RetrieveNeighborhoodDocsResult { chunks: NeighborhoodChunk[]; uncertain: boolean }
  export async function retrieveNeighborhoodDocs(input: RetrieveNeighborhoodDocsInput): Promise<RetrieveNeighborhoodDocsResult>;
  ```
  Task 5 (`orchestrator.ts`) registers `retrieveNeighborhoodDocs` as a tool. This backs the Grounding & Hallucination Eval (evals subsystem, out of scope here): `uncertain: true` must never be papered over.

- [ ] **Step 1: Write the failing test**

Create `lib/agent/tools/retrieveNeighborhoodDocs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { embedText } from '@/lib/rag/embed';
import { retrieveNeighborhoodDocs } from './retrieveNeighborhoodDocs';

vi.mock('@/lib/db/client', () => ({
  db: { select: vi.fn() },
}));

vi.mock('@/lib/rag/embed', () => ({
  embedText: vi.fn(),
}));

function mockDbRows(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(embedText).mockResolvedValue(new Array(384).fill(0.1));
});

describe('retrieveNeighborhoodDocs', () => {
  it('returns grounded chunks with citations when rows are found', async () => {
    const rows = [
      { chunkText: 'Koramangala has good metro connectivity.', sourceTitle: 'Koramangala - Wikipedia', sourceUrl: 'https://en.wikipedia.org/wiki/Koramangala' },
      { chunkText: 'The area is considered safe with active street life at night.', sourceTitle: 'Bengaluru neighborhood guide', sourceUrl: 'https://example.com/guide' },
    ];
    mockDbRows(rows);

    const result = await retrieveNeighborhoodDocs({ locality: 'Koramangala', topic: 'safety at night' });

    expect(embedText).toHaveBeenCalledWith('safety at night');
    expect(result.uncertain).toBe(false);
    expect(result.chunks).toEqual(rows);
  });

  it('returns uncertain:true and no chunks when zero rows are found', async () => {
    mockDbRows([]);

    const result = await retrieveNeighborhoodDocs({ locality: 'Koramangala', topic: 'safety at night' });

    expect(result).toEqual({ chunks: [], uncertain: true });
  });

  it('returns uncertain:true for a locality with no matching docs (e.g. a typo)', async () => {
    mockDbRows([]);

    const result = await retrieveNeighborhoodDocs({ locality: 'Koramangla', topic: 'transit' });

    expect(result).toEqual({ chunks: [], uncertain: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/agent/tools/retrieveNeighborhoodDocs.test.ts`
Expected: FAIL — `Cannot find module './retrieveNeighborhoodDocs'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/agent/tools/retrieveNeighborhoodDocs.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { neighborhoodDocs } from '@/lib/db/schema';
import { embedText } from '@/lib/rag/embed';

const TOP_K = 3;

export interface RetrieveNeighborhoodDocsInput {
  locality: string;
  topic: string;
}

export interface NeighborhoodChunk {
  chunkText: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface RetrieveNeighborhoodDocsResult {
  chunks: NeighborhoodChunk[];
  uncertain: boolean;
}

/**
 * pgvector cosine-distance similarity search over neighborhoodDocs, scoped to
 * a locality. Returns uncertain:true (and no chunks) whenever there is
 * nothing to ground a claim in — callers (the orchestrator's system prompt)
 * must never fabricate a neighborhood fact in that case.
 */
export async function retrieveNeighborhoodDocs(
  input: RetrieveNeighborhoodDocsInput,
): Promise<RetrieveNeighborhoodDocsResult> {
  const embedding = await embedText(input.topic);
  const vectorLiteral = `[${embedding.join(',')}]`;

  const rows = (await db
    .select({
      chunkText: neighborhoodDocs.chunkText,
      sourceTitle: neighborhoodDocs.sourceTitle,
      sourceUrl: neighborhoodDocs.sourceUrl,
    })
    .from(neighborhoodDocs)
    .where(eq(neighborhoodDocs.locality, input.locality))
    .orderBy(sql`${neighborhoodDocs.embedding} <=> ${vectorLiteral}::vector`)
    .limit(TOP_K)) as NeighborhoodChunk[];

  if (rows.length === 0) {
    return { chunks: [], uncertain: true };
  }

  return { chunks: rows, uncertain: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/agent/tools/retrieveNeighborhoodDocs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/retrieveNeighborhoodDocs.ts lib/agent/tools/retrieveNeighborhoodDocs.test.ts
git commit -m "feat(agent): add grounded retrieveNeighborhoodDocs RAG tool"
```

---

### Task 3: `applyShortlistEdit` scoped shortlist mutation tool

**Files:**
- Create: `lib/agent/tools/applyShortlistEdit.ts`
- Test: `lib/agent/tools/applyShortlistEdit.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`; `shortlistItems`, `listings`, `toolCallLog` tables from `@/lib/db/schema`; `searchListings`, `ListingConstraints` from `./searchListings` (Task 1).
- Produces:
  ```ts
  export type EditIntent =
    | { op: 'filter'; field: 'rent' | 'bedrooms'; comparator: '<=' | '>=' | '<' | '>'; value: number }
    | { op: 'add'; filters: Partial<ListingConstraints> }
    | { op: 'remove'; listingId: string };
  export type ShortlistDiff = { changed: string[]; unchanged: string[] };
  export async function applyShortlistEdit(input: { sessionId: string; editIntent: EditIntent }): Promise<ShortlistDiff>;
  ```
  `changed`/`unchanged` contain `listingId` strings. Task 5 (`orchestrator.ts`) registers `applyShortlistEdit` as a tool (binding `sessionId` from the agent session, exposing only `editIntent` to the LLM). This is the core of the Edit Correctness Eval (evals subsystem): every call must write exactly one `toolCallLog` row and must never touch shortlist rows outside the edit's scope.

- [ ] **Step 1: Write the failing test**

Create `lib/agent/tools/applyShortlistEdit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { searchListings } from './searchListings';
import { applyShortlistEdit } from './applyShortlistEdit';

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('./searchListings', () => ({
  searchListings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) } as never);
});

function mockSelectOnce(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({
        where: () => Promise.resolve(rows),
      }),
      where: () => Promise.resolve(rows),
    }),
  } as never);
}

describe('applyShortlistEdit — filter op (scope discipline)', () => {
  it('flips exactly the over-budget items to dropped and leaves the other 3 byte-for-byte unchanged', async () => {
    const addedAt = new Date('2026-01-01T00:00:00Z');
    const rows = [
      { shortlistItemId: 'si-1', listingId: 'l-1', rent: 30000, bedrooms: 2 },
      { shortlistItemId: 'si-2', listingId: 'l-2', rent: 45000, bedrooms: 2 }, // over budget
      { shortlistItemId: 'si-3', listingId: 'l-3', rent: 38000, bedrooms: 2 },
      { shortlistItemId: 'si-4', listingId: 'l-4', rent: 52000, bedrooms: 3 }, // over budget
      { shortlistItemId: 'si-5', listingId: 'l-5', rent: 25000, bedrooms: 1 },
    ];
    mockSelectOnce(rows);

    const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as never);

    const diff = await applyShortlistEdit({
      sessionId: 'sess-1',
      editIntent: { op: 'filter', field: 'rent', comparator: '<=', value: 40000 },
    });

    expect(diff.changed.sort()).toEqual(['l-2', 'l-4']);
    expect(diff.unchanged.sort()).toEqual(['l-1', 'l-3', 'l-5']);
    // Exactly 2 update calls issued — the other 3 rows were never written to.
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(updateSetMock).toHaveBeenCalledTimes(2);
    for (const call of updateSetMock.mock.calls) {
      expect(call[0]).toMatchObject({ status: 'dropped' });
      expect(typeof call[0].reason).toBe('string');
    }

    void addedAt; // unchanged rows are never targeted by update(), so their addedAt/status/reason are provably untouched.
  });

  it('logs exactly one toolCallLog row with the tool name, input, and output', async () => {
    mockSelectOnce([{ shortlistItemId: 'si-1', listingId: 'l-1', rent: 45000, bedrooms: 2 }]);
    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) } as never);
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const editIntent = { op: 'filter' as const, field: 'rent' as const, comparator: '<=' as const, value: 40000 };
    const diff = await applyShortlistEdit({ sessionId: 'sess-1', editIntent });

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', toolName: 'applyShortlistEdit', input: editIntent, output: diff }),
    );
  });
});

describe('applyShortlistEdit — remove op', () => {
  it('drops only the targeted listingId', async () => {
    mockSelectOnce([
      { shortlistItemId: 'si-1', listingId: 'l-1' },
      { shortlistItemId: 'si-2', listingId: 'l-2' },
      { shortlistItemId: 'si-3', listingId: 'l-3' },
    ]);
    const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as never);

    const diff = await applyShortlistEdit({ sessionId: 'sess-1', editIntent: { op: 'remove', listingId: 'l-2' } });

    expect(diff.changed).toEqual(['l-2']);
    expect(diff.unchanged.sort()).toEqual(['l-1', 'l-3']);
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe('applyShortlistEdit — add op', () => {
  it('inserts only results not already in the shortlist', async () => {
    mockSelectOnce([{ listingId: 'l-1' }, { listingId: 'l-2' }]); // existing active items
    vi.mocked(searchListings).mockResolvedValue([
      { id: 'l-1' } as never, // already present — must not be re-inserted
      { id: 'l-3' } as never, // new — must be inserted
    ]);
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const diff = await applyShortlistEdit({
      sessionId: 'sess-1',
      editIntent: { op: 'add', filters: { mustHaves: ['balcony'] } },
    });

    expect(searchListings).toHaveBeenCalledWith({ mustHaves: ['balcony'] });
    expect(diff.changed).toEqual(['l-3']);
    expect(diff.unchanged.sort()).toEqual(['l-1', 'l-2']);
    // One insert for the new shortlist row, one insert for the toolCallLog row.
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', listingId: 'l-3', status: 'active' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/agent/tools/applyShortlistEdit.test.ts`
Expected: FAIL — `Cannot find module './applyShortlistEdit'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/agent/tools/applyShortlistEdit.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shortlistItems, listings, toolCallLog } from '@/lib/db/schema';
import { searchListings, type ListingConstraints } from './searchListings';

export type EditIntent =
  | { op: 'filter'; field: 'rent' | 'bedrooms'; comparator: '<=' | '>=' | '<' | '>'; value: number }
  | { op: 'add'; filters: Partial<ListingConstraints> }
  | { op: 'remove'; listingId: string };

export type ShortlistDiff = { changed: string[]; unchanged: string[] };

function passesComparator(actual: number, comparator: '<=' | '>=' | '<' | '>', value: number): boolean {
  switch (comparator) {
    case '<=':
      return actual <= value;
    case '>=':
      return actual >= value;
    case '<':
      return actual < value;
    case '>':
      return actual > value;
  }
}

async function applyFilter(
  sessionId: string,
  editIntent: Extract<EditIntent, { op: 'filter' }>,
): Promise<ShortlistDiff> {
  const rows = (await db
    .select({
      shortlistItemId: shortlistItems.id,
      listingId: shortlistItems.listingId,
      rent: listings.rent,
      bedrooms: listings.bedrooms,
    })
    .from(shortlistItems)
    .innerJoin(listings, eq(shortlistItems.listingId, listings.id))
    .where(and(eq(shortlistItems.sessionId, sessionId), eq(shortlistItems.status, 'active')))) as Array<{
    shortlistItemId: string;
    listingId: string;
    rent: number;
    bedrooms: number;
  }>;

  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const row of rows) {
    const actual = editIntent.field === 'rent' ? row.rent : row.bedrooms;
    const keeps = passesComparator(actual, editIntent.comparator, editIntent.value);
    if (keeps) {
      unchanged.push(row.listingId);
      continue;
    }
    changed.push(row.listingId);
    await db
      .update(shortlistItems)
      .set({
        status: 'dropped',
        reason: `Dropped: ${editIntent.field} ${editIntent.comparator} ${editIntent.value} not satisfied`,
      })
      .where(eq(shortlistItems.id, row.shortlistItemId));
  }

  return { changed, unchanged };
}

async function applyRemove(sessionId: string, listingId: string): Promise<ShortlistDiff> {
  const rows = (await db
    .select({ shortlistItemId: shortlistItems.id, listingId: shortlistItems.listingId })
    .from(shortlistItems)
    .where(and(eq(shortlistItems.sessionId, sessionId), eq(shortlistItems.status, 'active')))) as Array<{
    shortlistItemId: string;
    listingId: string;
  }>;

  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const row of rows) {
    if (row.listingId === listingId) {
      changed.push(row.listingId);
      await db
        .update(shortlistItems)
        .set({ status: 'dropped', reason: 'Removed by user request' })
        .where(eq(shortlistItems.id, row.shortlistItemId));
    } else {
      unchanged.push(row.listingId);
    }
  }

  return { changed, unchanged };
}

async function applyAdd(sessionId: string, filters: Partial<ListingConstraints>): Promise<ShortlistDiff> {
  const existingRows = (await db
    .select({ listingId: shortlistItems.listingId })
    .from(shortlistItems)
    .where(and(eq(shortlistItems.sessionId, sessionId), eq(shortlistItems.status, 'active')))) as Array<{
    listingId: string;
  }>;

  const existingIds = new Set(existingRows.map((r) => r.listingId));
  const unchanged = [...existingIds];

  const results = await searchListings(filters as ListingConstraints);
  const changed: string[] = [];

  for (const listing of results) {
    if (existingIds.has(listing.id)) continue;
    await db.insert(shortlistItems).values({
      sessionId,
      listingId: listing.id,
      status: 'active',
      reason: 'Added to match new filter',
      addedAt: new Date(),
    });
    changed.push(listing.id);
  }

  return { changed, unchanged };
}

/**
 * Applies a structured, scoped edit against ONLY the session's current
 * active shortlist rows. Never regenerates the shortlist from scratch — this
 * is what makes the Edit Correctness Eval possible (unaffected rows are
 * never written to). Every call is logged to toolCallLog.
 */
export async function applyShortlistEdit(input: {
  sessionId: string;
  editIntent: EditIntent;
}): Promise<ShortlistDiff> {
  const { sessionId, editIntent } = input;

  let diff: ShortlistDiff;
  if (editIntent.op === 'filter') {
    diff = await applyFilter(sessionId, editIntent);
  } else if (editIntent.op === 'remove') {
    diff = await applyRemove(sessionId, editIntent.listingId);
  } else {
    diff = await applyAdd(sessionId, editIntent.filters);
  }

  await db.insert(toolCallLog).values({
    sessionId,
    toolName: 'applyShortlistEdit',
    input: editIntent,
    output: diff,
  });

  return diff;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/agent/tools/applyShortlistEdit.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools/applyShortlistEdit.ts lib/agent/tools/applyShortlistEdit.test.ts
git commit -m "feat(agent): add scoped applyShortlistEdit tool with toolCallLog"
```

---

### Task 4: `getOrCreateSession` session bootstrap

**Files:**
- Create: `lib/agent/session.ts`
- Test: `lib/agent/session.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`; `sessions` table from `@/lib/db/schema` (columns: `id, createdAt, constraints, status`).
- Produces:
  ```ts
  export async function getOrCreateSession(cookieSessionId?: string): Promise<{ id: string; isNew: boolean }>;
  ```
  Task 6 (`app/api/agent/route.ts`) and Task 8 (`app/api/booking/route.ts`) call this.

- [ ] **Step 1: Write the failing test**

Create `lib/agent/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { getOrCreateSession } from './session';

vi.mock('@/lib/db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrCreateSession', () => {
  it('returns the existing session info when the cookie id matches a row', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ id: 'sess-existing-1' }]),
      }),
    } as never);

    const result = await getOrCreateSession('sess-existing-1');

    expect(result).toEqual({ id: 'sess-existing-1', isNew: false });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates a new session when no cookie id is given', async () => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const result = await getOrCreateSession(undefined);

    expect(db.select).not.toHaveBeenCalled();
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
  });

  it('creates a new session when the cookie id does not match any row', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    } as never);
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const result = await getOrCreateSession('stale-cookie-id');

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
    expect(result.id).not.toBe('stale-cookie-id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/agent/session.test.ts`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/agent/session.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';

/**
 * Gets the session identified by cookieSessionId, or creates a fresh one if
 * no id was given or the given id doesn't match any row (e.g. a stale
 * cookie from a previous deploy/DB reset).
 */
export async function getOrCreateSession(cookieSessionId?: string): Promise<{ id: string; isNew: boolean }> {
  if (cookieSessionId) {
    const existing = (await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, cookieSessionId))) as Array<{ id: string }>;

    if (existing.length > 0) {
      return { id: existing[0].id, isNew: false };
    }
  }

  const newId = randomUUID();
  await db.insert(sessions).values({ id: newId, constraints: {}, status: 'active' });
  return { id: newId, isNew: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/agent/session.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/session.ts lib/agent/session.test.ts
git commit -m "feat(agent): add getOrCreateSession bootstrap"
```

---

### Task 5: Orchestrator — Groq `streamText` agent with logged tools

**Files:**
- Create: `lib/agent/orchestrator.ts`
- Test: `lib/agent/orchestrator.test.ts`

**Interfaces:**
- Consumes:
  - `searchListings`, `ListingConstraints` from `./tools/searchListings` (Task 1)
  - `retrieveNeighborhoodDocs` from `./tools/retrieveNeighborhoodDocs` (Task 2)
  - `applyShortlistEdit`, `EditIntent` from `./tools/applyShortlistEdit` (Task 3)
  - `osmNearby` from `./tools/osmNearby` (mcp-integrations subsystem, mocked in tests)
  - `listBookingSlots`, `BookingSlot` from `./tools/listBookingSlots` (mcp-integrations subsystem, mocked in tests)
  - `createBookingHold` from `./tools/createBookingHold` (mcp-integrations subsystem, mocked in tests)
  - `db` from `@/lib/db/client`; `toolCallLog` table from `@/lib/db/schema`
  - `groq` from `@ai-sdk/groq`; `streamText`, `tool` from `ai`
- Produces:
  ```ts
  export const SYSTEM_PROMPT: string;
  export function createAgent(sessionId: string): {
    tools: Record<'searchListings' | 'retrieveNeighborhoodDocs' | 'applyShortlistEdit' | 'osmNearby' | 'listBookingSlots' | 'createBookingHold', unknown>;
    systemPrompt: string;
    stream: (messages: import('ai').CoreMessage[]) => ReturnType<typeof import('ai').streamText>;
  };
  ```
  Task 6 (`app/api/agent/route.ts`) calls `createAgent(sessionId).stream(messages)`.

This task requires `zod` for tool parameter schemas. If it isn't already a dependency, add it first.

- [ ] **Step 1: Ensure `zod` is installed**

Run: `npm ls zod`
If it prints "empty" / not found, run: `npm install zod`
Expected: `zod` appears in `package.json` dependencies afterward.

- [ ] **Step 2: Write the failing test**

Create `lib/agent/orchestrator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { searchListings } from './tools/searchListings';
import { retrieveNeighborhoodDocs } from './tools/retrieveNeighborhoodDocs';
import { applyShortlistEdit } from './tools/applyShortlistEdit';
import { osmNearby } from './tools/osmNearby';
import { listBookingSlots } from './tools/listBookingSlots';
import { createBookingHold } from './tools/createBookingHold';
import { createAgent, SYSTEM_PROMPT } from './orchestrator';

vi.mock('@/lib/db/client', () => ({
  db: { insert: vi.fn() },
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
  // Identity passthrough so tests can call tools[...].execute(...) directly
  // without depending on the real AI SDK's schema-validation internals.
  tool: vi.fn((config: unknown) => config),
}));

vi.mock('@ai-sdk/groq', () => ({
  groq: vi.fn((modelId: string) => ({ modelId })),
}));

vi.mock('./tools/searchListings', () => ({ searchListings: vi.fn().mockResolvedValue([]) }));
vi.mock('./tools/retrieveNeighborhoodDocs', () => ({
  retrieveNeighborhoodDocs: vi.fn().mockResolvedValue({ chunks: [], uncertain: true }),
}));
vi.mock('./tools/applyShortlistEdit', () => ({ applyShortlistEdit: vi.fn().mockResolvedValue({ changed: [], unchanged: [] }) }));
vi.mock('./tools/osmNearby', () => ({ osmNearby: vi.fn().mockResolvedValue({ items: [], uncertain: true }) }));
vi.mock('./tools/listBookingSlots', () => ({ listBookingSlots: vi.fn().mockResolvedValue({ slots: [] }) }));
vi.mock('./tools/createBookingHold', () => ({
  createBookingHold: vi.fn().mockResolvedValue({ confirmationCode: 'NL-0001', holdId: 'hold-1', status: 'tentative' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) } as never);
});

describe('createAgent', () => {
  it('registers all 6 tools under the expected names', () => {
    const agent = createAgent('sess-1');
    expect(Object.keys(agent.tools).sort()).toEqual(
      ['applyShortlistEdit', 'createBookingHold', 'listBookingSlots', 'osmNearby', 'retrieveNeighborhoodDocs', 'searchListings'].sort(),
    );
  });

  it('system prompt enforces the max-5-questions rule and grounding-uncertainty rule', () => {
    expect(SYSTEM_PROMPT).toMatch(/at most 5 clarifying questions/i);
    expect(SYSTEM_PROMPT).toMatch(/uncertain/i);
    expect(SYSTEM_PROMPT).toMatch(/osmNearby|retrieveNeighborhoodDocs/);
  });

  it('wraps searchListings so invoking it writes a toolCallLog row via db.insert', async () => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const agent = createAgent('sess-1');
    const searchTool = agent.tools.searchListings as { execute: (input: unknown) => Promise<unknown> };
    await searchTool.execute({ budgetMax: 40000 });

    expect(searchListings).toHaveBeenCalledWith({ budgetMax: 40000 });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', toolName: 'searchListings' }),
    );
  });

  it('wraps applyShortlistEdit so it binds sessionId and writes a toolCallLog row', async () => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const agent = createAgent('sess-42');
    const editTool = agent.tools.applyShortlistEdit as { execute: (input: unknown) => Promise<unknown> };
    const editIntent = { op: 'remove' as const, listingId: 'l-1' };
    await editTool.execute({ editIntent });

    expect(applyShortlistEdit).toHaveBeenCalledWith({ sessionId: 'sess-42', editIntent });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-42', toolName: 'applyShortlistEdit' }),
    );
  });

  it('wraps osmNearby, listBookingSlots, and createBookingHold with the same logging behavior', async () => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const agent = createAgent('sess-1');
    const osmTool = agent.tools.osmNearby as { execute: (input: unknown) => Promise<unknown> };
    await osmTool.execute({ lat: 12.9, lng: 77.6, category: 'metro_station' });
    expect(osmNearby).toHaveBeenCalledWith({ lat: 12.9, lng: 77.6, category: 'metro_station' });

    const slotsTool = agent.tools.listBookingSlots as { execute: (input: unknown) => Promise<unknown> };
    await slotsTool.execute({ dayPreference: 'weekday', timePreference: 'evening' });
    expect(listBookingSlots).toHaveBeenCalledWith({ dayPreference: 'weekday', timePreference: 'evening' });

    const holdTool = agent.tools.createBookingHold as { execute: (input: unknown) => Promise<unknown> };
    const slot = { id: 's-1', startIso: '2026-08-10T10:00:00Z', label: 'Mon 10:00 AM' };
    await holdTool.execute({ listingId: 'l-1', topic: 'Alpha Society, Koramangala', slot });
    expect(createBookingHold).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      listingId: 'l-1',
      topic: 'Alpha Society, Koramangala',
      slot,
    });

    expect(insertValuesMock).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- lib/agent/orchestrator.test.ts`
Expected: FAIL — `Cannot find module './orchestrator'`.

- [ ] **Step 4: Write minimal implementation**

Create `lib/agent/orchestrator.ts`:

```ts
import { z } from 'zod';
import { tool, streamText, type CoreMessage } from 'ai';
import { groq } from '@ai-sdk/groq';
import { db } from '@/lib/db/client';
import { toolCallLog } from '@/lib/db/schema';
import { searchListings } from './tools/searchListings';
import { retrieveNeighborhoodDocs } from './tools/retrieveNeighborhoodDocs';
import { applyShortlistEdit, type EditIntent } from './tools/applyShortlistEdit';
import { osmNearby } from './tools/osmNearby';
import { listBookingSlots } from './tools/listBookingSlots';
import { createBookingHold } from './tools/createBookingHold';
import type { BookingSlot } from './tools/listBookingSlots';

export const SYSTEM_PROMPT = `You are NextLeap's voice-first property scout for renters in Bengaluru.

Your job: collect the user's rental preferences (budget, bedrooms, must-have amenities, locality/commute point), shortlist real available listings that match, explain your shortlist decisions, let the user refine the shortlist with follow-up requests, and help them book a site-visit call.

Rules you must follow on every turn:
1. Ask at most 5 clarifying questions in total before producing a shortlist. Keep track of how many clarifying questions you have already asked in this conversation and stop asking once you reach 5 — proceed with the best shortlist you can from what you know.
2. Before calling searchListings to produce or refresh a shortlist, restate the constraints you understood (budget, bedrooms, locality, must-haves) back to the user in one sentence and get their confirmation.
3. Never state a neighborhood, amenity, or transit fact (for example "there's a metro station nearby", "this area is safe at night", "it has covered parking") without first calling osmNearby or retrieveNeighborhoodDocs in the SAME turn and basing the statement on its result. Do not rely on general knowledge for these claims.
4. If a grounding tool call (osmNearby or retrieveNeighborhoodDocs) returns uncertain: true, you must explicitly tell the user the data is unavailable or uncertain for that listing or area. Never fill the gap from general knowledge or guess.
5. When the user asks to change the shortlist (for example "drop anything above 40k", "remove that one", "add one more with a balcony"), call applyShortlistEdit with a precisely scoped editIntent — only the listings the user's instruction actually targets should change.
6. When the user wants to book a site visit, call listBookingSlots first to get real available slots, present them, and only call createBookingHold after the user has picked one.
7. Keep spoken/text replies concise; full explanations and citations belong in the UI.`;

const listingConstraintsSchema = z.object({
  budgetMax: z.number().optional(),
  bedrooms: z.number().optional(),
  locality: z.string().optional(),
  mustHaves: z.array(z.string()).optional(),
});

const retrieveNeighborhoodDocsSchema = z.object({
  locality: z.string(),
  topic: z.string(),
});

const editIntentSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('filter'),
    field: z.enum(['rent', 'bedrooms']),
    comparator: z.enum(['<=', '>=', '<', '>']),
    value: z.number(),
  }),
  z.object({
    op: z.literal('add'),
    filters: listingConstraintsSchema.partial(),
  }),
  z.object({
    op: z.literal('remove'),
    listingId: z.string(),
  }),
]);

const osmNearbySchema = z.object({
  lat: z.number(),
  lng: z.number(),
  category: z.string(),
});

const listBookingSlotsSchema = z.object({
  dayPreference: z.string(),
  timePreference: z.string(),
});

const bookingSlotSchema = z.object({
  id: z.string(),
  startIso: z.string(),
  label: z.string(),
});

function withToolCallLogging<TInput, TOutput>(
  toolName: string,
  sessionId: string,
  fn: (input: TInput) => Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput) => {
    const output = await fn(input);
    await db.insert(toolCallLog).values({
      sessionId,
      toolName,
      input: input as object,
      output: output as object,
    });
    return output;
  };
}

export function createAgent(sessionId: string) {
  const tools = {
    searchListings: tool({
      description:
        'Search the listings database for currently available rentals matching budget, bedrooms, locality, and must-have amenities. This is a deterministic filter/rank, not an LLM call.',
      parameters: listingConstraintsSchema,
      execute: withToolCallLogging('searchListings', sessionId, searchListings),
    }),
    retrieveNeighborhoodDocs: tool({
      description:
        'Retrieve grounded neighborhood guidance chunks (safety, amenities, transit character) for a locality and topic, with citations. Returns uncertain:true when nothing is found — never guess when that happens.',
      parameters: retrieveNeighborhoodDocsSchema,
      execute: withToolCallLogging('retrieveNeighborhoodDocs', sessionId, retrieveNeighborhoodDocs),
    }),
    applyShortlistEdit: tool({
      description:
        'Apply a scoped edit (filter, add, or remove) to the current session shortlist. Only the listings targeted by the edit change.',
      parameters: z.object({ editIntent: editIntentSchema }),
      execute: withToolCallLogging(
        'applyShortlistEdit',
        sessionId,
        ({ editIntent }: { editIntent: EditIntent }) => applyShortlistEdit({ sessionId, editIntent }),
      ),
    }),
    osmNearby: tool({
      description:
        'Query OpenStreetMap for nearby amenities/transit points around a lat/lng. Required source of truth for any amenity or transit claim.',
      parameters: osmNearbySchema,
      execute: withToolCallLogging('osmNearby', sessionId, osmNearby),
    }),
    listBookingSlots: tool({
      description: 'List real available site-visit slots for a day/time preference.',
      parameters: listBookingSlotsSchema,
      execute: withToolCallLogging('listBookingSlots', sessionId, listBookingSlots),
    }),
    createBookingHold: tool({
      description: 'Create a tentative booking hold for a chosen slot and listing, returning a confirmation code.',
      parameters: z.object({ listingId: z.string(), topic: z.string(), slot: bookingSlotSchema }),
      execute: withToolCallLogging(
        'createBookingHold',
        sessionId,
        ({ listingId, topic, slot }: { listingId: string; topic: string; slot: BookingSlot }) =>
          createBookingHold({ sessionId, listingId, topic, slot }),
      ),
    }),
  };

  return {
    tools,
    systemPrompt: SYSTEM_PROMPT,
    stream: (messages: CoreMessage[]) =>
      streamText({
        model: groq('llama-3.3-70b-versatile'),
        system: SYSTEM_PROMPT,
        messages,
        tools,
      }),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- lib/agent/orchestrator.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/agent/orchestrator.ts lib/agent/orchestrator.test.ts package.json package-lock.json
git commit -m "feat(agent): add Groq streamText orchestrator with logged tools"
```

---

### Task 6: `POST /api/agent` route handler

**Files:**
- Create: `app/api/agent/route.ts`
- Test: `app/api/agent/route.test.ts`

**Interfaces:**
- Consumes: `getOrCreateSession` from `@/lib/agent/session` (Task 4); `createAgent` from `@/lib/agent/orchestrator` (Task 5); `db` from `@/lib/db/client`; `sessions` table from `@/lib/db/schema`; `cookies` from `next/headers`.
- Produces: `export async function POST(request: Request): Promise<Response>` — a streaming text response, and sets a `nl_session_id` cookie.

Design note: `docs/ARCHITECTURE.md` §3.2 says session state including "conversation history" is persisted in the `sessions` table, but §4's schema only gives `sessions` a single `constraints` jsonb column (no dedicated history column) — that column is fixed by the already-implemented scaffold. This route therefore treats `sessions.constraints` as a JSON state bag shaped `{ history?: CoreMessage[] }` (and, later, ` preferences?: ...`) rather than adding a new column.

- [ ] **Step 1: Write the failing test**

Create `app/api/agent/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { getOrCreateSession } from '@/lib/agent/session';
import { createAgent } from '@/lib/agent/orchestrator';
import { POST } from './route';

vi.mock('@/lib/db/client', () => ({
  db: { select: vi.fn(), update: vi.fn() },
}));

vi.mock('@/lib/agent/session', () => ({
  getOrCreateSession: vi.fn(),
}));

vi.mock('@/lib/agent/orchestrator', () => ({
  createAgent: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  } as never);
  vi.mocked(db.select).mockReturnValue({
    from: () => ({
      where: () => Promise.resolve([{ constraints: {} }]),
    }),
  } as never);
  vi.mocked(db.update).mockReturnValue({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) } as never);
});

describe('POST /api/agent', () => {
  it('gets-or-creates a session, appends the message to history, and streams the agent reply', async () => {
    vi.mocked(getOrCreateSession).mockResolvedValue({ id: 'sess-1', isNew: true });
    const mockResponse = new Response('mock stream');
    const streamMock = vi.fn().mockReturnValue({ toTextStreamResponse: () => mockResponse });
    vi.mocked(createAgent).mockReturnValue({ stream: streamMock } as never);

    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: '2BHK in Koramangala, budget 35k' }),
    });

    const response = await POST(request);

    expect(getOrCreateSession).toHaveBeenCalledWith(undefined);
    expect(createAgent).toHaveBeenCalledWith('sess-1');
    expect(streamMock).toHaveBeenCalledWith([{ role: 'user', content: '2BHK in Koramangala, budget 35k' }]);
    expect(response).toBe(mockResponse);
  });

  it('passes the existing session cookie id through to getOrCreateSession', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'sess-existing' }),
      set: vi.fn(),
    } as never);
    vi.mocked(getOrCreateSession).mockResolvedValue({ id: 'sess-existing', isNew: false });
    const streamMock = vi.fn().mockReturnValue({ toTextStreamResponse: () => new Response('mock stream') });
    vi.mocked(createAgent).mockReturnValue({ stream: streamMock } as never);

    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: 'hello again' }),
    });

    await POST(request);

    expect(getOrCreateSession).toHaveBeenCalledWith('sess-existing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/api/agent/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/agent/route.ts`:

```ts
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import type { CoreMessage } from 'ai';
import { db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';
import { getOrCreateSession } from '@/lib/agent/session';
import { createAgent } from '@/lib/agent/orchestrator';

const SESSION_COOKIE = 'nl_session_id';

type SessionState = { history?: CoreMessage[]; preferences?: Record<string, unknown> };

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { message: string };
  const cookieStore = await cookies();
  const existingSessionId = cookieStore.get(SESSION_COOKIE)?.value;

  const { id: sessionId } = await getOrCreateSession(existingSessionId);

  const rows = (await db
    .select({ constraints: sessions.constraints })
    .from(sessions)
    .where(eq(sessions.id, sessionId))) as Array<{ constraints: SessionState | null }>;

  const state: SessionState = rows[0]?.constraints ?? {};
  const history: CoreMessage[] = state.history ?? [];
  const updatedHistory: CoreMessage[] = [...history, { role: 'user', content: body.message }];

  const agent = createAgent(sessionId);
  const result = agent.stream(updatedHistory);

  // Persist the user turn immediately. Persisting the assistant's streamed
  // reply back into history is intentionally left for a follow-up — it
  // requires consuming the stream server-side (e.g. via an onFinish hook),
  // which is outside this route's tested surface.
  await db
    .update(sessions)
    .set({ constraints: { ...state, history: updatedHistory } })
    .where(eq(sessions.id, sessionId));

  cookieStore.set(SESSION_COOKIE, sessionId, { httpOnly: true, path: '/', sameSite: 'lax' });

  return result.toTextStreamResponse();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/api/agent/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/agent/route.ts app/api/agent/route.test.ts
git commit -m "feat(api): add /api/agent streaming route handler"
```

---

### Task 7: `GET /api/shortlist` route handler

**Files:**
- Create: `app/api/shortlist/route.ts`
- Test: `app/api/shortlist/route.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`; `shortlistItems`, `listings` tables from `@/lib/db/schema`; `cookies` from `next/headers`.
- Produces: `export async function GET(): Promise<Response>` returning `{ items: Array<{ shortlistItemId: string; status: string; reason: string | null; addedAt: Date; listing: Listing }> }`.

- [ ] **Step 1: Write the failing test**

Create `app/api/shortlist/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { GET } from './route';

vi.mock('@/lib/db/client', () => ({
  db: { select: vi.fn() },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/shortlist', () => {
  it('returns an empty item list without querying the db when there is no session cookie', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) } as never);

    const response = await GET();
    const json = await response.json();

    expect(json).toEqual({ items: [] });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns the active shortlist items joined with their listing for the current session', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'sess-1' }) } as never);
    const fixtureRows = [
      {
        shortlistItemId: 'si-1',
        status: 'active',
        reason: null,
        addedAt: new Date('2026-01-01T00:00:00Z'),
        listing: { id: 'l-1', societyName: 'Alpha', rent: 30000 },
      },
    ];
    vi.mocked(db.select).mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(fixtureRows),
        }),
      }),
    } as never);

    const response = await GET();
    const json = await response.json();

    expect(json).toEqual({ items: fixtureRows });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/api/shortlist/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/shortlist/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shortlistItems, listings } from '@/lib/db/schema';

const SESSION_COOKIE = 'nl_session_id';

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionId) {
    return NextResponse.json({ items: [] });
  }

  const rows = await db
    .select({
      shortlistItemId: shortlistItems.id,
      status: shortlistItems.status,
      reason: shortlistItems.reason,
      addedAt: shortlistItems.addedAt,
      listing: listings,
    })
    .from(shortlistItems)
    .innerJoin(listings, eq(shortlistItems.listingId, listings.id))
    .where(and(eq(shortlistItems.sessionId, sessionId), eq(shortlistItems.status, 'active')));

  return NextResponse.json({ items: rows });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/api/shortlist/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/shortlist/route.ts app/api/shortlist/route.test.ts
git commit -m "feat(api): add /api/shortlist read route"
```

---

### Task 8: `POST /api/booking` route handler

**Files:**
- Create: `app/api/booking/route.ts`
- Test: `app/api/booking/route.test.ts`

**Interfaces:**
- Consumes: `getOrCreateSession` from `@/lib/agent/session` (Task 4); `listBookingSlots`, `BookingSlot` from `@/lib/agent/tools/listBookingSlots` (mcp-integrations subsystem, mocked); `createBookingHold` from `@/lib/agent/tools/createBookingHold` (mcp-integrations subsystem, mocked); `db` from `@/lib/db/client`; `bookings`, `listings` tables from `@/lib/db/schema`; `cookies` from `next/headers`.
- Produces: `export async function POST(request: Request): Promise<Response>`.
  - Request body `{ listingId: string; dayPreference: string; timePreference: string; slot?: BookingSlot }`.
  - When `slot` is absent: calls `listBookingSlots` and returns `{ slots: BookingSlot[] }` (no DB write yet — the user hasn't picked one).
  - When `slot` is present: looks up the listing's `societyName`/`locality` to build a `topic`, calls `createBookingHold`, writes a `bookings` row with `status: 'tentative'`, and returns `{ confirmationCode, holdId, status }`.

- [ ] **Step 1: Write the failing test**

Create `app/api/booking/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { getOrCreateSession } from '@/lib/agent/session';
import { listBookingSlots } from '@/lib/agent/tools/listBookingSlots';
import { createBookingHold } from '@/lib/agent/tools/createBookingHold';
import { POST } from './route';

vi.mock('@/lib/db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));

vi.mock('@/lib/agent/session', () => ({
  getOrCreateSession: vi.fn(),
}));

vi.mock('@/lib/agent/tools/listBookingSlots', () => ({
  listBookingSlots: vi.fn(),
}));

vi.mock('@/lib/agent/tools/createBookingHold', () => ({
  createBookingHold: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'sess-1' }),
    set: vi.fn(),
  } as never);
  vi.mocked(getOrCreateSession).mockResolvedValue({ id: 'sess-1', isNew: false });
});

describe('POST /api/booking', () => {
  it('returns candidate slots and does not write to the db when no slot is chosen yet', async () => {
    vi.mocked(listBookingSlots).mockResolvedValue({
      slots: [{ id: 's-1', startIso: '2026-08-10T10:00:00Z', label: 'Mon 10:00 AM' }],
    });

    const request = new Request('http://localhost/api/booking', {
      method: 'POST',
      body: JSON.stringify({ listingId: 'l-1', dayPreference: 'weekday', timePreference: 'morning' }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(listBookingSlots).toHaveBeenCalledWith({ dayPreference: 'weekday', timePreference: 'morning' });
    expect(json).toEqual({ slots: [{ id: 's-1', startIso: '2026-08-10T10:00:00Z', label: 'Mon 10:00 AM' }] });
    expect(db.insert).not.toHaveBeenCalled();
    expect(createBookingHold).not.toHaveBeenCalled();
  });

  it('creates the hold and writes a tentative bookings row once a slot is chosen', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ societyName: 'Alpha Society', locality: 'Koramangala' }]),
      }),
    } as never);
    vi.mocked(createBookingHold).mockResolvedValue({
      confirmationCode: 'NL-A742',
      holdId: 'hold-99',
      status: 'tentative',
    });
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const slot = { id: 's-1', startIso: '2026-08-10T10:00:00Z', label: 'Mon 10:00 AM' };
    const request = new Request('http://localhost/api/booking', {
      method: 'POST',
      body: JSON.stringify({ listingId: 'l-1', dayPreference: 'weekday', timePreference: 'morning', slot }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(createBookingHold).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      listingId: 'l-1',
      topic: 'Alpha Society, Koramangala',
      slot,
    });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        listingId: 'l-1',
        confirmationCode: 'NL-A742',
        holdId: 'hold-99',
        slotStartIso: slot.startIso,
        slotLabel: slot.label,
        status: 'tentative',
      }),
    );
    expect(json).toEqual({ confirmationCode: 'NL-A742', holdId: 'hold-99', status: 'tentative' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/api/booking/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/booking/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { bookings, listings } from '@/lib/db/schema';
import { getOrCreateSession } from '@/lib/agent/session';
import { listBookingSlots } from '@/lib/agent/tools/listBookingSlots';
import { createBookingHold } from '@/lib/agent/tools/createBookingHold';
import type { BookingSlot } from '@/lib/agent/tools/listBookingSlots';

const SESSION_COOKIE = 'nl_session_id';

type BookingRequestBody = {
  listingId: string;
  dayPreference: string;
  timePreference: string;
  slot?: BookingSlot;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as BookingRequestBody;
  const cookieStore = await cookies();
  const existingSessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const { id: sessionId } = await getOrCreateSession(existingSessionId);
  cookieStore.set(SESSION_COOKIE, sessionId, { httpOnly: true, path: '/', sameSite: 'lax' });

  if (!body.slot) {
    const { slots } = await listBookingSlots({
      dayPreference: body.dayPreference,
      timePreference: body.timePreference,
    });
    return NextResponse.json({ slots });
  }

  const listingRows = (await db
    .select({ societyName: listings.societyName, locality: listings.locality })
    .from(listings)
    .where(eq(listings.id, body.listingId))) as Array<{ societyName: string; locality: string }>;

  const listing = listingRows[0];
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  const topic = `${listing.societyName}, ${listing.locality}`;

  const { confirmationCode, holdId } = await createBookingHold({
    sessionId,
    listingId: body.listingId,
    topic,
    slot: body.slot,
  });

  await db.insert(bookings).values({
    sessionId,
    listingId: body.listingId,
    confirmationCode,
    holdId,
    slotStartIso: body.slot.startIso,
    slotLabel: body.slot.label,
    status: 'tentative',
    createdAt: new Date(),
  });

  return NextResponse.json({ confirmationCode, holdId, status: 'tentative' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/api/booking/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/booking/route.ts app/api/booking/route.test.ts
git commit -m "feat(api): add /api/booking route for slots and holds"
```

---

## Final Verification

- [ ] **Run the full suite for this subsystem**

Run: `npm test -- lib/agent app/api/agent app/api/shortlist app/api/booking`
Expected: All test files pass, 0 failures, no network/DB/Groq calls made (everything mocked).

- [ ] **Sanity-check tool registry coverage**

Confirm `lib/agent/orchestrator.ts`'s `tools` object has exactly 6 keys (`searchListings`, `retrieveNeighborhoodDocs`, `applyShortlistEdit`, `osmNearby`, `listBookingSlots`, `createBookingHold`) matching `docs/ARCHITECTURE.md` §3.2's tool list (minus `explainDecision`, which is not a separate tool — explanations are produced by the LLM reasoning over `retrieveNeighborhoodDocs`/`toolCallLog` results per §6 step 6, not a new function).
