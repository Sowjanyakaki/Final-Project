# Data Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline data-ingestion subsystem that populates `listings` (scraped from bengaluru.rent, PII-stripped) and `neighborhood_docs` (Wikipedia text, chunked + locally embedded) so every downstream subsystem (orchestration/RAG, UI, evals) has real, grounded data to work with.

**Architecture:** Two small library modules (`stripPII`, `embedText`) are dependencies of two standalone Node scripts (`scrape-listings.ts`, `ingest-neighborhood-docs.ts`). Every script is split into pure, unit-testable logic (parsing/chunking/mapping) versus thin I/O shells (Playwright, `fetch`, Drizzle `db` calls) so `npm test` never touches the network, a browser, or a real database.

**Tech Stack:** TypeScript, Drizzle ORM (`NodePgDatabase`), `@xenova/transformers` (local embeddings, `Xenova/all-MiniLM-L6-v2`, 384-dim), Playwright (scraping), native `fetch` (Wikipedia API), Vitest (all tests, fully mocked).

## Global Constraints

- No PII (owner/agent names, phone numbers) anywhere in the dataset, UI, or logs — this is a hard requirement; enforced by `stripPII` before any scraped record touches the DB.
- Only pins currently marked available go into the working set; pins explicitly marked "Not for rent" (transparency-only) must be excluded.
- Listings are upserted keyed by `sourceUrl` (insert-or-update), never duplicated.
- Embeddings are produced locally, in-process, via `@xenova/transformers`'s `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')` — never an external embeddings API call. `neighborhood_docs.embedding` is `vector(384)` storing `number[]`.
- Neighborhood RAG corpus is scoped to a fixed, documented default locality list: `["Koramangala", "HSR Layout", "Indiranagar", "Whitefield", "Jayanagar"]` (editable later, not a placeholder).
- All tests use Vitest. Every external call (`fetch`, Playwright, the `@xenova/transformers` pipeline, the DB client) is mocked at the module boundary — `npm test` must pass with zero live credentials and zero network access.
- Chunking uses an approximate, word-count-based token estimate (no real tokenizer dependency needed).

### Assumptions inherited from the prerequisite "Project Scaffold & Database" plan

This plan assumes that plan has already run and produced, exactly:

- `lib/db/client.ts` exporting `export const db: NodePgDatabase<typeof schema>`.
- `lib/db/schema.ts` exporting Drizzle tables matching `docs/ARCHITECTURE.md` §4, in particular:
  - `listings`: `id, sourceUrl, societyName, locality, lat, lng, rent, bedrooms, furnishing, amenities, sqft, availabilityStatus, scrapedAt` (camelCase). **`sourceUrl` must carry a `UNIQUE` constraint** — required for the `onConflictDoUpdate` upsert in Task 3. If the scaffold plan didn't add one, flag it in code review before merging Task 3; do not silently work around it with a manual select-then-insert/update, since that would race under repeated scraper runs.
  - `neighborhoodDocs`: `id, locality, sourceTitle, sourceUrl, chunkText, embedding, fetchedAt` (camelCase; `embedding` is a custom `vector(384)` column typed as `number[]` in Drizzle).
- `npm test` already runs (Vitest configured, picks up colocated `*.test.ts` files).
- `package.json` and `.env.local.example` already exist (this plan only *adds* script entries and dependencies to them, never restructures them).

If any of the above names/shapes differ from what actually landed in `lib/db/schema.ts`, adjust the property names used in Tasks 3–4 accordingly — the logic and test shapes stay the same either way.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/pii/stripPII.ts` | `RawScrapedListing`/`CleanListing` types + `stripPII()` — allowlist-based PII removal. |
| `lib/pii/stripPII.test.ts` | Unit tests for `stripPII`. |
| `lib/rag/embed.ts` | `embedText()` — local MiniLM embedding, mean-pooled, normalized, shaped to 384 dims. |
| `lib/rag/embed.test.ts` | Unit tests for `embedText`, with `@xenova/transformers` mocked. |
| `scripts/scrape-listings.ts` | `parsePin()` (pure), `upsertListing()` (thin DB wrapper), `scrapeAndStore()` (Playwright I/O shell, script entry point). |
| `scripts/scrape-listings.test.ts` | Unit tests for `parsePin` and `upsertListing` (Playwright itself is not unit-tested). |
| `scripts/ingest-neighborhood-docs.ts` | `DEFAULT_LOCALITIES`, `chunkText()` (pure), `wikipediaApiUrl()` (pure), `fetchLocalityPage()` (thin fetch wrapper), `ingestLocality()` (orchestrates fetch→chunk→embed→delete/insert), script entry point. |
| `scripts/ingest-neighborhood-docs.test.ts` | Unit tests for `chunkText`, `fetchLocalityPage`, `ingestLocality` (fetch/embed/db all mocked). |

**Interfaces this subsystem produces for other subsystems (per `docs/ARCHITECTURE.md`):**
- `embedText(text: string): Promise<number[]>` from `lib/rag/embed.ts` — the orchestration/RAG subsystem's `retrieveNeighborhoodDocs` tool must reuse this exact function to embed the user's query at retrieval time (same model, same 384-dim space as what's stored).
- Populated `listings` and `neighborhoodDocs` tables — consumed by the orchestration subsystem's `searchListings`/`retrieveNeighborhoodDocs` tools, the companion UI, and the evals suite.
- `stripPII(record: RawScrapedListing): CleanListing` from `lib/pii/stripPII.ts` — available for reuse anywhere else in the codebase that might handle raw scraped-shaped records (e.g. future re-scraping paths); no other in-scope subsystem currently calls it directly.

---

## Task 1: PII Stripping

**Files:**
- Create: `lib/pii/stripPII.ts`
- Test: `lib/pii/stripPII.test.ts`

**Interfaces:**
- Consumes: nothing (no dependencies on other tasks).
- Produces: `export interface RawScrapedListing`, `export interface CleanListing`, `export function stripPII(record: RawScrapedListing): CleanListing`. Task 3 imports all three from this file.

- [ ] **Step 1: Write the failing tests**

Create `lib/pii/stripPII.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripPII, type RawScrapedListing } from './stripPII';

const baseRecord: RawScrapedListing = {
  sourceUrl: 'https://bengaluru.rent/listing/abc123',
  societyName: 'Prestige Lakeside Habitat',
  locality: 'Koramangala',
  lat: 12.9352,
  lng: 77.6146,
  rent: 35000,
  bedrooms: 2,
  furnishing: 'semi-furnished',
  amenities: ['parking', 'gym'],
  sqft: 1100,
  availabilityStatus: 'available',
};

describe('stripPII', () => {
  it('removes owner/agent/contact-style fields while keeping legitimate fields', () => {
    const raw: RawScrapedListing = {
      ...baseRecord,
      ownerName: 'Ramesh Kumar',
      agentName: 'Sunita Realty Agent',
      contactName: 'Ramesh',
      phone: '+91-9876543210',
      phoneNumber: '9876543210',
      whatsapp: '+919876543210',
    };

    const clean = stripPII(raw);

    expect(clean).not.toHaveProperty('ownerName');
    expect(clean).not.toHaveProperty('agentName');
    expect(clean).not.toHaveProperty('contactName');
    expect(clean).not.toHaveProperty('phone');
    expect(clean).not.toHaveProperty('phoneNumber');
    expect(clean).not.toHaveProperty('whatsapp');

    expect(clean).toEqual({
      sourceUrl: baseRecord.sourceUrl,
      societyName: baseRecord.societyName,
      locality: baseRecord.locality,
      lat: baseRecord.lat,
      lng: baseRecord.lng,
      rent: baseRecord.rent,
      bedrooms: baseRecord.bedrooms,
      furnishing: baseRecord.furnishing,
      amenities: baseRecord.amenities,
      sqft: baseRecord.sqft,
      availabilityStatus: baseRecord.availabilityStatus,
    });
  });

  it('drops PII fields even under unexpected/unknown key names', () => {
    const raw = {
      ...baseRecord,
      owner_contact: 'Ramesh, +91-9876543210',
      brokerMobile: '9876543210',
    } as RawScrapedListing;

    const clean = stripPII(raw);

    expect(clean).not.toHaveProperty('owner_contact');
    expect(clean).not.toHaveProperty('brokerMobile');
    expect(Object.keys(clean).sort()).toEqual(
      [
        'sourceUrl',
        'societyName',
        'locality',
        'lat',
        'lng',
        'rent',
        'bedrooms',
        'furnishing',
        'amenities',
        'sqft',
        'availabilityStatus',
      ].sort()
    );
  });

  it('passes a record with no PII fields through unchanged', () => {
    const clean = stripPII(baseRecord);
    expect(clean).toEqual(baseRecord);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/pii/stripPII.test.ts`
Expected: FAIL — `Cannot find module './stripPII'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/pii/stripPII.ts`:

```ts
/**
 * Raw shape as scraped off bengaluru.rent map pins, before PII removal.
 * Any owner/agent/contact-style field that might appear on a scraped pin is
 * declared here so parsePin() (scripts/scrape-listings.ts) has somewhere
 * type-safe to put it — but stripPII() below NEVER reads these fields back
 * out. The index signature tolerates any other unexpected raw field without
 * ever leaking it into CleanListing.
 */
export interface RawScrapedListing {
  sourceUrl: string;
  societyName: string | null;
  locality: string | null;
  lat: number | null;
  lng: number | null;
  rent: number | null;
  bedrooms: number | null;
  furnishing: string | null;
  amenities: string[];
  sqft: number | null;
  availabilityStatus: 'available' | 'not_for_rent';
  ownerName?: string;
  agentName?: string;
  contactName?: string;
  phone?: string;
  phoneNumber?: string;
  whatsapp?: string;
  [extraField: string]: unknown;
}

/** PII-free record shape allowed to reach the DB, UI, or logs. */
export interface CleanListing {
  sourceUrl: string;
  societyName: string | null;
  locality: string | null;
  lat: number | null;
  lng: number | null;
  rent: number | null;
  bedrooms: number | null;
  furnishing: string | null;
  amenities: string[];
  sqft: number | null;
  availabilityStatus: 'available' | 'not_for_rent';
}

/**
 * Strips PII by allowlisting only known-safe fields onto a brand-new object.
 * This is deliberately an allowlist (not a denylist of "name"/"phone"-shaped
 * keys) so that any current or future PII-risk field — however it's named on
 * the source site — can never leak through just because we didn't think to
 * ban that exact key name.
 */
export function stripPII(record: RawScrapedListing): CleanListing {
  return {
    sourceUrl: record.sourceUrl,
    societyName: record.societyName,
    locality: record.locality,
    lat: record.lat,
    lng: record.lng,
    rent: record.rent,
    bedrooms: record.bedrooms,
    furnishing: record.furnishing,
    amenities: record.amenities,
    sqft: record.sqft,
    availabilityStatus: record.availabilityStatus,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/pii/stripPII.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pii/stripPII.ts lib/pii/stripPII.test.ts
git commit -m "feat(ingestion): add allowlist-based PII stripping for scraped listings"
```

---

## Task 2: Local Text Embedding

**Files:**
- Create: `lib/rag/embed.ts`
- Test: `lib/rag/embed.test.ts`
- Modify: `package.json` (add `@xenova/transformers` dependency)

**Interfaces:**
- Consumes: nothing (no dependencies on other tasks).
- Produces: `export async function embedText(text: string): Promise<number[]>` — always resolves to exactly 384 numbers. Task 4 imports this. The orchestration subsystem's RAG retrieval tool (separate plan) must also import this exact function for query-time embedding.

- [ ] **Step 1: Install the dependency**

Run: `npm install @xenova/transformers`
Expected: `package.json` `dependencies` now includes `@xenova/transformers`.

- [ ] **Step 2: Write the failing tests**

Create `lib/rag/embed.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
}));

describe('embedText', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls the feature-extraction pipeline with the MiniLM model, mean pooling and normalization', async () => {
    const fakeData = new Float32Array(384).fill(0.5);
    const fakeExtractor = vi.fn().mockResolvedValue({ data: fakeData });
    const { pipeline } = await import('@xenova/transformers');
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeExtractor);

    const { embedText } = await import('./embed');
    const result = await embedText('Koramangala is a vibrant neighborhood.');

    expect(pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    expect(fakeExtractor).toHaveBeenCalledWith('Koramangala is a vibrant neighborhood.', {
      pooling: 'mean',
      normalize: true,
    });
    expect(result).toHaveLength(384);
    expect(result[0]).toBeCloseTo(0.5);
  });

  it('reuses a single cached pipeline instance across multiple calls', async () => {
    const fakeData = new Float32Array(384).fill(0.1);
    const fakeExtractor = vi.fn().mockResolvedValue({ data: fakeData });
    const { pipeline } = await import('@xenova/transformers');
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeExtractor);

    const { embedText } = await import('./embed');
    await embedText('first chunk');
    await embedText('second chunk');

    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(fakeExtractor).toHaveBeenCalledTimes(2);
  });

  it('truncates output longer than 384 dims', async () => {
    const fakeData = new Float32Array(400).fill(0.2);
    const fakeExtractor = vi.fn().mockResolvedValue({ data: fakeData });
    const { pipeline } = await import('@xenova/transformers');
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeExtractor);

    const { embedText } = await import('./embed');
    const result = await embedText('long output');

    expect(result).toHaveLength(384);
  });

  it('zero-pads output shorter than 384 dims', async () => {
    const fakeData = new Float32Array(300).fill(0.3);
    const fakeExtractor = vi.fn().mockResolvedValue({ data: fakeData });
    const { pipeline } = await import('@xenova/transformers');
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeExtractor);

    const { embedText } = await import('./embed');
    const result = await embedText('short output');

    expect(result).toHaveLength(384);
    expect(result[299]).toBeCloseTo(0.3);
    expect(result[300]).toBe(0);
    expect(result[383]).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- lib/rag/embed.test.ts`
Expected: FAIL — `Cannot find module './embed'` (file doesn't exist yet).

- [ ] **Step 4: Write the implementation**

Create `lib/rag/embed.ts`:

```ts
import { pipeline } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

// Lazily created once per process, then reused — loading the model on every
// call would be far too slow for ingesting hundreds of chunks/listings.
let extractorPromise: ReturnType<typeof pipeline> | null = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_NAME);
  }
  return extractorPromise;
}

/**
 * Embeds text locally via a MiniLM sentence-embedding model (no external API
 * call). Output is mean-pooled, L2-normalized, and defensively shaped to
 * exactly 384 dims to match the `neighborhood_docs.embedding vector(384)`
 * column, regardless of what the underlying model happens to return.
 *
 * NOTE (plan comment, not a task): this unit test suite mocks
 * `@xenova/transformers` entirely. An optional, slower integration test that
 * runs the real model end-to-end and checks embedding similarity is out of
 * scope for this plan.
 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const raw = Array.from(output.data as ArrayLike<number>);

  if (raw.length === EMBEDDING_DIM) {
    return raw;
  }
  if (raw.length > EMBEDDING_DIM) {
    return raw.slice(0, EMBEDDING_DIM);
  }
  return [...raw, ...new Array(EMBEDDING_DIM - raw.length).fill(0)];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- lib/rag/embed.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/rag/embed.ts lib/rag/embed.test.ts package.json package-lock.json
git commit -m "feat(ingestion): add local MiniLM text embedding via @xenova/transformers"
```

---

## Task 3: Listings Scraper

**Files:**
- Create: `scripts/scrape-listings.ts`
- Test: `scripts/scrape-listings.test.ts`
- Modify: `package.json` (add `playwright` devDependency and a `scrape:listings` script)

**Interfaces:**
- Consumes: `stripPII`, `RawScrapedListing`, `CleanListing` from `lib/pii/stripPII.ts` (Task 1); `db` (`NodePgDatabase<typeof schema>`) from `lib/db/client.ts` and `listings` table from `lib/db/schema.ts` (Scaffold plan, already built).
- Produces: `export function parsePin(rawPinData: unknown): RawScrapedListing | null`, `export async function upsertListing(record: CleanListing, dbClient?: Pick<typeof db, 'insert'>): Promise<void>`. No other in-scope task consumes these directly, but the populated `listings` table is consumed by the orchestration/UI/evals subsystems.

- [ ] **Step 1: Install Playwright**

Run: `npm install -D playwright`
Run: `npx playwright install chromium`
Expected: `package.json` `devDependencies` now includes `playwright`; Chromium binary downloaded (needed only for the live scrape, not for the unit tests in this task).

- [ ] **Step 2: Write the failing tests for `parsePin`**

Create `scripts/scrape-listings.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { parsePin } from './scrape-listings';

describe('parsePin', () => {
  it('maps an available pin into a RawScrapedListing, defaulting availabilityStatus to available', () => {
    const rawPin = {
      id: 'pin-42',
      url: 'https://bengaluru.rent/listing/pin-42',
      status: 'Available',
      rent: 35000,
      bedrooms: 2,
      furnishing: 'semi-furnished',
      amenities: ['parking', 'gym'],
      societyName: 'Prestige Lakeside Habitat',
      sqft: 1100,
      lat: 12.9352,
      lng: 77.6146,
      locality: 'Koramangala',
      ownerName: 'Ramesh Kumar',
      phone: '+91-9876543210',
    };

    const parsed = parsePin(rawPin);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      sourceUrl: 'https://bengaluru.rent/listing/pin-42',
      rent: 35000,
      bedrooms: 2,
      furnishing: 'semi-furnished',
      amenities: ['parking', 'gym'],
      societyName: 'Prestige Lakeside Habitat',
      sqft: 1100,
      lat: 12.9352,
      lng: 77.6146,
      locality: 'Koramangala',
      availabilityStatus: 'available',
    });
    // PII fields pass through here (parsePin runs before stripPII in the pipeline).
    expect(parsed?.ownerName).toBe('Ramesh Kumar');
  });

  it('returns null for a pin explicitly marked "Not for rent" (any casing)', () => {
    const notForRent = {
      id: 'pin-99',
      url: 'https://bengaluru.rent/listing/pin-99',
      status: 'NOT FOR RENT',
      rent: 40000,
    };
    expect(parsePin(notForRent)).toBeNull();

    const notForRentMixedCase = { ...notForRent, status: 'Not For Rent' };
    expect(parsePin(notForRentMixedCase)).toBeNull();
  });

  it('returns null when there is no usable identifier for sourceUrl', () => {
    const noIdentifier = {
      status: 'Available',
      rent: 30000,
    };
    expect(parsePin(noIdentifier)).toBeNull();
  });

  it('does not throw on missing/malformed optional fields, and nulls them out', () => {
    const malformed = {
      id: 'pin-7',
      status: 'Available',
      rent: 'ask owner',
      bedrooms: undefined,
      sqft: 'N/A',
      amenities: 'parking, gym',
      lat: null,
      lng: null,
      locality: '',
    };

    const parsed = parsePin(malformed);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      sourceUrl: 'https://bengaluru.rent/listing/pin-7',
      rent: null,
      bedrooms: null,
      sqft: null,
      amenities: [],
      lat: null,
      lng: null,
      locality: null,
      availabilityStatus: 'available',
    });
  });

  it('returns null for non-object input instead of throwing', () => {
    expect(parsePin(null)).toBeNull();
    expect(parsePin(undefined)).toBeNull();
    expect(parsePin('not a pin')).toBeNull();
    expect(parsePin(42)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- scripts/scrape-listings.test.ts`
Expected: FAIL — `Cannot find module './scrape-listings'`.

- [ ] **Step 4: Implement `parsePin`**

Create `scripts/scrape-listings.ts` (this first pass only needs `parsePin` to satisfy the current tests; `upsertListing` and the Playwright shell are added in later steps of this same task):

```ts
import type { RawScrapedListing } from '../lib/pii/stripPII';

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Maps one raw bengaluru.rent map-pin object (shape as returned by the page's
 * own pin-data structure — see the "Manual/Integration Verification" note in
 * this task for how that raw shape gets extracted from the live site) into a
 * RawScrapedListing, or returns null when the pin should be excluded.
 *
 * Pure function: no network, no Playwright, no DB — fully unit-testable.
 *
 * Returns null when:
 *  - rawPinData isn't a usable object, OR
 *  - the pin's status text indicates "Not for rent" (transparency-only pin
 *    per the spec — must be excluded from the working set), OR
 *  - there's no usable identifier (url or id) to build a sourceUrl from,
 *    since upsertListing() keys on sourceUrl and an un-keyable pin can't be
 *    deduped on a later re-scrape.
 *
 * Any other missing/malformed optional field (rent, bedrooms, sqft,
 * amenities, lat/lng, locality, furnishing, societyName) is nulled out
 * (or, for amenities, defaulted to []) rather than causing a throw or a
 * null return — the pin is still usable, just with gaps.
 */
export function parsePin(rawPinData: unknown): RawScrapedListing | null {
  if (typeof rawPinData !== 'object' || rawPinData === null) {
    return null;
  }
  const pin = rawPinData as Record<string, unknown>;

  const status = typeof pin.status === 'string' ? pin.status.trim().toLowerCase() : '';
  if (status.includes('not for rent')) {
    return null;
  }

  const sourceUrl =
    toStringOrNull(pin.url) ??
    (toStringOrNull(pin.id) ? `https://bengaluru.rent/listing/${pin.id}` : null);
  if (!sourceUrl) {
    return null;
  }

  return {
    sourceUrl,
    societyName: toStringOrNull(pin.societyName) ?? toStringOrNull(pin.society),
    locality: toStringOrNull(pin.locality),
    lat: toNumberOrNull(pin.lat),
    lng: toNumberOrNull(pin.lng),
    rent: toNumberOrNull(pin.rent),
    bedrooms: toNumberOrNull(pin.bedrooms),
    furnishing: toStringOrNull(pin.furnishing),
    amenities: toStringArray(pin.amenities),
    sqft: toNumberOrNull(pin.sqft),
    availabilityStatus: 'available',
    ownerName: toStringOrNull(pin.ownerName) ?? undefined,
    agentName: toStringOrNull(pin.agentName) ?? undefined,
    contactName: toStringOrNull(pin.contactName) ?? undefined,
    phone: toStringOrNull(pin.phone) ?? undefined,
    phoneNumber: toStringOrNull(pin.phoneNumber) ?? undefined,
    whatsapp: toStringOrNull(pin.whatsapp) ?? undefined,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- scripts/scrape-listings.test.ts`
Expected: PASS (5 `parsePin` tests).

- [ ] **Step 6: Write the failing tests for `upsertListing`**

Append to `scripts/scrape-listings.test.ts`:

```ts
import { upsertListing } from './scrape-listings';
import { listings } from '../lib/db/schema';
import type { CleanListing } from '../lib/pii/stripPII';

describe('upsertListing', () => {
  const cleanRecord: CleanListing = {
    sourceUrl: 'https://bengaluru.rent/listing/pin-42',
    societyName: 'Prestige Lakeside Habitat',
    locality: 'Koramangala',
    lat: 12.9352,
    lng: 77.6146,
    rent: 35000,
    bedrooms: 2,
    furnishing: 'semi-furnished',
    amenities: ['parking', 'gym'],
    sqft: 1100,
    availabilityStatus: 'available',
  };

  it('inserts with an onConflictDoUpdate keyed by sourceUrl', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const fakeDb = { insert } as unknown as Parameters<typeof upsertListing>[1];

    await upsertListing(cleanRecord, fakeDb);

    expect(insert).toHaveBeenCalledWith(listings);
    expect(values).toHaveBeenCalledTimes(1);
    const insertedValues = values.mock.calls[0][0];
    expect(insertedValues).toMatchObject({
      sourceUrl: cleanRecord.sourceUrl,
      societyName: cleanRecord.societyName,
      rent: cleanRecord.rent,
      availabilityStatus: 'available',
    });
    expect(insertedValues.scrapedAt).toBeInstanceOf(Date);

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflictArg = onConflictDoUpdate.mock.calls[0][0];
    expect(conflictArg.target).toBe(listings.sourceUrl);
    expect(conflictArg.set).toMatchObject({
      societyName: cleanRecord.societyName,
      rent: cleanRecord.rent,
    });
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm test -- scripts/scrape-listings.test.ts`
Expected: FAIL — `upsertListing is not exported from './scrape-listings'`.

- [ ] **Step 8: Implement `upsertListing` and the Playwright script shell**

Append to `scripts/scrape-listings.ts`:

```ts
import { chromium } from 'playwright';
import { db } from '../lib/db/client';
import { listings } from '../lib/db/schema';
import { stripPII } from '../lib/pii/stripPII';
import type { CleanListing } from '../lib/pii/stripPII';

/**
 * Insert-or-update a listing keyed by sourceUrl. Accepts an optional
 * db-like client so tests can inject a mock instead of hitting Postgres.
 */
export async function upsertListing(
  record: CleanListing,
  dbClient: Pick<typeof db, 'insert'> = db
): Promise<void> {
  const columns = {
    societyName: record.societyName,
    locality: record.locality,
    lat: record.lat,
    lng: record.lng,
    rent: record.rent,
    bedrooms: record.bedrooms,
    furnishing: record.furnishing,
    amenities: record.amenities,
    sqft: record.sqft,
    availabilityStatus: record.availabilityStatus,
    scrapedAt: new Date(),
  };

  await dbClient
    .insert(listings)
    .values({ sourceUrl: record.sourceUrl, ...columns })
    .onConflictDoUpdate({
      target: listings.sourceUrl,
      set: columns,
    });
}

/**
 * Live scrape entry point. NOT unit-tested (see Manual/Integration
 * Verification note below) — drives a real browser against the real site.
 *
 * INTEGRATION TODO: `page.evaluate()` below extracts pins via a
 * `window.__MAP_PINS__` hook as a placeholder for "however bengaluru.rent
 * actually exposes its map-pin data" (a global JSON blob, a `<script>` tag,
 * or an XHR/fetch call the map makes on load — inspect the live site with
 * Playwright codegen (`npx playwright codegen https://bengaluru.rent/`) or
 * browser devtools' Network tab to find the real source, then replace the
 * body of this `page.evaluate()` accordingly). `parsePin()` itself does not
 * need to change regardless of which extraction mechanism is used, as long
 * as each element of the array it receives has the raw pin fields parsePin
 * already handles (id/url, status, rent, bedrooms, furnishing, amenities,
 * societyName, sqft, lat, lng, locality, and any owner/agent/phone fields).
 */
async function scrapeAndStore(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('https://bengaluru.rent/', { waitUntil: 'networkidle' });

    const rawPins: unknown[] = await page.evaluate(() => {
      return (window as unknown as { __MAP_PINS__?: unknown[] }).__MAP_PINS__ ?? [];
    });

    let upserted = 0;
    let skipped = 0;
    for (const raw of rawPins) {
      const parsed = parsePin(raw);
      if (!parsed) {
        skipped++;
        continue;
      }
      const clean = stripPII(parsed);
      await upsertListing(clean);
      upserted++;
    }
    console.log(`[scrape-listings] upserted ${upserted} listings, skipped ${skipped} pins`);
  } finally {
    await browser.close();
  }
}

// Vitest sets process.env.VITEST during test runs — this keeps `import`ing
// this module for its pure functions from ever launching a real browser.
if (!process.env.VITEST) {
  scrapeAndStore().catch((err) => {
    console.error('[scrape-listings] failed:', err);
    process.exit(1);
  });
}
```

Add a script entry to `package.json`'s `"scripts"` section:

```json
"scrape:listings": "tsx scripts/scrape-listings.ts"
```

(If `tsx` isn't already a `devDependency` from the scaffold plan, run `npm install -D tsx` first.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- scripts/scrape-listings.test.ts`
Expected: PASS (6 tests total: 5 `parsePin` + 1 `upsertListing`).

- [ ] **Step 10: Manual/Integration Verification (not automated — do not attempt to unit-test this)**

Playwright browser automation itself is explicitly out of scope for the unit test suite in this task — `scrapeAndStore()` is a thin I/O shell with no branching logic worth unit-testing, and driving a real headless browser against a real third-party site inside `npm test` would violate the "zero live network" constraint. Instead, verify it manually once, after Step 9 passes:

1. Open `https://bengaluru.rent/` in a real browser with devtools open; use the Network tab (or `npx playwright codegen https://bengaluru.rent/`) to find how map pins are loaded (inline script JSON, a `window.*` global, or an XHR endpoint), and update the `page.evaluate()` body in `scrapeAndStore()` to match.
2. Run `npm run scrape:listings` against a real (e.g. local dev) Postgres instance with `DATABASE_URL` set.
3. Manually inspect a few resulting rows in `listings` (via `psql` or a DB GUI): confirm no owner/agent name or phone-shaped values appear in any column, confirm `availabilityStatus` is only ever `'available'` (no "Not for rent" pins came through), and confirm re-running the script updates existing rows by `sourceUrl` instead of duplicating them.

- [ ] **Step 11: Commit**

```bash
git add scripts/scrape-listings.ts scripts/scrape-listings.test.ts package.json package-lock.json
git commit -m "feat(ingestion): add bengaluru.rent listings scraper with PII stripping and upsert"
```

---

## Task 4: Neighborhood Doc Ingester

**Files:**
- Create: `scripts/ingest-neighborhood-docs.ts`
- Test: `scripts/ingest-neighborhood-docs.test.ts`
- Modify: `package.json` (add an `ingest:docs` script)

**Interfaces:**
- Consumes: `embedText` from `lib/rag/embed.ts` (Task 2); `db` from `lib/db/client.ts` and `neighborhoodDocs` table from `lib/db/schema.ts` (Scaffold plan).
- Produces: `export const DEFAULT_LOCALITIES: readonly string[]`, `export function chunkText(text: string, targetTokens?: number): string[]`, `export function wikipediaApiUrl(locality: string): string`, `export async function fetchLocalityPage(locality: string, fetchFn?: typeof fetch): Promise<{ title: string; url: string; text: string }>`, `export async function ingestLocality(locality: string, deps?: IngestLocalityDeps): Promise<number>`. No other in-scope task consumes these directly; the populated `neighborhoodDocs` table is consumed by the orchestration/UI/evals subsystems.

- [ ] **Step 1: Write the failing tests for `chunkText`**

Create `scripts/ingest-neighborhood-docs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chunkText } from './ingest-neighborhood-docs';

describe('chunkText', () => {
  it('returns an empty array for empty or whitespace-only text', () => {
    expect(chunkText('', 500)).toEqual([]);
    expect(chunkText('   \n\t  ', 500)).toEqual([]);
  });

  it('returns a single chunk for text shorter than the target size', () => {
    const shortText = Array.from({ length: 12 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(shortText, 500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(shortText);
  });

  it('splits long text into multiple chunks of approximately the target word count', () => {
    const longText = Array.from({ length: 1250 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(longText, 500);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].split(' ')).toHaveLength(500);
    expect(chunks[1].split(' ')).toHaveLength(500);
    expect(chunks[2].split(' ')).toHaveLength(250);
    // No words lost or duplicated across the split.
    expect(chunks.join(' ')).toBe(longText);
  });

  it('defaults targetTokens to 500 when omitted', () => {
    const longText = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(longText);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].split(' ')).toHaveLength(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scripts/ingest-neighborhood-docs.test.ts`
Expected: FAIL — `Cannot find module './ingest-neighborhood-docs'`.

- [ ] **Step 3: Implement `DEFAULT_LOCALITIES`, `wikipediaApiUrl`, and `chunkText`**

Create `scripts/ingest-neighborhood-docs.ts`:

```ts
/**
 * Initial fixed locality list for the neighborhood RAG corpus. This is a
 * documented default, not a placeholder — edit this array to add/remove
 * localities as the scraped listings' locality coverage grows.
 */
export const DEFAULT_LOCALITIES = [
  'Koramangala',
  'HSR Layout',
  'Indiranagar',
  'Whitefield',
  'Jayanagar',
] as const;

const WIKIPEDIA_API_BASE = 'https://en.wikipedia.org/w/api.php';

/** Builds the Wikipedia "plain text extract" API URL for a locality title. */
export function wikipediaApiUrl(locality: string): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    format: 'json',
    redirects: '1',
    titles: locality,
  });
  return `${WIKIPEDIA_API_BASE}?${params.toString()}`;
}

/**
 * Splits text into ~targetTokens-word windows. "Tokens" here is approximated
 * as whitespace-delimited words (no real tokenizer dependency) — good enough
 * for chunk-sizing a RAG corpus at prototype scale.
 */
export function chunkText(text: string, targetTokens: number = 500): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += targetTokens) {
    chunks.push(words.slice(i, i + targetTokens).join(' '));
  }
  return chunks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- scripts/ingest-neighborhood-docs.test.ts`
Expected: PASS (4 `chunkText` tests).

- [ ] **Step 5: Write the failing tests for `fetchLocalityPage`**

Append to `scripts/ingest-neighborhood-docs.test.ts`:

```ts
import { fetchLocalityPage } from './ingest-neighborhood-docs';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('fetchLocalityPage', () => {
  it('extracts title, canonical URL, and plain-text extract from the Wikipedia API response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        query: {
          pages: {
            '12345': {
              pageid: 12345,
              title: 'Koramangala',
              extract: 'Koramangala is a neighbourhood in Bengaluru, India.',
            },
          },
        },
      })
    );

    const result = await fetchLocalityPage('Koramangala', fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('titles=Koramangala'));
    expect(result).toEqual({
      title: 'Koramangala',
      url: 'https://en.wikipedia.org/wiki/Koramangala',
      text: 'Koramangala is a neighbourhood in Bengaluru, India.',
    });
  });

  it('returns empty text for a missing Wikipedia page instead of throwing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        query: {
          pages: {
            '-1': { ns: 0, title: 'Some Nonexistent Place', missing: '' },
          },
        },
      })
    );

    const result = await fetchLocalityPage('Some Nonexistent Place', fetchFn);
    expect(result.text).toBe('');
  });

  it('throws when the HTTP request fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    await expect(fetchLocalityPage('Koramangala', fetchFn)).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- scripts/ingest-neighborhood-docs.test.ts`
Expected: FAIL — `fetchLocalityPage is not exported from './ingest-neighborhood-docs'`.

- [ ] **Step 7: Implement `fetchLocalityPage`**

Append to `scripts/ingest-neighborhood-docs.ts`:

```ts
interface WikipediaExtractPage {
  title?: string;
  extract?: string;
}

interface WikipediaExtractResponse {
  query?: {
    pages?: Record<string, WikipediaExtractPage>;
  };
}

/**
 * Fetches a locality's Wikipedia plain-text extract via the Wikipedia Action
 * API (no HTML parsing needed — `explaintext=1` returns plain text directly).
 * Accepts an injectable fetchFn so tests never hit the real network.
 */
export async function fetchLocalityPage(
  locality: string,
  fetchFn: typeof fetch = fetch
): Promise<{ title: string; url: string; text: string }> {
  const apiUrl = wikipediaApiUrl(locality);
  const res = await fetchFn(apiUrl);
  if (!res.ok) {
    throw new Error(`Wikipedia fetch failed for "${locality}": HTTP ${res.status}`);
  }

  const json = (await res.json()) as WikipediaExtractResponse;
  const pages = json.query?.pages ?? {};
  const page = Object.values(pages)[0];

  const title = page?.title ?? locality;
  const text = page?.extract?.trim() ?? '';
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

  return { title, url, text };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- scripts/ingest-neighborhood-docs.test.ts`
Expected: PASS (7 tests total: 4 `chunkText` + 3 `fetchLocalityPage`).

- [ ] **Step 9: Write the failing tests for `ingestLocality`**

Append to `scripts/ingest-neighborhood-docs.test.ts`:

```ts
import { ingestLocality } from './ingest-neighborhood-docs';
import { neighborhoodDocs } from '../lib/db/schema';

describe('ingestLocality', () => {
  function makeMockDb() {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const deleteMock = vi.fn(() => ({ where: whereMock }));
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    return { delete: deleteMock, insert: insertMock, whereMock, valuesMock, deleteMock, insertMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears existing rows for the locality, chunks the fetched text, embeds each chunk, and inserts mapped rows', async () => {
    const longExtract = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        query: {
          pages: {
            '1': { title: 'Koramangala', extract: longExtract },
          },
        },
      }),
    });
    const embed = vi.fn().mockResolvedValue(new Array(384).fill(0.42));
    const mockDb = makeMockDb();

    const count = await ingestLocality('Koramangala', {
      fetchFn: fetchFn as unknown as typeof fetch,
      embed,
      dbClient: mockDb as unknown as Parameters<typeof ingestLocality>[1] extends { dbClient?: infer D } ? D : never,
      targetTokens: 500,
    });

    expect(count).toBe(2);
    expect(mockDb.deleteMock).toHaveBeenCalledWith(neighborhoodDocs);
    expect(mockDb.whereMock).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(mockDb.insertMock).toHaveBeenCalledWith(neighborhoodDocs);

    const insertedRows = mockDb.valuesMock.mock.calls[0][0];
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0]).toMatchObject({
      locality: 'Koramangala',
      sourceTitle: 'Koramangala',
      sourceUrl: 'https://en.wikipedia.org/wiki/Koramangala',
      embedding: new Array(384).fill(0.42),
    });
    expect(insertedRows[0].chunkText.split(' ')).toHaveLength(500);
    expect(insertedRows[0].fetchedAt).toBeInstanceOf(Date);
  });

  it('still clears old rows but does not insert or embed when the fetched text is empty', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ query: { pages: { '-1': { title: 'Ghost Town', missing: '' } } } }),
    });
    const embed = vi.fn();
    const mockDb = makeMockDb();

    const count = await ingestLocality('Ghost Town', {
      fetchFn: fetchFn as unknown as typeof fetch,
      embed,
      dbClient: mockDb as unknown as Parameters<typeof ingestLocality>[1] extends { dbClient?: infer D } ? D : never,
    });

    expect(count).toBe(0);
    expect(mockDb.deleteMock).toHaveBeenCalledWith(neighborhoodDocs);
    expect(embed).not.toHaveBeenCalled();
    expect(mockDb.insertMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npm test -- scripts/ingest-neighborhood-docs.test.ts`
Expected: FAIL — `ingestLocality is not exported from './ingest-neighborhood-docs'`.

- [ ] **Step 11: Implement `ingestLocality` and the script entry point**

Append to `scripts/ingest-neighborhood-docs.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { neighborhoodDocs } from '../lib/db/schema';
import { embedText } from '../lib/rag/embed';

export interface IngestLocalityDeps {
  fetchFn?: typeof fetch;
  embed?: (text: string) => Promise<number[]>;
  dbClient?: Pick<typeof db, 'insert' | 'delete'>;
  targetTokens?: number;
}

/**
 * Ingests one locality's Wikipedia text into `neighborhood_docs`: fetch ->
 * chunk -> embed each chunk -> replace that locality's existing rows with
 * the freshly chunked/embedded set (delete-then-insert makes re-running this
 * per locality idempotent instead of accumulating duplicate chunks).
 * Returns the number of chunks inserted (0 if the source page had no text).
 */
export async function ingestLocality(
  locality: string,
  deps: IngestLocalityDeps = {}
): Promise<number> {
  const { fetchFn = fetch, embed = embedText, dbClient = db, targetTokens = 500 } = deps;

  const { title, url, text } = await fetchLocalityPage(locality, fetchFn);
  const chunks = chunkText(text, targetTokens);

  await dbClient.delete(neighborhoodDocs).where(eq(neighborhoodDocs.locality, locality));

  if (chunks.length === 0) {
    return 0;
  }

  const rows = [];
  for (const chunk of chunks) {
    const embedding = await embed(chunk);
    rows.push({
      locality,
      sourceTitle: title,
      sourceUrl: url,
      chunkText: chunk,
      embedding,
      fetchedAt: new Date(),
    });
  }

  await dbClient.insert(neighborhoodDocs).values(rows);
  return rows.length;
}

/**
 * Live ingestion entry point: run over DEFAULT_LOCALITIES (or CLI args, if
 * given) against the real DB, fetch, and embedding pipeline.
 */
async function main(): Promise<void> {
  const localities = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_LOCALITIES;
  for (const locality of localities) {
    const count = await ingestLocality(locality);
    console.log(`[ingest-neighborhood-docs] ${locality}: inserted ${count} chunk(s)`);
  }
}

// Vitest sets process.env.VITEST during test runs — this keeps `import`ing
// this module for its pure functions from ever hitting the network or DB.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error('[ingest-neighborhood-docs] failed:', err);
    process.exit(1);
  });
}
```

Add a script entry to `package.json`'s `"scripts"` section:

```json
"ingest:docs": "tsx scripts/ingest-neighborhood-docs.ts"
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `npm test -- scripts/ingest-neighborhood-docs.test.ts`
Expected: PASS (9 tests total: 4 `chunkText` + 3 `fetchLocalityPage` + 2 `ingestLocality`).

- [ ] **Step 13: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1–4 pass together with zero network/DB access.

- [ ] **Step 14: Commit**

```bash
git add scripts/ingest-neighborhood-docs.ts scripts/ingest-neighborhood-docs.test.ts package.json
git commit -m "feat(ingestion): add Wikipedia-backed neighborhood doc ingester with chunking and embedding"
```

---

## Self-Review Notes

- **Spec coverage:** PII stripping (Task 1) covers "no PII anywhere in dataset/UI/logs." Availability filtering and pin mapping (Task 3) cover "not every pin is an active listing... only pins marked as currently available." Upsert-by-`sourceUrl` (Task 3) covers "listings must map back to what you scraped." Local embeddings (Task 2) and chunked Wikipedia ingestion with citation fields `sourceTitle`/`sourceUrl` (Task 4) cover "neighborhood practical guidance... from real public sources... gathered the same way you gather listings" and set up the citation trail the RAG/evals subsystems need. `DEFAULT_LOCALITIES` addresses the architecture doc's open item on locality scoping.
- **Placeholder scan:** the only "TODO"-labeled text is the explicitly-scoped `page.evaluate()` extraction hook in Task 3, which is intentionally called out as a live-site integration detail (matching the assignment's own instruction to flag Playwright automation as an integration/manual-verification concern) rather than an unresolved implementation gap — every other step has complete, runnable code.
- **Type consistency:** `RawScrapedListing`/`CleanListing` (Task 1) are the exact types threaded through `parsePin`/`upsertListing` (Task 3). `embedText`'s `Promise<number[]>` (Task 2) matches the `embed` dependency type in `IngestLocalityDeps` and the `embedding: number[]` field written to `neighborhoodDocs` (Task 4). Column names (`sourceUrl`, `societyName`, `availabilityStatus`, `scrapedAt`, `sourceTitle`, `chunkText`, `fetchedAt`) are used identically across the upsert/insert calls and their tests.
