# Property Scout UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the companion UI (`app/page.tsx`) to match `data/UI.png`'s mobile card layout — header, hero, search/filters, property cards, floating mic button, bottom nav — using real data end-to-end, while reusing all existing tested logic (`VoiceBar`, `NeighborhoodPanel`, `SourcesPanel`, `BookingPanel`, `EmailShortlistButton`) unmodified.

**Architecture:** New presentational components (`Header`, `Hero`, `SearchBar`, `FilterPills`, `PropertyCard`, `BottomNav`, `FloatingMicButton`, `VoiceSheet`) composed in a rewritten `app/page.tsx`, styled with CSS Modules + one shared `app/globals.css` token file (no new npm dependencies, no icon library — hand-rolled inline SVGs). Two small backend additions make search/filter and heart-remove real: `GET /api/shortlist` becomes session-aware and filterable, and a new `POST /api/shortlist/remove` reuses the existing `applyShortlistEdit` mutation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest + Testing Library, Drizzle ORM / SQLite. No new dependencies.

**Source spec:** `docs/superpowers/specs/2026-08-14-property-scout-ui-redesign-design.md`

## Plan-time corrections to the approved spec

Two small, necessary deviations found while turning the spec into concrete tasks — flagging both before execution rather than silently diverging:

1. **`NeighborhoodPanel`/`SourcesPanel` are per-card (inside each `PropertyCard`'s expanded view) — but `BookingPanel` and `EmailShortlistButton` are page-level, rendered once, not duplicated inside every card.** The spec's §4 component table put all four inside the expanded card state. On closer look, `BookingPanel` and `EmailShortlistButton` both operate on the whole session (one booking, one "email me this shortlist" action) — neither takes a `listingId`. Duplicating them inside every single card would show N identical "email this shortlist" buttons, which is wrong. `NeighborhoodPanel` and `SourcesPanel` genuinely are per-listing (they take that listing's snapshot/citations), so those stay inside the expanded card.
2. **`GET /api/shortlist`'s response shape changes from a bare array to `{ sessionId: string; items: ShortlistApiItem[] }`.** Needed because the session cookie is `httpOnly` (set in `app/api/agent/route.ts`) and therefore unreadable from client-side JS via `document.cookie` — but `EmailShortlistButton` requires a `sessionId` prop to call `/api/notify`. Returning it in the JSON body is the smallest fix; the alternative (making the cookie non-httpOnly) would weaken session security for no reason.

## Global Constraints

- No new npm dependencies (no Tailwind, no icon library, no component kit).
- Mobile-first layout, single column, capped at `--max-content-width: 480px`, centered on wider viewports.
- No "For Sale" — app is rental-only. The mockup's "For Sale" pill becomes a static, always-active "For Rent" pill.
- No real property photos — every `PropertyCard` uses one neutral placeholder image (`public/property-placeholder.svg`).
- No user accounts/avatar — `Header` has no avatar element.
- "Saved" and "Profile" bottom-nav tabs are non-functional (`disabled`) placeholders. "See all" next to "Featured Properties" is decorative text, not a link/button.
- `VoiceBar`, `NeighborhoodPanel`, `SourcesPanel`, `BookingPanel`, `EmailShortlistButton` must not have their internal logic changed — only reused and repositioned. Their existing test files are not modified except where noted.
- TDD throughout: write the failing test, watch it fail, write minimal code, watch it pass, commit.
- `searchListings`'s `locality` filter (`lib/agent/tools/searchListings.ts:22-24`) is an exact match (`eq`), not substring/case-insensitive. Typing a partial or differently-cased locality in the new search bar will return no results — this is an inherited limitation, not something this plan fixes (documented in Task 13, not silently papered over).

---

### Task 1: Design tokens, global styles, and icon primitives

**Files:**
- Create: `app/globals.css`
- Modify: `app/layout.tsx`
- Create: `components/icons/icons.tsx`
- Test: `components/icons/icons.test.tsx`
- Create: `public/property-placeholder.svg`

**Interfaces:**
- Produces: `SearchIcon`, `HeartIcon`, `BedIcon`, `SqftIcon`, `MicIcon`, `HouseIcon`, `PersonIcon` — each `(props: { className?: string }) => JSX.Element`, from `components/icons/icons.tsx`. Every later component task imports icons from here.
- Produces: CSS custom properties on `:root` (`--color-bg`, `--color-surface`, `--color-primary`, `--color-accent`, `--color-text`, `--color-text-muted`, `--color-border`, `--radius-md`, `--radius-lg`, `--radius-full`, `--space-1` through `--space-6`, `--shadow-card`, `--max-content-width`, `--font-sans`) — every later component's CSS Module uses these by name.
- Produces: `public/property-placeholder.svg`, referenced by `PropertyCard` (Task 9) as `<img src="/property-placeholder.svg">`.

- [ ] **Step 1: Write the failing icon test**

```tsx
// components/icons/icons.test.tsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SearchIcon, HeartIcon, BedIcon, SqftIcon, MicIcon, HouseIcon, PersonIcon } from './icons';

describe('icons', () => {
  it.each([
    ['SearchIcon', SearchIcon],
    ['HeartIcon', HeartIcon],
    ['BedIcon', BedIcon],
    ['SqftIcon', SqftIcon],
    ['MicIcon', MicIcon],
    ['HouseIcon', HouseIcon],
    ['PersonIcon', PersonIcon],
  ] as const)('%s renders an svg element', (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('SearchIcon applies a passed className to the svg', () => {
    const { container } = render(<SearchIcon className="my-icon" />);
    expect(container.querySelector('svg')).toHaveClass('my-icon');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/icons/icons.test.tsx`
Expected: FAIL — `Failed to resolve import "./icons"` (file doesn't exist yet).

- [ ] **Step 3: Write the icons**

```tsx
// components/icons/icons.tsx
interface IconProps {
  className?: string;
}

const BASE_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function HeartIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

export function BedIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" />
      <path d="M3 18v2" />
      <path d="M21 18v2" />
      <path d="M3 12V8a2 2 0 0 1 2-2h4v4" />
    </svg>
  );
}

export function SqftIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h4" />
      <path d="M9 3v4" />
    </svg>
  );
}

export function MicIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

export function HouseIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M3 11 12 3l9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/icons/icons.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Add global design tokens**

```css
/* app/globals.css */
:root {
  --color-bg: #f4f5f7;
  --color-surface: #ffffff;
  --color-primary: #14161f;
  --color-accent: #f4703b;
  --color-text: #14161f;
  --color-text-muted: #6b7280;
  --color-border: #e5e7eb;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-full: 999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --shadow-card: 0 4px 16px rgba(20, 22, 31, 0.08);
  --max-content-width: 480px;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}

main[data-testid='companion-ui'] {
  max-width: var(--max-content-width);
  margin: 0 auto;
  min-height: 100vh;
  position: relative;
  background: var(--color-bg);
  padding-bottom: 96px;
}
```

- [ ] **Step 6: Import globals.css in the root layout**

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'NextLeap Property Scout',
  description: 'Voice-first AI property scout for Bengaluru renters',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Add the placeholder property image**

```svg
<!-- public/property-placeholder.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" role="img" aria-hidden="true">
  <rect width="400" height="240" fill="#e5e7eb"/>
  <polygon points="60,90 200,40 340,90" fill="#94a3b8"/>
  <rect x="60" y="90" width="280" height="120" fill="#cbd5e1"/>
  <rect x="90" y="120" width="40" height="40" fill="#f4f5f7"/>
  <rect x="150" y="120" width="40" height="40" fill="#f4f5f7"/>
  <rect x="210" y="120" width="40" height="40" fill="#f4f5f7"/>
  <rect x="270" y="120" width="40" height="40" fill="#f4f5f7"/>
  <rect x="180" y="170" width="40" height="40" fill="#94a3b8"/>
</svg>
```

- [ ] **Step 8: Run the full suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS — all existing tests still green (globals.css/layout.tsx have no test-observable behavior; the icons test is the only new one).

- [ ] **Step 9: Commit**

```bash
git add app/globals.css app/layout.tsx components/icons/icons.tsx components/icons/icons.test.tsx public/property-placeholder.svg
git commit -m "feat: add design tokens, icon primitives, and placeholder image for UI redesign"
```

---

### Task 2: `lib/types.ts` — add `scrapedAt` and `ShortlistApiResponse`

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `Listing.scrapedAt: string` (ISO timestamp) — consumed by `PropertyCard` (Task 9) for the "New" badge, and populated by `GET /api/shortlist` (Task 3).
- Produces: `ShortlistApiResponse { sessionId: string; items: ShortlistApiItem[] }` — consumed by `app/page.tsx` (Task 12) and `GET /api/shortlist` (Task 3).

This is a type-only change (no runtime behavior), so there is no failing-test step — the "test" is the TypeScript compiler, exercised in Step 2.

- [ ] **Step 1: Add the fields**

Open `lib/types.ts`. Add `scrapedAt: string;` to the `Listing` interface, and add a new `ShortlistApiResponse` interface after `ShortlistApiItem`:

```ts
export interface Listing {
  id: string;
  societyName: string;
  locality: string;
  rent: number;
  bedrooms: number;
  furnishing: string;
  amenities: string[];
  sqft: number;
  availabilityStatus: AvailabilityStatus;
  scrapedAt: string;
}
```

```ts
export interface ShortlistApiItem {
  listing: Listing;
  neighborhoodSnapshot: NeighborhoodSnapshot;
  citations: Citation[];
}

export interface ShortlistApiResponse {
  sessionId: string;
  items: ShortlistApiItem[];
}
```

- [ ] **Step 2: Run typecheck — expect it to fail in files not yet updated**

Run: `npx tsc --noEmit`
Expected: FAIL, listing errors in `components/ShortlistCard.test.tsx` and `app/page.test.tsx` — both are missing `scrapedAt` in their `Listing` fixtures and `app/api/shortlist/route.ts` is missing it in its returned object. This is expected — Task 3 fixes the route, Task 9/12 replace `ShortlistCard`/`app/page.tsx` and their tests. Confirm no *other* files appear in the error list (that would mean a missed spot).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add Listing.scrapedAt and ShortlistApiResponse types"
```

---

### Task 3: `GET /api/shortlist` becomes session-aware and filterable

**Files:**
- Modify: `app/api/shortlist/route.ts`
- Create: `app/api/shortlist/route.test.ts` (no test file exists for this route today)

**Interfaces:**
- Consumes: `getOrCreateSession(cookieSessionId?: string): Promise<{ id: string; isNew: boolean }>` from `lib/agent/session.ts`. `searchListings(constraints: { locality?: string; bedrooms?: number }): Promise<Listing[]>` from `lib/agent/tools/searchListings.ts` (DB-row `Listing`, distinct from `lib/types.ts`'s `Listing`). `retrieveNeighborhoodDocs` from `lib/agent/tools/retrieveNeighborhoodDocs.ts`. `SESSION_COOKIE_NAME = 'nextleap_session'` exported from `app/api/agent/route.ts`. `shortlistItems` table from `lib/db/schema.ts` (`sessionId`, `listingId`, `status: 'active' | 'dropped'`, `reason`, `addedAt`).
- Produces: `GET /api/shortlist?locality=&bedrooms=` returns `{ sessionId, items }` matching `ShortlistApiResponse` (Task 2), and sets the `nextleap_session` cookie. Consumed by `app/page.tsx` (Task 12).

- [ ] **Step 1: Write the failing test**

```ts
// app/api/shortlist/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetOrCreateSession } = vi.hoisted(() => ({ mockGetOrCreateSession: vi.fn() }));
const { mockSearchListings } = vi.hoisted(() => ({ mockSearchListings: vi.fn() }));
const { mockRetrieveNeighborhoodDocs } = vi.hoisted(() => ({ mockRetrieveNeighborhoodDocs: vi.fn() }));
const { mockCookieGet, mockCookieSet, mockCookies } = vi.hoisted(() => {
  const mockCookieGet = vi.fn();
  const mockCookieSet = vi.fn();
  const mockCookies = vi.fn(() => Promise.resolve({ get: mockCookieGet, set: mockCookieSet }));
  return { mockCookieGet, mockCookieSet, mockCookies };
});
const { mockSelect, mockFrom, mockWhere, mockInsert, mockValues } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  return { mockSelect, mockFrom, mockWhere, mockInsert, mockValues };
});

vi.mock('../../../lib/db/client', () => ({ db: { select: mockSelect, insert: mockInsert } }));
vi.mock('../../../lib/agent/session', () => ({ getOrCreateSession: mockGetOrCreateSession }));
vi.mock('../../../lib/agent/tools/searchListings', () => ({ searchListings: mockSearchListings }));
vi.mock('../../../lib/agent/tools/retrieveNeighborhoodDocs', () => ({
  retrieveNeighborhoodDocs: mockRetrieveNeighborhoodDocs,
}));
vi.mock('next/headers', () => ({ cookies: mockCookies }));

import { GET } from './route';

function makeRequest(query = ''): Request {
  return new Request(`http://localhost/api/shortlist${query}`);
}

const listingRow = {
  id: 1,
  sourceUrl: 'https://example.com/1',
  societyName: 'Prestige Falcon City',
  locality: 'Koramangala',
  lat: 12.93,
  lng: 77.61,
  rent: 35000,
  bedrooms: 2,
  furnishing: 'Semi-furnished',
  amenities: ['Parking'],
  sqft: 1100,
  availabilityStatus: 'available' as const,
  scrapedAt: new Date('2026-08-10T00:00:00.000Z'),
};

describe('GET /api/shortlist', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCookies.mockReturnValue(Promise.resolve({ get: mockCookieGet, set: mockCookieSet }));
    mockCookieGet.mockReturnValue(undefined);
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-1', isNew: true });
    mockSearchListings.mockResolvedValue([listingRow]);
    mockRetrieveNeighborhoodDocs.mockResolvedValue({ chunks: [], uncertain: true });
    mockWhere.mockResolvedValue([]);
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockInsert.mockReturnValue({ values: mockValues });
  });

  it('creates a session, seeds new results as active shortlistItems, and returns sessionId + items', async () => {
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(mockGetOrCreateSession).toHaveBeenCalledWith(undefined);
    expect(mockSearchListings).toHaveBeenCalledWith({ locality: undefined, bedrooms: undefined });
    expect(mockValues).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: 'sess-1', listingId: 1, status: 'active' }),
    ]);
    expect(json.sessionId).toBe('sess-1');
    expect(json.items).toHaveLength(1);
    expect(json.items[0].listing).toEqual(
      expect.objectContaining({ id: '1', societyName: 'Prestige Falcon City', scrapedAt: '2026-08-10T00:00:00.000Z' })
    );
  });

  it('passes locality and bedrooms query params through to searchListings', async () => {
    await GET(makeRequest('?locality=Koramangala&bedrooms=2'));

    expect(mockSearchListings).toHaveBeenCalledWith({ locality: 'Koramangala', bedrooms: 2 });
  });

  it('does not re-insert a listing that already has a shortlistItems row for this session', async () => {
    mockWhere.mockResolvedValue([{ listingId: 1, status: 'active' }]);

    await GET(makeRequest());

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('excludes a listing whose shortlistItems row for this session is dropped, even though it still matches search', async () => {
    mockWhere.mockResolvedValue([{ listingId: 1, status: 'dropped' }]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.items).toHaveLength(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('reuses the session id from an existing cookie', async () => {
    mockCookieGet.mockReturnValue({ value: 'sess-existing' });
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-existing', isNew: false });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(mockGetOrCreateSession).toHaveBeenCalledWith('sess-existing');
    expect(json.sessionId).toBe('sess-existing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/shortlist/route.test.ts`
Expected: FAIL — current `route.ts` exports a `GET` that ignores query params, cookies, and `shortlistItems`; assertions on `mockGetOrCreateSession`, `mockSearchListings` args, and `json.sessionId` will fail.

- [ ] **Step 3: Rewrite the route**

```ts
// app/api/shortlist/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/db/client';
import { shortlistItems } from '../../../lib/db/schema';
import { getOrCreateSession } from '../../../lib/agent/session';
import { searchListings } from '../../../lib/agent/tools/searchListings';
import { retrieveNeighborhoodDocs } from '../../../lib/agent/tools/retrieveNeighborhoodDocs';
import { SESSION_COOKIE_NAME } from '../agent/route';
import type { Citation, NeighborhoodSnapshot, ShortlistApiItem } from '../../../lib/types';

const SHORTLIST_LIMIT = 6;
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Session-aware, filterable shortlist feed for the companion UI. Seeds any
 * newly-returned listing as an `active` shortlistItems row for the session
 * (so POST /api/shortlist/remove has something to mutate) and excludes any
 * listing already marked `dropped` for this session, even if it still
 * matches the current search/filter — a heart-removed card stays removed
 * until the session ends.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locality = searchParams.get('locality') ?? undefined;
  const bedroomsParam = searchParams.get('bedrooms');
  const bedrooms = bedroomsParam !== null && bedroomsParam !== '' ? Number(bedroomsParam) : undefined;

  const cookieStore = await cookies();
  const { id: sessionId } = await getOrCreateSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  const results = await searchListings({
    locality,
    bedrooms: bedrooms !== undefined && !Number.isNaN(bedrooms) ? bedrooms : undefined,
  });

  const existingRows = (await db
    .select({ listingId: shortlistItems.listingId, status: shortlistItems.status })
    .from(shortlistItems)
    .where(eq(shortlistItems.sessionId, sessionId))) as Array<{ listingId: number; status: 'active' | 'dropped' }>;

  const existingIds = new Set(existingRows.map((r) => r.listingId));
  const droppedIds = new Set(existingRows.filter((r) => r.status === 'dropped').map((r) => r.listingId));

  const toSeed = results.filter((listing) => !existingIds.has(listing.id));
  if (toSeed.length > 0) {
    await db.insert(shortlistItems).values(
      toSeed.map((listing) => ({
        sessionId,
        listingId: listing.id,
        status: 'active' as const,
        reason: 'Shown in Explore results',
        addedAt: new Date(),
      }))
    );
  }

  const visible = results.filter((listing) => !droppedIds.has(listing.id));

  // Prefer listings whose locality we could resolve, so the neighborhood
  // panel has real grounded content to show in the demo.
  const withLocality = visible.filter((r) => r.locality);
  const withoutLocality = visible.filter((r) => !r.locality);
  const top = [...withLocality, ...withoutLocality].slice(0, SHORTLIST_LIMIT);

  const items: ShortlistApiItem[] = await Promise.all(
    top.map(async (listing) => {
      const safety = listing.locality
        ? await retrieveNeighborhoodDocs({ locality: listing.locality, topic: 'safety and neighborhood character' })
        : { chunks: [], uncertain: true };

      const neighborhoodSnapshot: NeighborhoodSnapshot = {
        transit: [],
        safety: safety.chunks.map((chunk) => ({
          text: `${chunk.chunkText.slice(0, 240)}…`,
          source: chunk.sourceTitle,
        })),
        amenities: [],
        uncertain: {
          transit: true,
          safety: safety.uncertain,
          amenities: true,
        },
      };

      const citations: Citation[] = safety.chunks.map((chunk) => ({
        label: chunk.sourceTitle,
        url: chunk.sourceUrl,
        kind: 'rag',
      }));

      return {
        listing: {
          id: String(listing.id),
          societyName: listing.societyName ?? 'Unnamed listing',
          locality: listing.locality ?? 'Unknown locality',
          rent: listing.rent ?? 0,
          bedrooms: listing.bedrooms ?? 0,
          furnishing: listing.furnishing ?? 'Unknown',
          amenities: listing.amenities,
          sqft: listing.sqft ?? 0,
          availabilityStatus: listing.availabilityStatus,
          scrapedAt: listing.scrapedAt.toISOString(),
        },
        neighborhoodSnapshot,
        citations,
      };
    })
  );

  const response = NextResponse.json({ sessionId, items });
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/shortlist/route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/shortlist/route.ts app/api/shortlist/route.test.ts
git commit -m "feat: make GET /api/shortlist session-aware and filterable"
```

---

### Task 4: `POST /api/shortlist/remove`

**Files:**
- Create: `app/api/shortlist/remove/route.ts`
- Create: `app/api/shortlist/remove/route.test.ts`

**Interfaces:**
- Consumes: `applyShortlistEdit({ sessionId: string; editIntent: EditIntent }): Promise<ShortlistDiff>` from `lib/agent/tools/applyShortlistEdit.ts` (already exists, already tested — `EditIntent`'s `remove` variant is `{ op: 'remove'; listingId: number }`). `SESSION_COOKIE_NAME` from `app/api/agent/route.ts`.
- Produces: `POST /api/shortlist/remove` with body `{ listingId: number }` → `{ changed: number[]; unchanged: number[] }`. Consumed by `app/page.tsx`'s remove handler (Task 12).

- [ ] **Step 1: Write the failing test**

```ts
// app/api/shortlist/remove/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApplyShortlistEdit } = vi.hoisted(() => ({ mockApplyShortlistEdit: vi.fn() }));
const { mockCookieGet, mockCookies } = vi.hoisted(() => {
  const mockCookieGet = vi.fn();
  const mockCookies = vi.fn(() => Promise.resolve({ get: mockCookieGet }));
  return { mockCookieGet, mockCookies };
});

vi.mock('../../../../lib/agent/tools/applyShortlistEdit', () => ({ applyShortlistEdit: mockApplyShortlistEdit }));
vi.mock('next/headers', () => ({ cookies: mockCookies }));

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/shortlist/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/shortlist/remove', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCookies.mockReturnValue(Promise.resolve({ get: mockCookieGet }));
    mockCookieGet.mockReturnValue({ value: 'sess-1' });
  });

  it('removes the listing from the session shortlist', async () => {
    mockApplyShortlistEdit.mockResolvedValue({ changed: [42], unchanged: [7] });

    const res = await POST(makeRequest({ listingId: 42 }));
    const json = await res.json();

    expect(mockApplyShortlistEdit).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      editIntent: { op: 'remove', listingId: 42 },
    });
    expect(json).toEqual({ changed: [42], unchanged: [7] });
  });

  it('returns 400 when listingId is missing', async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(mockApplyShortlistEdit).not.toHaveBeenCalled();
  });

  it('returns 400 when there is no session cookie', async () => {
    mockCookieGet.mockReturnValue(undefined);

    const res = await POST(makeRequest({ listingId: 42 }));

    expect(res.status).toBe(400);
    expect(mockApplyShortlistEdit).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/shortlist/remove', { method: 'POST', body: 'not json' })
    );

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/shortlist/remove/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"` (file doesn't exist yet).

- [ ] **Step 3: Write the route**

```ts
// app/api/shortlist/remove/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { applyShortlistEdit } from '../../../../lib/agent/tools/applyShortlistEdit';
import { SESSION_COOKIE_NAME } from '../../agent/route';

export async function POST(request: Request) {
  let body: { listingId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { listingId } = body;
  if (typeof listingId !== 'number' || !Number.isFinite(listingId)) {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    return NextResponse.json({ error: 'No active shortlist session' }, { status: 400 });
  }

  const diff = await applyShortlistEdit({ sessionId, editIntent: { op: 'remove', listingId } });

  return NextResponse.json(diff);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/shortlist/remove/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/shortlist/remove/route.ts app/api/shortlist/remove/route.test.ts
git commit -m "feat: add POST /api/shortlist/remove"
```

---

### Task 5: `Header` component

**Files:**
- Create: `components/Header.tsx`
- Create: `components/Header.module.css`
- Test: `components/Header.test.tsx`

**Interfaces:**
- Consumes: `SearchIcon` from `components/icons/icons.tsx` (Task 1).
- Produces: `Header(): JSX.Element` — no props. Consumed by `app/page.tsx` (Task 12).

- [ ] **Step 1: Write the failing test**

```tsx
// components/Header.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Header from './Header';

describe('Header', () => {
  it('renders the app title and no avatar', () => {
    render(<Header />);

    expect(screen.getByText('Property Scout')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/Header.test.tsx`
Expected: FAIL — `Failed to resolve import "./Header"`.

- [ ] **Step 3: Write the component**

```tsx
// components/Header.tsx
import styles from './Header.module.css';
import { SearchIcon } from './icons/icons';

export default function Header() {
  return (
    <header className={styles.header} data-testid="app-header">
      <SearchIcon className={styles.searchIcon} />
      <h1 className={styles.title}>Property Scout</h1>
    </header>
  );
}
```

```css
/* components/Header.module.css */
.header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.searchIcon {
  color: var(--color-text);
  flex-shrink: 0;
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/Header.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add components/Header.tsx components/Header.module.css components/Header.test.tsx
git commit -m "feat: add Header component"
```

---

### Task 6: `Hero` component

**Files:**
- Create: `components/Hero.tsx`
- Create: `components/Hero.module.css`
- Test: `components/Hero.test.tsx`

**Interfaces:**
- Produces: `Hero(): JSX.Element` — no props. Consumed by `app/page.tsx` (Task 12).

- [ ] **Step 1: Write the failing test**

```tsx
// components/Hero.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Hero from './Hero';

describe('Hero', () => {
  it('renders the headline and subtitle', () => {
    render(<Hero />);

    expect(screen.getByRole('heading', { name: 'Find your perfect home' })).toBeInTheDocument();
    expect(screen.getByText('Discover available rentals curated for you.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/Hero.test.tsx`
Expected: FAIL — `Failed to resolve import "./Hero"`.

- [ ] **Step 3: Write the component**

```tsx
// components/Hero.tsx
import styles from './Hero.module.css';

export default function Hero() {
  return (
    <section className={styles.hero} data-testid="hero">
      <h2 className={styles.headline}>Find your perfect home</h2>
      <p className={styles.subtitle}>Discover available rentals curated for you.</p>
    </section>
  );
}
```

```css
/* components/Hero.module.css */
.hero {
  padding: var(--space-5) var(--space-4) var(--space-4);
}

.headline {
  font-size: 1.75rem;
  font-weight: 800;
  margin: 0 0 var(--space-2);
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
  line-height: 1.4;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/Hero.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add components/Hero.tsx components/Hero.module.css components/Hero.test.tsx
git commit -m "feat: add Hero component"
```

---

### Task 7: `SearchBar` component

**Files:**
- Create: `components/SearchBar.tsx`
- Create: `components/SearchBar.module.css`
- Test: `components/SearchBar.test.tsx`

**Interfaces:**
- Consumes: `SearchIcon` from `components/icons/icons.tsx` (Task 1).
- Produces: `SearchBar(props: { defaultValue?: string; onChange: (value: string) => void; debounceMs?: number }): JSX.Element`. Consumed by `app/page.tsx` (Task 12), which passes `onChange` to update its `locality` filter state.

- [ ] **Step 1: Write the failing test**

```tsx
// components/SearchBar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import SearchBar from './SearchBar';

describe('SearchBar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onChange with the typed value after the debounce delay', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<SearchBar onChange={onChange} debounceMs={300} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Koramangala' } });
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith('Koramangala');
  });

  it('resets the debounce timer on each keystroke, calling onChange only once with the final value', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<SearchBar onChange={onChange} debounceMs={300} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Kor' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(input, { target: { value: 'Koramangala' } });
    vi.advanceTimersByTime(200);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Koramangala');
  });

  it('renders a defaultValue if provided', () => {
    render(<SearchBar onChange={vi.fn()} defaultValue="HSR Layout" />);

    expect(screen.getByRole('textbox')).toHaveValue('HSR Layout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/SearchBar.test.tsx`
Expected: FAIL — `Failed to resolve import "./SearchBar"`.

- [ ] **Step 3: Write the component**

```tsx
// components/SearchBar.tsx
'use client';

import { useRef, useState } from 'react';
import styles from './SearchBar.module.css';
import { SearchIcon } from './icons/icons';

interface SearchBarProps {
  defaultValue?: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 300;

export default function SearchBar({ defaultValue = '', onChange, debounceMs = DEFAULT_DEBOUNCE_MS }: SearchBarProps) {
  const [draft, setDraft] = useState(defaultValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function handleInput(next: string) {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  }

  return (
    <div className={styles.searchBar}>
      <SearchIcon className={styles.icon} />
      <input
        type="text"
        aria-label="Enter an area to find flats"
        placeholder="Enter an area to find flats"
        value={draft}
        onChange={(e) => handleInput(e.target.value)}
        className={styles.input}
      />
    </div>
  );
}
```

```css
/* components/SearchBar.module.css */
.searchBar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-4) var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.input {
  border: none;
  outline: none;
  flex: 1;
  font-size: 1rem;
  background: transparent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/SearchBar.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/SearchBar.tsx components/SearchBar.module.css components/SearchBar.test.tsx
git commit -m "feat: add SearchBar component with debounced locality input"
```

---

### Task 8: `FilterPills` component

**Files:**
- Create: `components/FilterPills.tsx`
- Create: `components/FilterPills.module.css`
- Test: `components/FilterPills.test.tsx`

**Interfaces:**
- Produces: `FilterPills(props: { bedrooms: number | undefined; onBedroomsChange: (bedrooms: number | undefined) => void }): JSX.Element`. Consumed by `app/page.tsx` (Task 12).

- [ ] **Step 1: Write the failing test**

```tsx
// components/FilterPills.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FilterPills from './FilterPills';

describe('FilterPills', () => {
  it('renders a static, non-interactive "For Rent" pill', () => {
    render(<FilterPills bedrooms={undefined} onBedroomsChange={vi.fn()} />);

    const forRent = screen.getByTestId('pill-for-rent');
    expect(forRent).toHaveTextContent('For Rent');
    expect(forRent.tagName).not.toBe('BUTTON');
  });

  it('calls onBedroomsChange(2) when the 2 BHK pill is clicked', () => {
    const onBedroomsChange = vi.fn();
    render(<FilterPills bedrooms={undefined} onBedroomsChange={onBedroomsChange} />);

    fireEvent.click(screen.getByTestId('pill-2bhk'));

    expect(onBedroomsChange).toHaveBeenCalledWith(2);
  });

  it('calls onBedroomsChange(undefined) when the already-active pill is clicked again', () => {
    const onBedroomsChange = vi.fn();
    render(<FilterPills bedrooms={2} onBedroomsChange={onBedroomsChange} />);

    const pill = screen.getByTestId('pill-2bhk');
    expect(pill).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(pill);

    expect(onBedroomsChange).toHaveBeenCalledWith(undefined);
  });

  it('marks only the matching pill as pressed', () => {
    render(<FilterPills bedrooms={3} onBedroomsChange={vi.fn()} />);

    expect(screen.getByTestId('pill-2bhk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('pill-3bhk')).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/FilterPills.test.tsx`
Expected: FAIL — `Failed to resolve import "./FilterPills"`.

- [ ] **Step 3: Write the component**

```tsx
// components/FilterPills.tsx
'use client';

import styles from './FilterPills.module.css';

interface FilterPillsProps {
  bedrooms: number | undefined;
  onBedroomsChange: (bedrooms: number | undefined) => void;
}

const BEDROOM_OPTIONS = [2, 3];

export default function FilterPills({ bedrooms, onBedroomsChange }: FilterPillsProps) {
  return (
    <div className={styles.pills} role="group" aria-label="Filters">
      <span className={styles.pillStatic} data-testid="pill-for-rent">
        For Rent
      </span>
      {BEDROOM_OPTIONS.map((option) => {
        const active = bedrooms === option;
        return (
          <button
            key={option}
            type="button"
            className={active ? styles.pillActive : styles.pill}
            aria-pressed={active}
            data-testid={`pill-${option}bhk`}
            onClick={() => onBedroomsChange(active ? undefined : option)}
          >
            {option} BHK
          </button>
        );
      })}
    </div>
  );
}
```

```css
/* components/FilterPills.module.css */
.pills {
  display: flex;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-4);
  overflow-x: auto;
}

.pillStatic,
.pill,
.pillActive {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  font-size: 0.875rem;
  white-space: nowrap;
  border: none;
}

.pillStatic {
  background: var(--color-primary);
  color: var(--color-surface);
}

.pill {
  background: var(--color-border);
  color: var(--color-text);
}

.pillActive {
  background: var(--color-primary);
  color: var(--color-surface);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/FilterPills.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/FilterPills.tsx components/FilterPills.module.css components/FilterPills.test.tsx
git commit -m "feat: add FilterPills component"
```

---

### Task 9: `PropertyCard` component (supersedes `ShortlistCard`)

**Files:**
- Create: `components/PropertyCard.tsx`
- Create: `components/PropertyCard.module.css`
- Test: `components/PropertyCard.test.tsx`
- Delete: `components/ShortlistCard.tsx`
- Delete: `components/ShortlistCard.test.tsx`

**Interfaces:**
- Consumes: `HeartIcon`, `BedIcon`, `SqftIcon` from `components/icons/icons.tsx` (Task 1). `NeighborhoodPanel(props: { snapshot: NeighborhoodSnapshot })` and `SourcesPanel(props: { citations: Citation[] })` — both existing, unmodified. `ShortlistApiItem` from `lib/types.ts` (Task 2, now includes `listing.scrapedAt: string`).
- Produces: `PropertyCard(props: { item: ShortlistApiItem; onRemove: (listingId: string) => void }): JSX.Element`. Consumed by `app/page.tsx` (Task 12).

- [ ] **Step 1: Write the failing test**

```tsx
// components/PropertyCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import PropertyCard from './PropertyCard';
import type { ShortlistApiItem } from '../lib/types';

const baseItem: ShortlistApiItem = {
  listing: {
    id: 'listing-1',
    societyName: 'Prestige Falcon City',
    locality: 'Koramangala',
    rent: 35000,
    bedrooms: 2,
    furnishing: 'Semi-furnished',
    amenities: ['Parking', 'Gym'],
    sqft: 1100,
    availabilityStatus: 'available',
    scrapedAt: '2026-08-10T00:00:00.000Z',
  },
  neighborhoodSnapshot: {
    transit: [],
    safety: [{ text: 'Well lit at night', source: 'Wikipedia: Koramangala' }],
    amenities: [],
    uncertain: { transit: true, amenities: true },
  },
  citations: [{ label: 'Wikipedia: Koramangala', url: 'https://en.wikipedia.org/wiki/Koramangala', kind: 'rag' }],
};

describe('PropertyCard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders price, address, bedrooms, and sqft', () => {
    render(<PropertyCard item={baseItem} onRemove={vi.fn()} />);

    expect(screen.getByTestId('listing-rent')).toHaveTextContent('35,000');
    expect(screen.getByText('Prestige Falcon City, Koramangala')).toBeInTheDocument();
    expect(screen.getByTestId('listing-bedrooms')).toHaveTextContent('2 BHK');
    expect(screen.getByTestId('listing-sqft')).toHaveTextContent('1,100 sqft');
  });

  it('shows a New badge when scrapedAt is within the last 7 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));

    render(<PropertyCard item={baseItem} onRemove={vi.fn()} />);

    expect(screen.getByTestId('new-badge')).toBeInTheDocument();
  });

  it('hides the New badge when scrapedAt is more than 7 days old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));

    render(<PropertyCard item={baseItem} onRemove={vi.fn()} />);

    expect(screen.queryByTestId('new-badge')).not.toBeInTheDocument();
  });

  it('calls onRemove with the listing id when the heart button is clicked, without expanding the card', () => {
    const onRemove = vi.fn();
    render(<PropertyCard item={baseItem} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: /remove prestige falcon city from shortlist/i }));

    expect(onRemove).toHaveBeenCalledWith('listing-1');
    expect(screen.queryByTestId('property-card-details')).not.toBeInTheDocument();
  });

  it('toggles expanded details (NeighborhoodPanel + SourcesPanel) when the card body is tapped', () => {
    render(<PropertyCard item={baseItem} onRemove={vi.fn()} />);

    expect(screen.queryByTestId('property-card-details')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /tap to expand details/i }));
    expect(screen.getByTestId('property-card-details')).toBeInTheDocument();
    expect(screen.getByTestId('neighborhood-panel')).toBeInTheDocument();
    expect(screen.getByTestId('sources-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /tap to collapse details/i }));
    expect(screen.queryByTestId('property-card-details')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/PropertyCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./PropertyCard"`.

- [ ] **Step 3: Write the component**

```tsx
// components/PropertyCard.tsx
'use client';

import { useState } from 'react';
import styles from './PropertyCard.module.css';
import { HeartIcon, BedIcon, SqftIcon } from './icons/icons';
import NeighborhoodPanel from './NeighborhoodPanel';
import SourcesPanel from './SourcesPanel';
import type { ShortlistApiItem } from '../lib/types';

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface PropertyCardProps {
  item: ShortlistApiItem;
  onRemove: (listingId: string) => void;
}

export default function PropertyCard({ item, onRemove }: PropertyCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { listing } = item;
  const isNew = Date.now() - new Date(listing.scrapedAt).getTime() < NEW_WINDOW_MS;

  function toggleExpanded() {
    setExpanded((prev) => !prev);
  }

  return (
    <article className={styles.card} data-testid="property-card">
      <div
        className={styles.imageWrap}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${listing.societyName}, tap to ${expanded ? 'collapse' : 'expand'} details`}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded();
          }
        }}
      >
        <img src="/property-placeholder.svg" alt="" className={styles.image} />
        {isNew && (
          <span className={styles.newBadge} data-testid="new-badge">
            New
          </span>
        )}
        <button
          type="button"
          className={styles.heartButton}
          aria-label={`Remove ${listing.societyName} from shortlist`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(listing.id);
          }}
        >
          <HeartIcon />
        </button>
      </div>

      <div className={styles.body}>
        <p className={styles.price} data-testid="listing-rent">
          Rs {listing.rent.toLocaleString('en-IN')}/mo
        </p>
        <p className={styles.address}>
          {listing.societyName}, {listing.locality}
        </p>
        <div className={styles.meta}>
          <span data-testid="listing-bedrooms">
            <BedIcon /> {listing.bedrooms} BHK
          </span>
          <span data-testid="listing-sqft">
            <SqftIcon /> {listing.sqft.toLocaleString('en-IN')} sqft
          </span>
        </div>
      </div>

      {expanded && (
        <div className={styles.details} data-testid="property-card-details">
          <NeighborhoodPanel snapshot={item.neighborhoodSnapshot} />
          <SourcesPanel citations={item.citations} />
        </div>
      )}
    </article>
  );
}
```

```css
/* components/PropertyCard.module.css */
.card {
  margin: 0 var(--space-4) var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

.imageWrap {
  position: relative;
  cursor: pointer;
}

.image {
  display: block;
  width: 100%;
  height: 200px;
  object-fit: cover;
}

.newBadge {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  background: var(--color-accent);
  color: var(--color-surface);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 700;
}

.heartButton {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: var(--color-surface);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.body {
  padding: var(--space-4);
}

.price {
  font-size: 1.25rem;
  font-weight: 800;
  margin: 0 0 var(--space-1);
}

.address {
  color: var(--color-text-muted);
  margin: 0 0 var(--space-3);
}

.meta {
  display: flex;
  gap: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.details {
  padding: 0 var(--space-4) var(--space-4);
  border-top: 1px solid var(--color-border);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/PropertyCard.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Delete the superseded `ShortlistCard`**

```bash
git rm components/ShortlistCard.tsx components/ShortlistCard.test.tsx
```

- [ ] **Step 6: Run the full suite to confirm nothing else references `ShortlistCard`**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. If `tsc` reports an import error for `ShortlistCard`, it will be in `app/page.tsx` — that's expected and fixed in Task 12.

- [ ] **Step 7: Commit**

```bash
git add components/PropertyCard.tsx components/PropertyCard.module.css components/PropertyCard.test.tsx
git commit -m "feat: add PropertyCard, superseding ShortlistCard"
```

---

### Task 10: `BottomNav` component

**Files:**
- Create: `components/BottomNav.tsx`
- Create: `components/BottomNav.module.css`
- Test: `components/BottomNav.test.tsx`

**Interfaces:**
- Consumes: `HouseIcon`, `HeartIcon`, `MicIcon`, `PersonIcon` from `components/icons/icons.tsx` (Task 1).
- Produces: `BottomNav(props: { onOpenVoice: () => void }): JSX.Element`. Consumed by `app/page.tsx` (Task 12), wired to the same voice-sheet-open state as `FloatingMicButton`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/BottomNav.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BottomNav from './BottomNav';

describe('BottomNav', () => {
  it('marks Explore as the active tab', () => {
    render(<BottomNav onOpenVoice={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onOpenVoice when the AI Scout tab is clicked', () => {
    const onOpenVoice = vi.fn();
    render(<BottomNav onOpenVoice={onOpenVoice} />);

    screen.getByRole('button', { name: 'AI Scout' }).click();

    expect(onOpenVoice).toHaveBeenCalledTimes(1);
  });

  it('disables the Saved and Profile placeholder tabs', () => {
    render(<BottomNav onOpenVoice={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/BottomNav.test.tsx`
Expected: FAIL — `Failed to resolve import "./BottomNav"`.

- [ ] **Step 3: Write the component**

```tsx
// components/BottomNav.tsx
'use client';

import styles from './BottomNav.module.css';
import { HouseIcon, HeartIcon, MicIcon, PersonIcon } from './icons/icons';

interface BottomNavProps {
  onOpenVoice: () => void;
}

export default function BottomNav({ onOpenVoice }: BottomNavProps) {
  return (
    <nav className={styles.nav} aria-label="Primary" data-testid="bottom-nav">
      <button type="button" className={styles.itemActive} aria-current="page">
        <HouseIcon />
        <span>Explore</span>
      </button>
      <button type="button" className={styles.item} disabled>
        <HeartIcon />
        <span>Saved</span>
      </button>
      <button type="button" className={styles.item} onClick={onOpenVoice}>
        <MicIcon />
        <span>AI Scout</span>
      </button>
      <button type="button" className={styles.item} disabled>
        <PersonIcon />
        <span>Profile</span>
      </button>
    </nav>
  );
}
```

```css
/* components/BottomNav.module.css */
.nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  padding: var(--space-2) var(--space-2) var(--space-3);
  max-width: var(--max-content-width);
  margin: 0 auto;
  z-index: 10;
}

.item,
.itemActive {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  border: none;
  background: none;
  font-size: 0.75rem;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
}

.itemActive {
  background: var(--color-accent);
  color: var(--color-surface);
}

.item:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/BottomNav.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/BottomNav.tsx components/BottomNav.module.css components/BottomNav.test.tsx
git commit -m "feat: add BottomNav component"
```

---

### Task 11: `FloatingMicButton` and `VoiceSheet`

**Files:**
- Create: `components/FloatingMicButton.tsx`
- Create: `components/FloatingMicButton.module.css`
- Test: `components/FloatingMicButton.test.tsx`
- Create: `components/VoiceSheet.tsx`
- Create: `components/VoiceSheet.module.css`
- Test: `components/VoiceSheet.test.tsx`

**Interfaces:**
- Consumes: `MicIcon` from `components/icons/icons.tsx` (Task 1). `VoiceBar` (existing, unmodified, default export, no props) from `components/VoiceBar.tsx`.
- Produces: `FloatingMicButton(props: { onClick: () => void }): JSX.Element` and `VoiceSheet(props: { open: boolean; onClose: () => void }): JSX.Element`. Both consumed by `app/page.tsx` (Task 12), sharing one `voiceOpen` boolean state.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/FloatingMicButton.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FloatingMicButton from './FloatingMicButton';

describe('FloatingMicButton', () => {
  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<FloatingMicButton onClick={onClick} />);

    screen.getByRole('button', { name: 'Open voice assistant' }).click();

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

```tsx
// components/VoiceSheet.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VoiceSheet from './VoiceSheet';

vi.mock('./VoiceBar', () => ({
  default: () => <div data-testid="voice-bar-stub" />,
}));

describe('VoiceSheet', () => {
  it('renders nothing when closed', () => {
    render(<VoiceSheet open={false} onClose={vi.fn()} />);

    expect(screen.queryByTestId('voice-sheet')).not.toBeInTheDocument();
  });

  it('renders VoiceBar inside the sheet when open', () => {
    render(<VoiceSheet open onClose={vi.fn()} />);

    expect(screen.getByTestId('voice-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('voice-bar-stub')).toBeInTheDocument();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<VoiceSheet open onClose={onClose} />);

    fireEvent.click(screen.getByTestId('voice-sheet-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when the sheet content itself is clicked', () => {
    const onClose = vi.fn();
    render(<VoiceSheet open onClose={onClose} />);

    fireEvent.click(screen.getByTestId('voice-sheet'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<VoiceSheet open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close voice assistant' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/FloatingMicButton.test.tsx components/VoiceSheet.test.tsx`
Expected: FAIL — both `Failed to resolve import`.

- [ ] **Step 3: Write the components**

```tsx
// components/FloatingMicButton.tsx
'use client';

import styles from './FloatingMicButton.module.css';
import { MicIcon } from './icons/icons';

interface FloatingMicButtonProps {
  onClick: () => void;
}

export default function FloatingMicButton({ onClick }: FloatingMicButtonProps) {
  return (
    <button
      type="button"
      className={styles.button}
      aria-label="Open voice assistant"
      onClick={onClick}
      data-testid="floating-mic-button"
    >
      <MicIcon />
    </button>
  );
}
```

```css
/* components/FloatingMicButton.module.css */
.button {
  position: fixed;
  right: var(--space-4);
  bottom: 88px;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-surface);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-card);
  z-index: 20;
}
```

```tsx
// components/VoiceSheet.tsx
'use client';

import styles from './VoiceSheet.module.css';
import VoiceBar from './VoiceBar';

interface VoiceSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function VoiceSheet({ open, onClose }: VoiceSheetProps) {
  if (!open) return null;

  return (
    <div className={styles.backdrop} data-testid="voice-sheet-backdrop" onClick={onClose}>
      <div
        className={styles.sheet}
        data-testid="voice-sheet"
        role="dialog"
        aria-label="Voice assistant"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.closeButton} aria-label="Close voice assistant" onClick={onClose}>
          ×
        </button>
        <VoiceBar />
      </div>
    </div>
  );
}
```

```css
/* components/VoiceSheet.module.css */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 31, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 30;
}

.sheet {
  position: relative;
  width: 100%;
  max-width: var(--max-content-width);
  margin: 0 auto;
  background: var(--color-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: var(--space-5) var(--space-4);
}

.closeButton {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/FloatingMicButton.test.tsx components/VoiceSheet.test.tsx`
Expected: PASS (1 + 5 = 6 tests)

- [ ] **Step 5: Commit**

```bash
git add components/FloatingMicButton.tsx components/FloatingMicButton.module.css components/FloatingMicButton.test.tsx components/VoiceSheet.tsx components/VoiceSheet.module.css components/VoiceSheet.test.tsx
git commit -m "feat: add FloatingMicButton and VoiceSheet, wrapping VoiceBar unmodified"
```

---

### Task 12: Compose `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/page.test.tsx`

**Interfaces:**
- Consumes: every component from Tasks 5–11 (`Header`, `Hero`, `SearchBar`, `FilterPills`, `PropertyCard`, `BottomNav`, `FloatingMicButton`, `VoiceSheet`), plus existing `BookingPanel` and `EmailShortlistButton` (both page-level per the plan-time correction above, not per-card). Fetches `GET /api/shortlist?locality=&bedrooms=` → `ShortlistApiResponse` (Task 3) and `POST /api/shortlist/remove` (Task 4).
- Produces: the composed `Home` page — this is the plan's final integration point; no later task consumes it.

- [ ] **Step 1: Write the failing test**

```tsx
// app/page.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './page';

vi.mock('../components/SearchBar', () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button data-testid="search-stub" onClick={() => onChange('Koramangala')}>
      search stub
    </button>
  ),
}));
vi.mock('../components/FilterPills', () => ({
  default: ({ onBedroomsChange }: { onBedroomsChange: (b: number | undefined) => void }) => (
    <button data-testid="filter-stub" onClick={() => onBedroomsChange(2)}>
      filter stub
    </button>
  ),
}));

const fixtureItems = [
  {
    listing: {
      id: 'listing-1',
      societyName: 'Prestige Falcon City',
      locality: 'Koramangala',
      rent: 35000,
      bedrooms: 2,
      furnishing: 'Semi-furnished',
      amenities: ['Parking', 'Gym'],
      sqft: 1100,
      availabilityStatus: 'available',
      scrapedAt: '2026-08-10T00:00:00.000Z',
    },
    neighborhoodSnapshot: {
      transit: [{ text: 'Metro 10 min walk', source: 'OSM: find_nearby_places(transit)' }],
      safety: [{ text: 'Well lit at night', source: 'Wikipedia: Koramangala' }],
      amenities: [{ text: 'Several supermarkets', source: 'OSM: find_nearby_places(amenity)' }],
    },
    citations: [
      { label: 'Wikipedia: Koramangala', url: 'https://en.wikipedia.org/wiki/Koramangala', kind: 'rag' },
      { label: 'OSM: find_nearby_places(transit)', kind: 'osm' },
    ],
  },
  {
    listing: {
      id: 'listing-2',
      societyName: 'Sobha Dream Acres',
      locality: 'HSR Layout',
      rent: 42000,
      bedrooms: 2,
      furnishing: 'Unfurnished',
      amenities: ['Lift'],
      sqft: 950,
      availabilityStatus: 'available',
      scrapedAt: '2026-08-10T00:00:00.000Z',
    },
    neighborhoodSnapshot: {
      transit: [],
      safety: [{ text: 'Quiet residential lanes', source: 'Wikipedia: HSR Layout' }],
      amenities: [],
      uncertain: { transit: true, amenities: true },
    },
    citations: [{ label: 'Wikipedia: HSR Layout', url: 'https://en.wikipedia.org/wiki/HSR_Layout', kind: 'rag' }],
  },
];

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe('Home (companion UI shell)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sessionId: 'sess-1', items: fixtureItems }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads the shortlist and renders a PropertyCard per item, plus EmailShortlistButton once a sessionId is known', async () => {
    render(<Home />);

    expect(screen.getByTestId('shortlist-loading')).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    expect(screen.getByText('Prestige Falcon City, Koramangala')).toBeInTheDocument();
    expect(screen.getByText('Sobha Dream Acres, HSR Layout')).toBeInTheDocument();
    expect(screen.getByTestId('booking-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith('/api/shortlist');
  });

  it('removes a card immediately when its heart button is clicked, and posts the removal', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    fetchMock.mockResolvedValueOnce(jsonResponse({ changed: [1], unchanged: [2] }));
    fireEvent.click(screen.getByRole('button', { name: /remove prestige falcon city from shortlist/i }));

    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/shortlist/remove',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ listingId: 1 }) })
    );
  });

  it('refetches the shortlist with a locality query param when the search bar reports a change', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('search-stub'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/shortlist?locality=Koramangala'));
  });

  it('refetches the shortlist with a bedrooms query param when a filter pill reports a change', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('filter-stub'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/shortlist?bedrooms=2'));
  });

  it('opens the voice sheet from the floating mic button', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    expect(screen.queryByTestId('voice-sheet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open voice assistant' }));
    expect(screen.getByTestId('voice-sheet')).toBeInTheDocument();
  });

  it('opens the voice sheet from the bottom nav AI Scout tab', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'AI Scout' }));
    expect(screen.getByTestId('voice-sheet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — current `app/page.tsx` renders `ShortlistCard`/`NeighborhoodPanel` directly, expects a bare-array fetch response, has no `PropertyCard`/`Header`/`Hero`/search/filter/voice-sheet/bottom-nav elements.

- [ ] **Step 3: Rewrite the page**

```tsx
// app/page.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Header from '../components/Header';
import Hero from '../components/Hero';
import SearchBar from '../components/SearchBar';
import FilterPills from '../components/FilterPills';
import PropertyCard from '../components/PropertyCard';
import BottomNav from '../components/BottomNav';
import FloatingMicButton from '../components/FloatingMicButton';
import VoiceSheet from '../components/VoiceSheet';
import BookingPanel from '../components/BookingPanel';
import { EmailShortlistButton } from '../components/EmailShortlistButton';
import { Booking, ShortlistApiItem, ShortlistApiResponse } from '../lib/types';

export default function Home() {
  const [items, setItems] = useState<ShortlistApiItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locality, setLocality] = useState('');
  const [bedrooms, setBedrooms] = useState<number | undefined>(undefined);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [booking] = useState<Booking | undefined>(undefined);

  const loadShortlist = useCallback(async (nextLocality: string, nextBedrooms: number | undefined) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextLocality) params.set('locality', nextLocality);
      if (nextBedrooms !== undefined) params.set('bedrooms', String(nextBedrooms));
      const query = params.toString();
      const res = await fetch(`/api/shortlist${query ? `?${query}` : ''}`);
      if (!res.ok) throw new Error('failed to load shortlist');
      const data: ShortlistApiResponse = await res.json();
      setSessionId(data.sessionId);
      setItems(data.items);
    } catch {
      setError('Could not load your shortlist. Try again shortly.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShortlist(locality, bedrooms);
  }, [locality, bedrooms, loadShortlist]);

  async function handleRemove(listingId: string) {
    const previous = items;
    setItems((current) => current.filter((item) => item.listing.id !== listingId));

    try {
      const res = await fetch('/api/shortlist/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: Number(listingId) }),
      });
      if (!res.ok) throw new Error('remove failed');
    } catch {
      setItems(previous);
    }
  }

  return (
    <main data-testid="companion-ui">
      <Header />
      <Hero />
      <SearchBar defaultValue={locality} onChange={setLocality} />
      <FilterPills bedrooms={bedrooms} onBedroomsChange={setBedrooms} />

      <section aria-label="Featured properties">
        {loading && <p data-testid="shortlist-loading">Loading your shortlist...</p>}
        {error && <p data-testid="shortlist-error">{error}</p>}

        {!loading && !error && (
          <div data-testid="shortlist-items">
            {items.map((item) => (
              <PropertyCard key={item.listing.id} item={item} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </section>

      {sessionId && <EmailShortlistButton sessionId={sessionId} />}
      <BookingPanel booking={booking} />

      <FloatingMicButton onClick={() => setVoiceOpen(true)} />
      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} />
      <BottomNav onOpenVoice={() => setVoiceOpen(true)} />
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/page.test.tsx
git commit -m "feat: compose the redesigned Property Scout Explore screen"
```

---

### Task 13: Full verification and documentation update

**Files:**
- Modify: `docs/IMPLEMENTATION_PLAN.md`

No new production code in this task — it verifies the whole feature together (unit tests alone don't catch composition/runtime issues like a missing CSS Module class or a broken fetch URL) and records the two known, documented limitations.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, all tests (existing 130 + this plan's new ones).

- [ ] **Step 2: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Live-verify in a real browser**

Run: `npx next dev` (background), then use the chrome-devtools MCP tools (`new_page`, `take_screenshot`, `list_console_messages`) or manually open `http://localhost:3000`:
- Confirm the header, hero, search bar, filter pills, and property cards render with real data (matching the general layout of `data/UI.png`).
- Type a real locality from the seeded data (e.g. one already visible in a card's address) into the search bar, wait ~300ms, and confirm the list narrows to matching cards.
- Click a "2 BHK"/"3 BHK" pill and confirm the list updates; click it again and confirm it clears.
- Tap a card body and confirm it expands to show `NeighborhoodPanel` and `SourcesPanel` content; tap again to collapse.
- Click a heart icon and confirm the card disappears immediately, and does not reappear after a page reload (proves the `dropped` exclusion in Task 3 persists).
- Click the floating mic button and confirm the voice sheet opens with the mic control inside; close it via the backdrop and via the × button.
- Click "AI Scout" in the bottom nav and confirm it also opens the voice sheet.
- Confirm "Saved" and "Profile" are visibly disabled and do nothing when clicked.
- Check the browser console for errors (`list_console_messages` or DevTools) — none should originate from app code.
- Stop the dev server when done.

- [ ] **Step 4: Update `docs/IMPLEMENTATION_PLAN.md`**

Add a row to the subsystem table (§1) for the redesigned Companion UI reflecting: built ✅, unit-tested ✅ (note the new component/route test counts), live-verified ✅ with the specifics from Step 3. In the "Known, flagged limitations" section (§4), add:
- `searchListings`'s locality filter is an exact match — the new search bar only returns results for a locality typed exactly as stored (see Global Constraints in this plan).
- `GET /api/shortlist` writes DB rows on every read (session seeding) — documented and deliberate, not an oversight (see the design spec §8).

- [ ] **Step 5: Commit**

```bash
git add docs/IMPLEMENTATION_PLAN.md
git commit -m "docs: record Property Scout UI redesign status and known limitations"
```

---

## Self-Review Notes

- **Spec coverage:** All of spec §4 (component breakdown), §5 (backend changes), §6 (interaction details) map to tasks 1–12. §7 (testing) is satisfied task-by-task plus Task 13's full-suite run. The two plan-time corrections (booking/email placement, response shape) are called out explicitly rather than silently diverging.
- **Placeholder scan:** No TBD/TODO; every step has complete, real code.
- **Type consistency:** `ShortlistApiItem`/`ShortlistApiResponse` (Task 2) match their usage in Task 3 (`route.ts`), Task 9 (`PropertyCard`), and Task 12 (`page.tsx`). `PropertyCard`'s `onRemove: (listingId: string) => void` matches `page.tsx`'s `handleRemove(listingId: string)`. `SESSION_COOKIE_NAME` is imported from `app/api/agent/route.ts` consistently in Tasks 3 and 4, matching its existing export.
