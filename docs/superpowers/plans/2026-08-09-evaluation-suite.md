# Evaluation Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three required AI evaluation checks (Feasibility, Edit Correctness, Grounding & Hallucination) as standalone, runnable TypeScript scripts under `evals/`, each backed by realistic fixtures and its own Vitest suite that proves it correctly passes known-good and fails known-bad cases.

**Architecture:** Each eval is a pure function (`runFeasibilityEval`, `runEditCorrectnessEval`, `runGroundingEval`) that takes already-shaped data (session/shortlist/listing/tool-call-log rows) and returns `{ pass: boolean; failures: string[] }`. A thin CLI wrapper in the same file loads that data either from a JSON fixture (`--fixture <path>`) or, where the persisted schema supports it, from the DB (`--session <id>`), then prints pass/fail and exits non-zero on failure. Fixtures are plain `.json` files under `evals/fixtures/`, shared by the eval scripts and their Vitest suites. The only eval requiring judgment (Grounding) calls Groq via AI SDK's `generateObject` with a strict Zod schema; that call is mocked in all Vitest tests.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM (`lib/db/schema.ts` / `lib/db/client.ts` from the already-executed scaffold plan), `ai` + `@ai-sdk/groq` (`generateObject`, model `llama-3.3-70b-versatile`), Zod, `tsx` as the script runner.

## Global Constraints

- LLM judgment (Grounding eval only): Groq via `@ai-sdk/groq`, model `llama-3.3-70b-versatile`, called through AI SDK's `generateObject` with a strict Zod schema — per `docs/ARCHITECTURE.md` §1 and this plan's brief.
- Testing: Vitest for everything, including the eval scripts themselves. Every eval script has its own Vitest suite (`evals/*.test.ts`) proving it passes known-good fixtures and fails known-bad fixtures. All Groq calls are mocked in tests — `npm test` must be runnable with zero live credentials.
- Evals must also be runnable standalone via `npm run eval:*` (not only as Vitest suites) — this is the literal spec requirement ("Evals can be rule-based or LLM-assisted but must be runnable").
- Data model must match `docs/ARCHITECTURE.md` §4 exactly: `listings`, `sessions` (`constraints` jsonb), `shortlistItems` (`sessionId`, `listingId`, `status`, `reason`, `addedAt`), `toolCallLog` (`sessionId`, `toolName`, `input` jsonb, `output` jsonb, `createdAt`) — all camelCase, exported from `lib/db/schema.ts`. Do not invent new tables or columns beyond §4.
- No PII (names, phone numbers) anywhere in data, UI, or logs — fixtures in this plan never include owner/agent contact fields, consistent with the upstream ingestion pipeline's PII-strip step.
- Every neighborhood claim must have a citation, and uncertainty must be stated explicitly when data is missing/unreliable — this is what the Grounding eval enforces.
- Voice edits must only change the intended part of the shortlist — this is what the Edit Correctness eval enforces.

## Interfaces Consumed From Other Subsystems (treat as already implemented)

**From the Project Scaffold & Database plan** (`lib/db/schema.ts`, `lib/db/client.ts`):
- `db` — Drizzle client instance, default export style: `export const db = drizzle(...)`.
- `listings`, `sessions`, `shortlistItems`, `toolCallLog` — Drizzle `pgTable(...)` definitions matching `docs/ARCHITECTURE.md` §4, with camelCase JS column names (`availabilityStatus`, `societyName`, `sessionId`, `listingId`, `toolName`, `createdAt`, etc.).
- Assumption (flagged, not verifiable without reading the scaffold's actual file): the project's `tsconfig.json` has a path alias `@/*` → `./*` (Next.js App Router default) and `resolveJsonModule: true`. Task 1, Step 4 below verifies/fixes `resolveJsonModule` defensively since fixture JSON imports depend on it. All imports in this plan use relative paths (`../lib/db/schema`) rather than the `@/` alias, so they work even if that alias assumption is wrong.

**From the Orchestration/Agent subsystem** (canonical shapes, not code — evals never import from `lib/agent/*`, only read the DB rows / fixture JSON those tools produce):
- An `applyShortlistEdit` tool call's `toolCallLog` row: `input` is an `EditIntent`, e.g. `{ op: 'filter', field: 'rent', comparator: '<=', value: 40000 }`; `output` is `{ changed: string[]; unchanged: string[] }` where the strings are **listing ids** (not shortlist-item ids).
- An `osmNearby` tool call with `category: 'commute'`: `output` is `{ items: [...]; uncertain: boolean; note?: string }`.
- A `retrieveNeighborhoodDocs` tool call: `output` is `{ chunks: Array<{ chunkText: string; sourceTitle: string; sourceUrl: string }>; uncertain: boolean }`.
- **Decision/assumption (flagged):** the orchestration layer's `osmNearby` `input` for a commute check is assumed to carry a human-readable `commutePoint: string` field alongside `lat`/`lng` (e.g. `{ lat, lng, category: 'commute', commutePoint: 'Koramangala' }`), since the Feasibility eval needs a label to string-compare against `session.constraints.commutePoint` and the architecture doc doesn't pin the exact `input` shape (only `output` is pinned). If the real orchestration tool's input shape differs, only the one field-read in Task 2 Step 5 needs to change.
- **Decision/assumption (flagged):** a transcript entry's `citations` carry `{ sourceTitle, sourceUrl, chunkText }` (not just `sourceTitle`/`sourceUrl`), because the Grounding eval's LLM-judge step needs the actual source text to check whether it supports a claim, and `chunkText` is exactly what `retrieveNeighborhoodDocs` already returns per chunk. This is a superset of the plainer `{ role, content, citations?: Array<{sourceTitle, sourceUrl}> }` shape described in the brief, extended with the field the check structurally requires.
- **Scope limit (flagged):** `docs/ARCHITECTURE.md` §4 has no table/column for persisting a pre-edit shortlist snapshot or a full conversation transcript. Because of that, the Edit Correctness eval and the Grounding eval's CLI support **fixture mode only** (`--fixture <path>`); DB mode (`--session <id>`) is implemented only for the Feasibility eval, whose three inputs (`sessions`, `shortlistItems` joined with `listings`, `toolCallLog`) are all directly queryable per §4. This is a deliberate scope boundary, not an oversight — if a later plan adds transcript/snapshot persistence, DB mode can be added to those two CLIs then.

---

### Task 1: Shared Types & Fixtures

**Files:**
- Create: `evals/types.ts`
- Create: `evals/fixtures/feasibility-pass.json`
- Create: `evals/fixtures/feasibility-budget-violation.json`
- Create: `evals/fixtures/feasibility-commute-mismatch.json`
- Create: `evals/fixtures/edit-correct.json`
- Create: `evals/fixtures/edit-buggy.json`
- Create: `evals/fixtures/grounding-fully-grounded.json`
- Create: `evals/fixtures/grounding-no-citation.json`
- Create: `evals/fixtures/grounding-citation-mismatch.json`
- Create: `evals/fixtures/grounding-uncertainty-stated.json`
- Test: `evals/fixtures/fixtures.smoke.test.ts`
- Modify (defensive check only): `tsconfig.json`

**Interfaces:**
- Consumes: `lib/db/schema.ts` exports `listings`, `sessions`, `shortlistItems`, `toolCallLog` (Drizzle `pgTable`s); `drizzle-orm`'s `InferSelectModel<T>` utility type.
- Produces (used by every later task in this plan):
  - Types: `Listing`, `SessionRow`, `Session` (SessionRow with typed `constraints`), `Constraints`, `ShortlistItem`, `ShortlistItemWithListing`, `ToolCallLogRow`, `EditIntent`, `EditLogEntry`, `TranscriptCitation`, `TranscriptEntry`, `CommuteToolCallInput`, `CommuteToolCallOutput`, `FeasibilityFixture`, `EditCorrectnessFixture`, `GroundingFixture` — all from `evals/types.ts`.
  - Fixture files listed above, each parseable with `JSON.parse`/`import ... from './fixtures/x.json'` and matching the bundle type named in its section below.

- [ ] **Step 1: Write the failing smoke test**

Create `evals/fixtures/fixtures.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type {
  FeasibilityFixture,
  EditCorrectnessFixture,
  GroundingFixture,
} from '../types';
import feasibilityPass from './feasibility-pass.json';
import feasibilityBudgetViolation from './feasibility-budget-violation.json';
import feasibilityCommuteMismatch from './feasibility-commute-mismatch.json';
import editCorrect from './edit-correct.json';
import editBuggy from './edit-buggy.json';
import groundingFullyGrounded from './grounding-fully-grounded.json';
import groundingNoCitation from './grounding-no-citation.json';
import groundingCitationMismatch from './grounding-citation-mismatch.json';
import groundingUncertaintyStated from './grounding-uncertainty-stated.json';

describe('eval fixtures', () => {
  it('feasibility fixtures have a session with numeric budgetMax and array fields', () => {
    for (const fixture of [
      feasibilityPass,
      feasibilityBudgetViolation,
      feasibilityCommuteMismatch,
    ] as FeasibilityFixture[]) {
      expect(typeof fixture.session.constraints.budgetMax).toBe('number');
      expect(Array.isArray(fixture.session.constraints.mustHaves)).toBe(true);
      expect(Array.isArray(fixture.shortlistItems)).toBe(true);
      expect(Array.isArray(fixture.toolCallLog)).toBe(true);
    }
  });

  it('edit-correctness fixtures have before/after arrays and a filter editLogEntry', () => {
    for (const fixture of [editCorrect, editBuggy] as EditCorrectnessFixture[]) {
      expect(Array.isArray(fixture.beforeItems)).toBe(true);
      expect(Array.isArray(fixture.afterItems)).toBe(true);
      expect(Array.isArray(fixture.editLogEntry.output.changed)).toBe(true);
      expect(fixture.editLogEntry.input.op).toBe('filter');
    }
  });

  it('grounding fixtures have a transcript array and joined shortlistItems', () => {
    for (const fixture of [
      groundingFullyGrounded,
      groundingNoCitation,
      groundingCitationMismatch,
      groundingUncertaintyStated,
    ] as GroundingFixture[]) {
      expect(Array.isArray(fixture.transcript)).toBe(true);
      expect(Array.isArray(fixture.shortlistItems)).toBe(true);
      expect(fixture.shortlistItems[0].listing.id).toBe('listing-1');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run evals/fixtures/fixtures.smoke.test.ts`
Expected: FAIL — `Cannot find module '../types'` (and/or `Cannot find module './feasibility-pass.json'`), since none of these files exist yet.

- [ ] **Step 3: Verify/fix `resolveJsonModule` in `tsconfig.json`**

Open `tsconfig.json`. If `"compilerOptions"` does not already contain `"resolveJsonModule": true`, add it (keep every other existing key untouched):

```json
{
  "compilerOptions": {
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: Create `evals/types.ts`**

```ts
import type { InferSelectModel } from 'drizzle-orm';
import type { listings, sessions, shortlistItems, toolCallLog } from '../lib/db/schema';

export type Listing = InferSelectModel<typeof listings>;
export type SessionRow = InferSelectModel<typeof sessions>;
export type ShortlistItem = InferSelectModel<typeof shortlistItems>;
export type ToolCallLogRow = InferSelectModel<typeof toolCallLog>;

/** Shape of `sessions.constraints` (jsonb, untyped at the DB layer). */
export type Constraints = {
  budgetMax: number;
  bedrooms: number;
  mustHaves: string[];
  commutePoint: string;
};

export type Session = Omit<SessionRow, 'constraints'> & { constraints: Constraints };

/** Mirrors the orchestration-agent subsystem's canonical EditIntent shape. */
export type EditIntent =
  | { op: 'filter'; field: string; comparator: '<=' | '>=' | '<' | '>' | '=='; value: number }
  | { op: 'add'; filters: Record<string, unknown> }
  | { op: 'requireAmenity'; amenity: string };

/** `toolCallLog.output` shape for an `applyShortlistEdit` call (listing ids, per ARCHITECTURE.md). */
export type EditLogEntry = {
  input: EditIntent;
  output: { changed: string[]; unchanged: string[] };
};

export type ShortlistItemWithListing = ShortlistItem & { listing: Listing };

/** `toolCallLog.input`/`output` for an `osmNearby` call with category 'commute'. */
export type CommuteToolCallInput = {
  lat: number;
  lng: number;
  category: 'commute';
  commutePoint: string;
};
export type CommuteToolCallOutput = {
  items: unknown[];
  uncertain: boolean;
  note?: string;
};

/** A citation attached to a transcript entry — a subset of a retrieveNeighborhoodDocs chunk. */
export type TranscriptCitation = {
  sourceTitle: string;
  sourceUrl: string;
  chunkText: string;
};

export type TranscriptEntry = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: TranscriptCitation[];
};

export type FeasibilityFixture = {
  session: Session;
  shortlistItems: ShortlistItemWithListing[];
  toolCallLog: ToolCallLogRow[];
};

export type EditCorrectnessFixture = {
  beforeItems: ShortlistItemWithListing[];
  afterItems: ShortlistItemWithListing[];
  editLogEntry: EditLogEntry;
};

export type GroundingFixture = {
  transcript: TranscriptEntry[];
  shortlistItems: ShortlistItemWithListing[];
};
```

- [ ] **Step 5: Create `evals/fixtures/feasibility-pass.json`**

Session constraints: budget 40000, 2BHK, must-have parking, commute point Koramangala. Both shortlist items satisfy every constraint; the one commute tool call matches the stated commute point.

```json
{
  "session": {
    "id": "sess-1",
    "createdAt": "2026-08-01T10:00:00.000Z",
    "status": "active",
    "constraints": {
      "budgetMax": 40000,
      "bedrooms": 2,
      "mustHaves": ["parking"],
      "commutePoint": "Koramangala"
    }
  },
  "shortlistItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget, right bedroom count, has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-4",
      "sessionId": "sess-1",
      "listingId": "listing-4",
      "status": "active",
      "reason": "Cheapest option with parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-4",
        "sourceUrl": "https://bengaluru.rent/listing/4",
        "societyName": "Palm Court",
        "locality": "Koramangala",
        "lat": 12.9340,
        "lng": 77.6130,
        "rent": 37000,
        "bedrooms": 2,
        "furnishing": "unfurnished",
        "amenities": ["parking"],
        "sqft": 1000,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "toolCallLog": [
    {
      "id": "tcl-1",
      "sessionId": "sess-1",
      "toolName": "osmNearby",
      "input": { "lat": 12.9352, "lng": 77.6146, "category": "commute", "commutePoint": "Koramangala" },
      "output": { "items": [{ "name": "Koramangala Metro Access Point", "distanceMeters": 900 }], "uncertain": false },
      "createdAt": "2026-08-01T10:06:00.000Z"
    }
  ]
}
```

- [ ] **Step 6: Create `evals/fixtures/feasibility-budget-violation.json`**

Same session/constraints. One active item over budget (`listing-2`, rent 45000) and one active item missing the must-have `parking` (`listing-3`).

```json
{
  "session": {
    "id": "sess-1",
    "createdAt": "2026-08-01T10:00:00.000Z",
    "status": "active",
    "constraints": {
      "budgetMax": 40000,
      "bedrooms": 2,
      "mustHaves": ["parking"],
      "commutePoint": "Koramangala"
    }
  },
  "shortlistItems": [
    {
      "id": "si-2",
      "sessionId": "sess-1",
      "listingId": "listing-2",
      "status": "active",
      "reason": "Good bedrooms but pricier",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-2",
        "sourceUrl": "https://bengaluru.rent/listing/2",
        "societyName": "Skyline Residency",
        "locality": "Koramangala",
        "lat": 12.9360,
        "lng": 77.6150,
        "rent": 45000,
        "bedrooms": 2,
        "furnishing": "furnished",
        "amenities": ["parking"],
        "sqft": 1150,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-3",
      "sessionId": "sess-1",
      "listingId": "listing-3",
      "status": "active",
      "reason": "In budget but no parking listed",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-3",
        "sourceUrl": "https://bengaluru.rent/listing/3",
        "societyName": "Maple Court",
        "locality": "Koramangala",
        "lat": 12.9345,
        "lng": 77.6140,
        "rent": 39000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["balcony"],
        "sqft": 1050,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "toolCallLog": [
    {
      "id": "tcl-2",
      "sessionId": "sess-1",
      "toolName": "osmNearby",
      "input": { "lat": 12.9360, "lng": 77.6150, "category": "commute", "commutePoint": "Koramangala" },
      "output": { "items": [{ "name": "Koramangala Metro Access Point", "distanceMeters": 1200 }], "uncertain": false },
      "createdAt": "2026-08-01T10:06:00.000Z"
    }
  ]
}
```

- [ ] **Step 7: Create `evals/fixtures/feasibility-commute-mismatch.json`**

Same session/constraints. Shortlist fully satisfies budget/bedrooms/mustHaves (reuses `listing-1`/`listing-4` from Step 5), but the commute tool call was computed against `"Indiranagar"`, not the session's stated `"Koramangala"`.

```json
{
  "session": {
    "id": "sess-1",
    "createdAt": "2026-08-01T10:00:00.000Z",
    "status": "active",
    "constraints": {
      "budgetMax": 40000,
      "bedrooms": 2,
      "mustHaves": ["parking"],
      "commutePoint": "Koramangala"
    }
  },
  "shortlistItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget, right bedroom count, has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-4",
      "sessionId": "sess-1",
      "listingId": "listing-4",
      "status": "active",
      "reason": "Cheapest option with parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-4",
        "sourceUrl": "https://bengaluru.rent/listing/4",
        "societyName": "Palm Court",
        "locality": "Koramangala",
        "lat": 12.9340,
        "lng": 77.6130,
        "rent": 37000,
        "bedrooms": 2,
        "furnishing": "unfurnished",
        "amenities": ["parking"],
        "sqft": 1000,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "toolCallLog": [
    {
      "id": "tcl-3",
      "sessionId": "sess-1",
      "toolName": "osmNearby",
      "input": { "lat": 12.9352, "lng": 77.6146, "category": "commute", "commutePoint": "Indiranagar" },
      "output": { "items": [{ "name": "Indiranagar Metro Station", "distanceMeters": 2000 }], "uncertain": false },
      "createdAt": "2026-08-01T10:06:00.000Z"
    }
  ]
}
```

- [ ] **Step 8: Create `evals/fixtures/edit-correct.json`**

Simulates "Drop anything above 40k" (`{ op: 'filter', field: 'rent', comparator: '<=', value: 40000 }`). Before: 3 active items (`listing-1` 38000, `listing-2` 45000, `listing-4` 37000). After: only `listing-2` (the one over budget) flips to `dropped`; the log correctly names only `listing-2` as changed.

```json
{
  "beforeItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget and has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-2",
      "sessionId": "sess-1",
      "listingId": "listing-2",
      "status": "active",
      "reason": "Good bedrooms but pricier",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-2",
        "sourceUrl": "https://bengaluru.rent/listing/2",
        "societyName": "Skyline Residency",
        "locality": "Koramangala",
        "lat": 12.9360,
        "lng": 77.6150,
        "rent": 45000,
        "bedrooms": 2,
        "furnishing": "furnished",
        "amenities": ["parking"],
        "sqft": 1150,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-4",
      "sessionId": "sess-1",
      "listingId": "listing-4",
      "status": "active",
      "reason": "Cheapest option with parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-4",
        "sourceUrl": "https://bengaluru.rent/listing/4",
        "societyName": "Palm Court",
        "locality": "Koramangala",
        "lat": 12.9340,
        "lng": 77.6130,
        "rent": 37000,
        "bedrooms": 2,
        "furnishing": "unfurnished",
        "amenities": ["parking"],
        "sqft": 1000,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "afterItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget and has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-2",
      "sessionId": "sess-1",
      "listingId": "listing-2",
      "status": "dropped",
      "reason": "Rent 45000 exceeds the 40000 filter",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-2",
        "sourceUrl": "https://bengaluru.rent/listing/2",
        "societyName": "Skyline Residency",
        "locality": "Koramangala",
        "lat": 12.9360,
        "lng": 77.6150,
        "rent": 45000,
        "bedrooms": 2,
        "furnishing": "furnished",
        "amenities": ["parking"],
        "sqft": 1150,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-4",
      "sessionId": "sess-1",
      "listingId": "listing-4",
      "status": "active",
      "reason": "Cheapest option with parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-4",
        "sourceUrl": "https://bengaluru.rent/listing/4",
        "societyName": "Palm Court",
        "locality": "Koramangala",
        "lat": 12.9340,
        "lng": 77.6130,
        "rent": 37000,
        "bedrooms": 2,
        "furnishing": "unfurnished",
        "amenities": ["parking"],
        "sqft": 1000,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "editLogEntry": {
    "input": { "op": "filter", "field": "rent", "comparator": "<=", "value": 40000 },
    "output": { "changed": ["listing-2"], "unchanged": ["listing-1", "listing-4"] }
  }
}
```

- [ ] **Step 9: Create `evals/fixtures/edit-buggy.json`**

Identical `beforeItems` to Step 8. In `afterItems`, `listing-4` (rent 37000, under the 40000 filter — should be untouched) is *also* flipped to `dropped`, and the log's `output.changed` incorrectly includes it alongside `listing-2`. This is the deliberately buggy case the Edit Correctness eval must catch.

```json
{
  "beforeItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget and has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-2",
      "sessionId": "sess-1",
      "listingId": "listing-2",
      "status": "active",
      "reason": "Good bedrooms but pricier",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-2",
        "sourceUrl": "https://bengaluru.rent/listing/2",
        "societyName": "Skyline Residency",
        "locality": "Koramangala",
        "lat": 12.9360,
        "lng": 77.6150,
        "rent": 45000,
        "bedrooms": 2,
        "furnishing": "furnished",
        "amenities": ["parking"],
        "sqft": 1150,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-4",
      "sessionId": "sess-1",
      "listingId": "listing-4",
      "status": "active",
      "reason": "Cheapest option with parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-4",
        "sourceUrl": "https://bengaluru.rent/listing/4",
        "societyName": "Palm Court",
        "locality": "Koramangala",
        "lat": 12.9340,
        "lng": 77.6130,
        "rent": 37000,
        "bedrooms": 2,
        "furnishing": "unfurnished",
        "amenities": ["parking"],
        "sqft": 1000,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "afterItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget and has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-2",
      "sessionId": "sess-1",
      "listingId": "listing-2",
      "status": "dropped",
      "reason": "Rent 45000 exceeds the 40000 filter",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-2",
        "sourceUrl": "https://bengaluru.rent/listing/2",
        "societyName": "Skyline Residency",
        "locality": "Koramangala",
        "lat": 12.9360,
        "lng": 77.6150,
        "rent": 45000,
        "bedrooms": 2,
        "furnishing": "furnished",
        "amenities": ["parking"],
        "sqft": 1150,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    },
    {
      "id": "si-4",
      "sessionId": "sess-1",
      "listingId": "listing-4",
      "status": "dropped",
      "reason": "Rent 45000 exceeds the 40000 filter",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-4",
        "sourceUrl": "https://bengaluru.rent/listing/4",
        "societyName": "Palm Court",
        "locality": "Koramangala",
        "lat": 12.9340,
        "lng": 77.6130,
        "rent": 37000,
        "bedrooms": 2,
        "furnishing": "unfurnished",
        "amenities": ["parking"],
        "sqft": 1000,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "editLogEntry": {
    "input": { "op": "filter", "field": "rent", "comparator": "<=", "value": 40000 },
    "output": { "changed": ["listing-2", "listing-4"], "unchanged": ["listing-1"] }
  }
}
```

- [ ] **Step 10: Create `evals/fixtures/grounding-fully-grounded.json`**

A claim about Koramangala, cited, and the cited `chunkText` genuinely supports the claim.

```json
{
  "shortlistItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget and has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "transcript": [
    { "role": "user", "content": "What is the neighborhood like around Green Meadows?" },
    {
      "role": "assistant",
      "content": "Koramangala is well known for its dense concentration of cafes and tech offices, and the main roads near Green Meadows are well-lit and considered safe for evening pedestrian traffic.",
      "citations": [
        {
          "sourceTitle": "Koramangala - Wikipedia",
          "sourceUrl": "https://en.wikipedia.org/wiki/Koramangala",
          "chunkText": "Koramangala is a residential and commercial neighbourhood in Bengaluru known for its cafes, tech startup offices, and well-lit main roads, generally considered safe for evening pedestrian traffic."
        }
      ]
    }
  ]
}
```

- [ ] **Step 11: Create `evals/fixtures/grounding-no-citation.json`**

A neighborhood claim with no citation and no uncertainty language.

```json
{
  "shortlistItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget and has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "transcript": [
    { "role": "user", "content": "Is HSR Layout safe at night?" },
    { "role": "assistant", "content": "HSR Layout is generally a very safe and quiet area at night with well-maintained parks." }
  ]
}
```

- [ ] **Step 12: Create `evals/fixtures/grounding-citation-mismatch.json`**

A claim citing a source whose `chunkText` actually contradicts it.

```json
{
  "shortlistItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget and has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "transcript": [
    { "role": "user", "content": "How is the metro connectivity near Green Meadows?" },
    {
      "role": "assistant",
      "content": "Koramangala has excellent metro connectivity with a metro station right outside Green Meadows.",
      "citations": [
        {
          "sourceTitle": "Koramangala - Wikipedia",
          "sourceUrl": "https://en.wikipedia.org/wiki/Koramangala",
          "chunkText": "Koramangala is primarily served by BMTC bus routes; the nearest Namma Metro station is several kilometres away in Ejipura, and there is no metro station within the neighbourhood itself."
        }
      ]
    }
  ]
}
```

- [ ] **Step 13: Create `evals/fixtures/grounding-uncertainty-stated.json`**

A claim correctly stating uncertainty instead of guessing, with no citation attached.

```json
{
  "shortlistItems": [
    {
      "id": "si-1",
      "sessionId": "sess-1",
      "listingId": "listing-1",
      "status": "active",
      "reason": "Within budget and has parking",
      "addedAt": "2026-08-01T10:05:00.000Z",
      "listing": {
        "id": "listing-1",
        "sourceUrl": "https://bengaluru.rent/listing/1",
        "societyName": "Green Meadows",
        "locality": "Koramangala",
        "lat": 12.9352,
        "lng": 77.6146,
        "rent": 38000,
        "bedrooms": 2,
        "furnishing": "semi-furnished",
        "amenities": ["parking", "balcony"],
        "sqft": 1100,
        "availabilityStatus": "available",
        "scrapedAt": "2026-07-30T00:00:00.000Z"
      }
    }
  ],
  "transcript": [
    { "role": "user", "content": "What's the crime rate like immediately around Green Meadows?" },
    {
      "role": "assistant",
      "content": "I don't have reliable data on hyper-local crime statistics for this specific street, so I can't confirm that with confidence. At a broader locality level Koramangala is generally considered safe, but I would treat the building-specific claim as uncertain."
    }
  ]
}
```

- [ ] **Step 14: Run the smoke test to verify it passes**

Run: `npx vitest run evals/fixtures/fixtures.smoke.test.ts`
Expected: PASS — 3 tests, all green.

- [ ] **Step 15: Commit**

```bash
git add evals/types.ts evals/fixtures/ tsconfig.json
git commit -m "test: add shared eval types and fixtures for feasibility/edit-correctness/grounding evals"
```

---

### Task 2: Feasibility Eval

**Files:**
- Create: `evals/feasibility.ts`
- Test: `evals/feasibility.test.ts`

**Interfaces:**
- Consumes: `evals/types.ts` (`Session`, `ShortlistItemWithListing`, `ToolCallLogRow`, `CommuteToolCallInput`, `FeasibilityFixture`); `evals/fixtures/feasibility-pass.json`, `evals/fixtures/feasibility-budget-violation.json`, `evals/fixtures/feasibility-commute-mismatch.json`; `lib/db/client.ts` (`db`); `lib/db/schema.ts` (`sessions`, `shortlistItems`, `listings`, `toolCallLog`); `drizzle-orm` (`eq`).
- Produces: `export async function runFeasibilityEval(session: Session, shortlistItems: ShortlistItemWithListing[], toolCallLogEntries: ToolCallLogRow[] = []): Promise<{ pass: boolean; failures: string[] }>`. **Note the third parameter added beyond the brief's 2-arg description**: rule (b) (commute-point consistency) structurally requires the session's `toolCallLog` rows, which cannot be derived from `session`/`shortlistItems` alone. It defaults to `[]` so callers that only care about budget/must-have checks can omit it. This is the exact signature Task 5's CLI wiring and any future consumer must use.

- [ ] **Step 1: Write the failing tests**

Create `evals/feasibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runFeasibilityEval } from './feasibility';
import feasibilityPass from './fixtures/feasibility-pass.json';
import feasibilityBudgetViolation from './fixtures/feasibility-budget-violation.json';
import feasibilityCommuteMismatch from './fixtures/feasibility-commute-mismatch.json';
import type { FeasibilityFixture } from './types';

describe('runFeasibilityEval', () => {
  it('passes when the shortlist respects budget/bedrooms/mustHaves and commute matches', async () => {
    const fixture = feasibilityPass as FeasibilityFixture;
    const result = await runFeasibilityEval(fixture.session, fixture.shortlistItems, fixture.toolCallLog);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails and names the violating listings on budget/must-have violations', async () => {
    const fixture = feasibilityBudgetViolation as FeasibilityFixture;
    const result = await runFeasibilityEval(fixture.session, fixture.shortlistItems, fixture.toolCallLog);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('listing-2'))).toBe(true);
    expect(result.failures.some((f) => f.includes('listing-3'))).toBe(true);
  });

  it('fails when a commute claim was computed against a different commute point', async () => {
    const fixture = feasibilityCommuteMismatch as FeasibilityFixture;
    const result = await runFeasibilityEval(fixture.session, fixture.shortlistItems, fixture.toolCallLog);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('Indiranagar'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run evals/feasibility.test.ts`
Expected: FAIL — `Cannot find module './feasibility'` (the file doesn't exist yet).

- [ ] **Step 3: Write `evals/feasibility.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { sessions, shortlistItems as shortlistItemsTable, listings, toolCallLog } from '../lib/db/schema';
import type {
  Session,
  ShortlistItemWithListing,
  ToolCallLogRow,
  CommuteToolCallInput,
  FeasibilityFixture,
} from './types';

export async function runFeasibilityEval(
  session: Session,
  shortlistItems: ShortlistItemWithListing[],
  toolCallLogEntries: ToolCallLogRow[] = []
): Promise<{ pass: boolean; failures: string[] }> {
  const failures: string[] = [];
  const { budgetMax, bedrooms, mustHaves, commutePoint } = session.constraints;

  for (const item of shortlistItems) {
    if (item.status !== 'active') continue;
    const listing = item.listing;

    if (listing.rent > budgetMax) {
      failures.push(
        `Listing ${item.listingId} (${listing.societyName}) rent ${listing.rent} exceeds budgetMax ${budgetMax}`
      );
    }

    if (listing.bedrooms !== bedrooms) {
      failures.push(
        `Listing ${item.listingId} (${listing.societyName}) has ${listing.bedrooms} bedrooms, expected ${bedrooms}`
      );
    }

    const amenities = Array.isArray(listing.amenities) ? (listing.amenities as string[]) : [];
    const missingMustHaves = mustHaves.filter((m) => !amenities.includes(m));
    if (missingMustHaves.length > 0) {
      failures.push(
        `Listing ${item.listingId} (${listing.societyName}) is missing must-have amenities: ${missingMustHaves.join(', ')}`
      );
    }
  }

  const commuteCalls = toolCallLogEntries.filter((entry) => {
    if (entry.toolName !== 'osmNearby') return false;
    const input = entry.input as Partial<CommuteToolCallInput> | null;
    return input?.category === 'commute';
  });

  for (const call of commuteCalls) {
    const input = call.input as CommuteToolCallInput;
    if (input.commutePoint !== commutePoint) {
      failures.push(
        `Commute analysis (tool_call_log id ${call.id}) was computed against "${input.commutePoint}" but the session's stated commute point is "${commutePoint}"`
      );
    }
  }

  return { pass: failures.length === 0, failures };
}

function parseArgs(argv: string[]): { fixture?: string; session?: string } {
  const args: { fixture?: string; session?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') args.fixture = argv[++i];
    if (argv[i] === '--session') args.session = argv[++i];
  }
  return args;
}

function loadFromFixture(path: string): FeasibilityFixture {
  return JSON.parse(readFileSync(path, 'utf-8')) as FeasibilityFixture;
}

async function loadFromDb(sessionId: string): Promise<FeasibilityFixture> {
  const [sessionRow] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!sessionRow) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const rows = await db
    .select({ item: shortlistItemsTable, listing: listings })
    .from(shortlistItemsTable)
    .innerJoin(listings, eq(shortlistItemsTable.listingId, listings.id))
    .where(eq(shortlistItemsTable.sessionId, sessionId));
  const joinedItems: ShortlistItemWithListing[] = rows.map((row) => ({ ...row.item, listing: row.listing }));

  const logs = await db.select().from(toolCallLog).where(eq(toolCallLog.sessionId, sessionId));

  return {
    session: sessionRow as unknown as Session,
    shortlistItems: joinedItems,
    toolCallLog: logs,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let data: FeasibilityFixture;

  if (args.fixture) {
    data = loadFromFixture(args.fixture);
  } else if (args.session) {
    data = await loadFromDb(args.session);
  } else {
    console.error('Usage: tsx evals/feasibility.ts --fixture <path> | --session <sessionId>');
    process.exit(1);
    return;
  }

  const result = await runFeasibilityEval(data.session, data.shortlistItems, data.toolCallLog);

  if (result.pass) {
    console.log('PASS: Feasibility eval passed.');
  } else {
    console.log('FAIL: Feasibility eval failed with the following issues:');
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}

// tsx runs this file via esbuild, which shims `import.meta.url` even under CJS
// output, so this main-module check works regardless of package.json's "type".
const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run evals/feasibility.test.ts`
Expected: PASS — 3 tests, all green.

- [ ] **Step 5: Manually verify the CLI against fixtures**

Run:
```bash
npx tsx evals/feasibility.ts --fixture evals/fixtures/feasibility-pass.json
```
Expected stdout: `PASS: Feasibility eval passed.` and exit code `0`.

```bash
npx tsx evals/feasibility.ts --fixture evals/fixtures/feasibility-budget-violation.json
```
Expected stdout: `FAIL: Feasibility eval failed with the following issues:` followed by two `-` lines mentioning `listing-2` and `listing-3`, and exit code `1` (check with `echo $?` on bash or `echo %errorlevel%` on cmd).

- [ ] **Step 6: Commit**

```bash
git add evals/feasibility.ts evals/feasibility.test.ts
git commit -m "feat: add rule-based Feasibility eval with CLI and Vitest suite"
```

---

### Task 3: Edit Correctness Eval

**Files:**
- Create: `evals/edit-correctness.ts`
- Test: `evals/edit-correctness.test.ts`

**Interfaces:**
- Consumes: `evals/types.ts` (`ShortlistItemWithListing`, `EditLogEntry`, `EditCorrectnessFixture`); `evals/fixtures/edit-correct.json`, `evals/fixtures/edit-buggy.json`.
- Produces: `export function runEditCorrectnessEval(beforeItems: ShortlistItemWithListing[], afterItems: ShortlistItemWithListing[], editLogEntry: EditLogEntry): { pass: boolean; failures: string[] }`. **Decision (per the brief's "your call, be explicit"):** `beforeItems`/`afterItems` are typed as `ShortlistItemWithListing[]` (i.e. `ShortlistItem & { listing: Listing }`) rather than bare `ShortlistItem[]` plus a separate lookup map — the joined `listing.rent` (or whichever field the edit's `EditIntent.field` names) is read directly off each item, avoiding an extra join step inside the eval. Matching is done by `listingId`, not by shortlist-item `id`, because `editLogEntry.output.changed`/`unchanged` contain **listing ids** per the orchestration-agent subsystem's canonical shape.

- [ ] **Step 1: Write the failing tests**

Create `evals/edit-correctness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runEditCorrectnessEval } from './edit-correctness';
import editCorrect from './fixtures/edit-correct.json';
import editBuggy from './fixtures/edit-buggy.json';
import type { EditCorrectnessFixture } from './types';

describe('runEditCorrectnessEval', () => {
  it('passes when only listings matching the edit intent changed', () => {
    const fixture = editCorrect as EditCorrectnessFixture;
    const result = runEditCorrectnessEval(fixture.beforeItems, fixture.afterItems, fixture.editLogEntry);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails and names the wrongly-changed listing when an unrelated row changed', () => {
    const fixture = editBuggy as EditCorrectnessFixture;
    const result = runEditCorrectnessEval(fixture.beforeItems, fixture.afterItems, fixture.editLogEntry);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('listing-4'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run evals/edit-correctness.test.ts`
Expected: FAIL — `Cannot find module './edit-correctness'`.

- [ ] **Step 3: Write `evals/edit-correctness.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ShortlistItemWithListing, EditLogEntry, EditCorrectnessFixture } from './types';

function satisfiesComparator(
  actual: number,
  comparator: '<=' | '>=' | '<' | '>' | '==',
  value: number
): boolean {
  switch (comparator) {
    case '<=':
      return actual <= value;
    case '>=':
      return actual >= value;
    case '<':
      return actual < value;
    case '>':
      return actual > value;
    case '==':
      return actual === value;
    default:
      return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function runEditCorrectnessEval(
  beforeItems: ShortlistItemWithListing[],
  afterItems: ShortlistItemWithListing[],
  editLogEntry: EditLogEntry
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  const beforeByListingId = new Map(beforeItems.map((item) => [item.listingId, item]));
  const afterByListingId = new Map(afterItems.map((item) => [item.listingId, item]));
  const changedSet = new Set(editLogEntry.output.changed);

  const allListingIds = new Set([...beforeByListingId.keys(), ...afterByListingId.keys()]);

  for (const listingId of allListingIds) {
    const before = beforeByListingId.get(listingId);
    const after = afterByListingId.get(listingId);

    if (!before || !after) {
      failures.push(
        `Listing ${listingId} is missing from ${!before ? 'beforeItems' : 'afterItems'}; edits must not add/remove shortlist rows`
      );
      continue;
    }

    const actuallyDiffers = before.status !== after.status || before.reason !== after.reason;
    const loggedAsChanged = changedSet.has(listingId);

    if (actuallyDiffers && !loggedAsChanged) {
      failures.push(
        `Listing ${listingId} (${after.listing.societyName}) changed status/reason but is not listed in editLogEntry.output.changed`
      );
    }

    if (!actuallyDiffers && loggedAsChanged) {
      failures.push(
        `Listing ${listingId} (${after.listing.societyName}) is listed in editLogEntry.output.changed but is byte-identical before/after`
      );
    }

    if (!loggedAsChanged && !deepEqual(before, after)) {
      failures.push(
        `Listing ${listingId} (${after.listing.societyName}) is not in editLogEntry.output.changed but differs between before and after (expected byte-identical)`
      );
    }
  }

  const { input: editIntent } = editLogEntry;
  if (editIntent.op === 'filter') {
    const { field, comparator, value } = editIntent;
    for (const listingId of changedSet) {
      const after = afterByListingId.get(listingId) ?? beforeByListingId.get(listingId);
      if (!after) continue;
      const fieldValue = (after.listing as unknown as Record<string, number>)[field];
      if (typeof fieldValue !== 'number') continue;
      if (satisfiesComparator(fieldValue, comparator, value)) {
        failures.push(
          `Listing ${listingId} (${after.listing.societyName}) was changed by a filter on ${field} ${comparator} ${value}, but its ${field} (${fieldValue}) actually satisfies that condition — it should not have been affected`
        );
      }
    }
  }
  // Semantic validation is implemented for `op: 'filter'` intents only — that is the
  // op kind ARCHITECTURE.md's example uses and the fixtures exercise. For `add`/
  // `requireAmenity` intents, only the before/after diff-consistency checks above run;
  // their exact semantics aren't pinned by the architecture doc, so this is a documented
  // scope limit, not a placeholder.

  return { pass: failures.length === 0, failures };
}

function parseArgs(argv: string[]): { fixture?: string } {
  const args: { fixture?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') args.fixture = argv[++i];
  }
  return args;
}

function loadFixture(path: string): EditCorrectnessFixture {
  return JSON.parse(readFileSync(path, 'utf-8')) as EditCorrectnessFixture;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixture) {
    console.error('Usage: tsx evals/edit-correctness.ts --fixture <path>');
    console.error(
      '(DB mode is not supported: lib/db/schema.ts per ARCHITECTURE.md §4 does not persist a pre-edit shortlist snapshot, so "before" state can only come from a fixture file.)'
    );
    process.exit(1);
    return;
  }

  const fixture = loadFixture(args.fixture);
  const result = runEditCorrectnessEval(fixture.beforeItems, fixture.afterItems, fixture.editLogEntry);

  if (result.pass) {
    console.log('PASS: Edit correctness eval passed.');
  } else {
    console.log('FAIL: Edit correctness eval failed with the following issues:');
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run evals/edit-correctness.test.ts`
Expected: PASS — 2 tests, both green.

- [ ] **Step 5: Manually verify the CLI against fixtures**

Run:
```bash
npx tsx evals/edit-correctness.ts --fixture evals/fixtures/edit-correct.json
```
Expected: `PASS: Edit correctness eval passed.`, exit code `0`.

```bash
npx tsx evals/edit-correctness.ts --fixture evals/fixtures/edit-buggy.json
```
Expected: `FAIL: Edit correctness eval failed with the following issues:` with a line mentioning `listing-4`, exit code `1`.

- [ ] **Step 6: Commit**

```bash
git add evals/edit-correctness.ts evals/edit-correctness.test.ts
git commit -m "feat: add rule-based Edit Correctness eval with CLI and Vitest suite"
```

---

### Task 4: Grounding & Hallucination Eval

**Files:**
- Create: `evals/grounding.ts`
- Test: `evals/grounding.test.ts`

**Interfaces:**
- Consumes: `evals/types.ts` (`TranscriptEntry`, `ShortlistItemWithListing`, `GroundingFixture`); `evals/fixtures/grounding-fully-grounded.json`, `evals/fixtures/grounding-no-citation.json`, `evals/fixtures/grounding-citation-mismatch.json`, `evals/fixtures/grounding-uncertainty-stated.json`; `ai`'s `generateObject`; `@ai-sdk/groq`'s `groq(modelId)`; `zod`.
- Produces: `export async function runGroundingEval(transcript: TranscriptEntry[], shortlistItems: ShortlistItemWithListing[]): Promise<{ pass: boolean; failures: string[] }>`.

- [ ] **Step 1: Confirm/add required dependencies**

Run: `npm ls ai @ai-sdk/groq zod`
If any are missing (not already installed by the scaffold plan per `docs/ARCHITECTURE.md` §1's Groq/AI SDK decision), install them:
```bash
npm install ai @ai-sdk/groq zod
```

- [ ] **Step 2: Write the failing tests**

Create `evals/grounding.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateObjectMock = vi.fn();
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));
vi.mock('@ai-sdk/groq', () => ({
  groq: (modelId: string) => ({ modelId }),
}));

import { runGroundingEval } from './grounding';
import groundedFixture from './fixtures/grounding-fully-grounded.json';
import noCitationFixture from './fixtures/grounding-no-citation.json';
import mismatchFixture from './fixtures/grounding-citation-mismatch.json';
import uncertaintyFixture from './fixtures/grounding-uncertainty-stated.json';
import type { GroundingFixture } from './types';

describe('runGroundingEval', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it('passes for a fully-grounded, correctly cited claim', async () => {
    generateObjectMock.mockResolvedValue({
      object: { supported: true, reasoning: 'The chunk text confirms the claim.' },
    });
    const fixture = groundedFixture as GroundingFixture;
    const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails when a neighborhood claim has no citation and no stated uncertainty', async () => {
    const fixture = noCitationFixture as GroundingFixture;
    const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);
    expect(result.pass).toBe(false);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('fails when the cited source does not actually support the claim', async () => {
    generateObjectMock.mockResolvedValue({
      object: { supported: false, reasoning: 'The source says the nearest metro is kilometers away.' },
    });
    const fixture = mismatchFixture as GroundingFixture;
    const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('does not support the claim'))).toBe(true);
  });

  it('passes when uncertainty is explicitly stated instead of guessing', async () => {
    const fixture = uncertaintyFixture as GroundingFixture;
    const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);
    expect(result.pass).toBe(true);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run evals/grounding.test.ts`
Expected: FAIL — `Cannot find module './grounding'`.

- [ ] **Step 4: Write `evals/grounding.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateObject } from 'ai';
import { groq } from '@ai-sdk/groq';
import { z } from 'zod';
import type { TranscriptEntry, ShortlistItemWithListing, GroundingFixture } from './types';

const groundingJudgeSchema = z.object({
  supported: z.boolean(),
  reasoning: z.string(),
});

// Case-insensitive substring check against a fixed list of uncertainty phrases.
// This is the exact, documented rule for "uncertainty was explicitly stated":
// if the transcript entry's content contains any of these phrases, missing
// citations on that entry are not treated as a hallucination-risk failure.
const UNCERTAINTY_PHRASES = [
  "don't have reliable data",
  'do not have reliable data',
  'no reliable data',
  "don't have enough information",
  'do not have enough information',
  'unavailable',
  'uncertain',
  "can't confirm",
  'cannot confirm',
];

function statesUncertainty(content: string): boolean {
  const lower = content.toLowerCase();
  return UNCERTAINTY_PHRASES.some((phrase) => lower.includes(phrase));
}

const NEIGHBORHOOD_CLAIM_PATTERN = /neighbo(u)?rhood|safe|safety|transit|metro|commute|amenit|area|locality/i;

async function judgeClaimSupport(
  claim: string,
  chunkText: string
): Promise<{ supported: boolean; reasoning: string }> {
  const { object } = await generateObject({
    model: groq('llama-3.3-70b-versatile'),
    schema: groundingJudgeSchema,
    prompt: `You are fact-checking a neighborhood claim made by a real-estate assistant against its cited source text.

Claim: "${claim}"

Cited source text: "${chunkText}"

Does the cited source text actually support the claim? Respond with supported=true only if the source text directly backs up what the claim states. If the source contradicts the claim, is silent on it, or is only loosely related, respond supported=false and explain why in reasoning.`,
  });
  return object;
}

function extractListingMentions(
  content: string,
  shortlistItems: ShortlistItemWithListing[]
): ShortlistItemWithListing[] {
  return shortlistItems.filter(
    (item) => content.includes(item.listingId) || content.includes(item.listing.societyName)
  );
}

export async function runGroundingEval(
  transcript: TranscriptEntry[],
  shortlistItems: ShortlistItemWithListing[]
): Promise<{ pass: boolean; failures: string[] }> {
  const failures: string[] = [];

  for (const [index, entry] of transcript.entries()) {
    if (entry.role !== 'assistant') continue;

    const mentionedListings = extractListingMentions(entry.content, shortlistItems);
    for (const item of mentionedListings) {
      if (item.listing.availabilityStatus !== 'available') {
        failures.push(
          `Transcript entry ${index}: references listing ${item.listingId} (${item.listing.societyName}), which is not marked "available"`
        );
      }
    }

    const looksLikeNeighborhoodClaim = NEIGHBORHOOD_CLAIM_PATTERN.test(entry.content);
    const hasCitations = Boolean(entry.citations && entry.citations.length > 0);

    if (looksLikeNeighborhoodClaim && !hasCitations) {
      if (!statesUncertainty(entry.content)) {
        failures.push(
          `Transcript entry ${index}: makes a neighborhood claim with no citation and no stated uncertainty ("${entry.content.slice(0, 80)}...")`
        );
      }
      continue;
    }

    if (hasCitations) {
      for (const citation of entry.citations!) {
        const judgment = await judgeClaimSupport(entry.content, citation.chunkText);
        if (!judgment.supported) {
          failures.push(
            `Transcript entry ${index}: citation "${citation.sourceTitle}" (${citation.sourceUrl}) does not support the claim — judge reasoning: ${judgment.reasoning}`
          );
        }
      }
    }
  }

  return { pass: failures.length === 0, failures };
}

function parseArgs(argv: string[]): { fixture?: string } {
  const args: { fixture?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') args.fixture = argv[++i];
  }
  return args;
}

function loadFixture(path: string): GroundingFixture {
  return JSON.parse(readFileSync(path, 'utf-8')) as GroundingFixture;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixture) {
    console.error('Usage: tsx evals/grounding.ts --fixture <path>');
    console.error(
      '(DB mode is not supported: lib/db/schema.ts per ARCHITECTURE.md §4 has no transcript table/column, so transcripts can only be supplied via a fixture file for now.)'
    );
    process.exit(1);
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    console.error(
      'GROQ_API_KEY is not set. The grounding eval calls Groq via generateObject to judge citation support; set GROQ_API_KEY for a live run (Vitest tests mock this call instead).'
    );
    process.exit(1);
    return;
  }

  const fixture = loadFixture(args.fixture);
  const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);

  if (result.pass) {
    console.log('PASS: Grounding eval passed.');
  } else {
    console.log('FAIL: Grounding eval failed with the following issues:');
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run evals/grounding.test.ts`
Expected: PASS — 4 tests, all green. Confirm no real network call was attempted (the suite mocks `ai`'s `generateObject` entirely, so this passes with zero credentials).

- [ ] **Step 6: Manually verify the CLI against a fixture (requires a live `GROQ_API_KEY`)**

Run:
```bash
GROQ_API_KEY=<your-key> npx tsx evals/grounding.ts --fixture evals/fixtures/grounding-fully-grounded.json
```
Expected: `PASS: Grounding eval passed.`, exit code `0` (assuming the live Groq judge agrees the citation supports the claim — if it doesn't, inspect the printed failure reasoning, this is expected LLM-assisted variance and not a bug in the eval script itself).

Run without `GROQ_API_KEY` set to confirm the fail-fast message:
```bash
npx tsx evals/grounding.ts --fixture evals/fixtures/grounding-fully-grounded.json
```
Expected: prints the `GROQ_API_KEY is not set` message and exits `1`.

- [ ] **Step 7: Commit**

```bash
git add evals/grounding.ts evals/grounding.test.ts
git commit -m "feat: add LLM-assisted Grounding & Hallucination eval with CLI and Vitest suite"
```

---

### Task 5: `package.json` Eval Scripts

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `evals/feasibility.ts`, `evals/edit-correctness.ts`, `evals/grounding.ts` (Tasks 2–4); their default fixture files from Task 1.
- Produces: `npm run eval:feasibility`, `npm run eval:edit-correctness`, `npm run eval:grounding`, `npm run eval:all` — the four CLI entrypoints the spec's "must be runnable" requirement needs.

- [ ] **Step 1: Confirm `tsx` is available**

Run: `npx tsx --version`
If this fails (not installed), add it as a dev dependency:
```bash
npm install --save-dev tsx
```

- [ ] **Step 2: Add the eval scripts to `package.json`**

Open `package.json`. In the existing `"scripts"` object (created by the scaffold plan — keep every existing entry, e.g. `dev`, `build`, `start`, `test`, untouched), add these four keys:

```json
{
  "scripts": {
    "eval:feasibility": "tsx evals/feasibility.ts",
    "eval:edit-correctness": "tsx evals/edit-correctness.ts",
    "eval:grounding": "tsx evals/grounding.ts",
    "eval:all": "npm run eval:feasibility -- --fixture evals/fixtures/feasibility-pass.json && npm run eval:edit-correctness -- --fixture evals/fixtures/edit-correct.json && npm run eval:grounding -- --fixture evals/fixtures/grounding-fully-grounded.json"
  }
}
```

`eval:feasibility`/`eval:edit-correctness`/`eval:grounding` take no default arguments — pass `-- --fixture <path>` or (feasibility only) `-- --session <id>` when invoking them directly, e.g. `npm run eval:feasibility -- --fixture evals/fixtures/feasibility-budget-violation.json`. `eval:all` is a self-contained smoke run against the shipped passing fixtures, chained with `&&` so it stops (non-zero exit) at the first failing eval; `eval:grounding` (and therefore `eval:all`) requires a live `GROQ_API_KEY` to run for real, per Task 4 Step 6.

- [ ] **Step 3: Verify each script runs**

Run:
```bash
npm run eval:feasibility -- --fixture evals/fixtures/feasibility-pass.json
```
Expected: `PASS: Feasibility eval passed.`

```bash
npm run eval:edit-correctness -- --fixture evals/fixtures/edit-correct.json
```
Expected: `PASS: Edit correctness eval passed.`

```bash
GROQ_API_KEY=<your-key> npm run eval:all
```
Expected: all three PASS lines print in sequence, final exit code `0`. (Without a real key, the run stops at the grounding step with the `GROQ_API_KEY is not set` message and exit code `1` — expected, per Task 4 Step 6.)

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add eval:feasibility/eval:edit-correctness/eval:grounding/eval:all npm scripts"
```

---

## Self-Review Notes

- **Spec coverage:** Feasibility Eval (budget/must-haves + commute consistency) → Task 2. Edit Correctness Eval (only intended parts change, no unintended changes) → Task 3. Grounding & Hallucination Eval (listings map to available records, neighborhood claims cite sources, uncertainty stated when data missing) → Task 4, rules (a)/(b)/(c) each implemented as a distinct code path. Fixtures for all of the above, including both a correct and a buggy `applyShortlistEdit` log and all 4 required transcript variants → Task 1. `npm run eval:*` runnability → Task 5. All three scripts are rule-based except Grounding's citation-support check, which is LLM-assisted via Groq/`generateObject`/Zod per the architecture decision, and is mocked in every Vitest suite that touches it.
- **Placeholder scan:** No TBD/"add error handling"/"similar to Task N" language; every step has complete, runnable code or a fully written JSON fixture.
- **Type consistency:** `ShortlistItemWithListing`, `EditLogEntry`, `TranscriptEntry`, `FeasibilityFixture`, `EditCorrectnessFixture`, `GroundingFixture` are defined once in `evals/types.ts` (Task 1) and imported by name, unchanged, in Tasks 2–4. `runFeasibilityEval`'s third parameter (`toolCallLogEntries`), `runEditCorrectnessEval`'s listing-id-keyed matching, and `runGroundingEval`'s two-argument signature are each used consistently between their implementation and their Vitest suite.
