
# Companion UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the voice-first property scout's companion UI — shortlist cards, a per-listing neighborhood snapshot panel with sourced claims, a mic button with live transcript, a sources/citations panel, and a visit-confirmation panel — wired together on the app shell page.

**Architecture:** Five small, pure/interactive React components (`components/*.tsx`) each own one panel from `problem_statement.md`'s Companion UI requirements, plus `app/page.tsx` which fetches the session shortlist and composes them. Components consume shared TypeScript types (`lib/types.ts`) and the voice-pipeline subsystem's already-built `useVoiceRecorder`/`playAudio` hooks and `/api/stt`, `/api/tts`, `/api/agent`, `/api/shortlist` routes — all mocked in tests, never called for real. No component talks to a database or LLM directly; everything is props-in/fetch-out.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + Tailwind (already scaffolded), React function components, Vitest + `@testing-library/react` + jsdom for tests, `vi.stubGlobal('fetch', ...)` for API mocking, `vi.mock(...)` for the voice-pipeline module mocks.

## Global Constraints

- Testing: Vitest + `@testing-library/react` + jsdom (per `docs/ARCHITECTURE.md` §1 "Testing" row). `npm test` must run with zero live credentials/backend — all `fetch` calls and voice-pipeline hooks are mocked in every test in this plan.
- No PII: components must never render owner/agent names or phone numbers. The `Listing` type has no such fields by design (`docs/ARCHITECTURE.md` §4) — do not add any.
- Grounding & Hallucination rule (`problem_statement.md` Data Requirements / AI Evaluations): "If listing, amenity, or neighborhood data is missing or unreliable, the system must say so, not guess." `NeighborhoodPanel` must render an explicit unavailable message for missing/uncertain sections — never a blank section and never invented text.
- Citations rule (`problem_statement.md` RAG Requirements): "citations must appear in the UI" — every neighborhood claim rendered by `NeighborhoodPanel` carries a visible `source` tag, and `SourcesPanel` aggregates all citations for the session.
- Component file paths are fixed by this plan (given by the task assignment) and must be created exactly as named — do not nest them under `app/components/`.
- Do not install packages, change `package.json`, or touch Vitest/Next.js config — the scaffold plan already configured these. If a step assumes a config value (e.g. no path aliases), it uses plain relative imports instead, to avoid depending on unconfirmed scaffold config.

## Interfaces Consumed From Other Subsystems (treat as already implemented; mock in tests)

- `lib/voice/useVoiceRecorder(): { isRecording: boolean; start(): void; stop(): Promise<Blob> }` — voice-pipeline subsystem.
- `lib/voice/playAudio(blobOrUrl: Blob | string): Promise<void>` — voice-pipeline subsystem.
- `POST /api/stt` — body: audio `FormData` → JSON `{ text: string }`.
- `POST /api/tts` — body: `{ text: string }` → audio bytes (consumed as a `Blob` via `res.blob()`).
- `POST /api/agent` — body: `{ message: string }` → text reply (consumed via `res.text()`).
- `GET /api/shortlist` — → JSON array of `{ listing: Listing, neighborhoodSnapshot: {...}, citations: [...] }`.
- `Listing` shape: `{ id, societyName, locality, rent, bedrooms, furnishing, amenities: string[], sqft, availabilityStatus }`.

## File Structure

```
lib/
  types.ts                        # shared TS types for all UI components (new, owned by this plan)
components/
  ShortlistCard.tsx                # rent/bedrooms/area/amenities/availability, pure presentational
  ShortlistCard.test.tsx
  NeighborhoodPanel.tsx             # transit/safety/amenities sections, each claim source-tagged
  NeighborhoodPanel.test.tsx
  SourcesPanel.tsx                  # de-duplicated flat citation list (RAG links + OSM tags)
  SourcesPanel.test.tsx
  BookingPanel.tsx                  # visit-confirmation panel: empty / tentative / cancelled / rescheduled
  BookingPanel.test.tsx
  VoiceBar.tsx                      # mic button + live transcript + agent reply, calls stt/agent/tts
  VoiceBar.test.tsx
app/
  page.tsx                          # companion UI shell: fetches shortlist, composes all panels
  page.test.tsx
```

Each component is single-responsibility and takes only the props/hooks it needs — `app/page.tsx` is the only file that fetches `/api/shortlist` and owns cross-item aggregation (citations) and booking state.

---

### Task 1: Shared types + `ShortlistCard`

**Files:**
- Create: `lib/types.ts`
- Create: `components/ShortlistCard.tsx`
- Test: `components/ShortlistCard.test.tsx`

**Interfaces:**
- Consumes: `Listing` shape as given in Global Constraints (defined here in `lib/types.ts` for the whole subsystem to import).
- Produces: `lib/types.ts` exports `AvailabilityStatus`, `Listing`, `SourcedClaim`, `NeighborhoodSnapshot`, `CitationKind`, `Citation`, `BookingStatus`, `Booking`, `ShortlistApiItem` — every other task in this plan imports its types from here. `components/ShortlistCard.tsx` default-exports `ShortlistCard(props: { listing: Listing })`.

- [ ] **Step 1: Create the shared types file**

```ts
// lib/types.ts
export type AvailabilityStatus = 'available' | 'not_for_rent';

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
}

export interface SourcedClaim {
  text: string;
  source: string;
}

export interface NeighborhoodSnapshot {
  transit: SourcedClaim[];
  safety: SourcedClaim[];
  amenities: SourcedClaim[];
  uncertain?: {
    transit?: boolean;
    safety?: boolean;
    amenities?: boolean;
  };
}

export type CitationKind = 'rag' | 'osm';

export interface Citation {
  label: string;
  url?: string;
  kind: CitationKind;
}

export type BookingStatus = 'tentative' | 'cancelled' | 'rescheduled';

export interface Booking {
  slotLabel: string;
  confirmationCode: string;
  status: BookingStatus;
}

export interface ShortlistApiItem {
  listing: Listing;
  neighborhoodSnapshot: NeighborhoodSnapshot;
  citations: Citation[];
}
```

This is a types-only file (no runtime logic), so it has no dedicated test — it's exercised transitively by every component test in this plan.

- [ ] **Step 2: Write the failing test for `ShortlistCard`**

```tsx
// components/ShortlistCard.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ShortlistCard from './ShortlistCard';
import { Listing } from '../lib/types';

const baseListing: Listing = {
  id: 'listing-1',
  societyName: 'Prestige Falcon City',
  locality: 'Koramangala',
  rent: 35000,
  bedrooms: 2,
  furnishing: 'Semi-furnished',
  amenities: ['Parking', 'Gym', 'Lift', 'Power backup', 'Swimming pool'],
  sqft: 1100,
  availabilityStatus: 'available',
};

describe('ShortlistCard', () => {
  it('renders rent, bedrooms, area, and key amenities from props', () => {
    render(<ShortlistCard listing={baseListing} />);

    expect(screen.getByText('Prestige Falcon City')).toBeInTheDocument();
    expect(screen.getByTestId('listing-locality')).toHaveTextContent('Koramangala');
    expect(screen.getByTestId('listing-rent')).toHaveTextContent('35,000');
    expect(screen.getByTestId('listing-bedrooms')).toHaveTextContent('2 BHK');
    expect(screen.getByTestId('availability-badge')).toHaveTextContent('Available');

    const amenities = screen.getByTestId('amenities-list');
    expect(amenities).toHaveTextContent('Parking');
    expect(amenities).toHaveTextContent('Gym');
    expect(amenities).not.toHaveTextContent('Swimming pool'); // only first 4 amenities are shown
  });

  it('renders sensibly when amenities is empty', () => {
    render(<ShortlistCard listing={{ ...baseListing, amenities: [] }} />);

    expect(screen.getByTestId('amenities-empty')).toHaveTextContent('No amenities listed.');
    expect(screen.queryByTestId('amenities-list')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run components/ShortlistCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./ShortlistCard"` (module does not exist yet).

- [ ] **Step 4: Implement `ShortlistCard`**

```tsx
// components/ShortlistCard.tsx
import { Listing } from '../lib/types';

interface ShortlistCardProps {
  listing: Listing;
}

const MAX_AMENITIES_SHOWN = 4;

export default function ShortlistCard({ listing }: ShortlistCardProps) {
  const keyAmenities = listing.amenities.slice(0, MAX_AMENITIES_SHOWN);

  return (
    <article aria-label={listing.societyName} data-testid="shortlist-card">
      <h3>{listing.societyName}</h3>
      <p data-testid="listing-locality">{listing.locality}</p>
      <p data-testid="listing-rent">Rs {listing.rent.toLocaleString('en-IN')}/mo</p>
      <p data-testid="listing-bedrooms">{listing.bedrooms} BHK</p>
      <p data-testid="listing-sqft">{listing.sqft} sqft</p>
      <p data-testid="listing-furnishing">{listing.furnishing}</p>
      <span data-testid="availability-badge" data-status={listing.availabilityStatus}>
        {listing.availabilityStatus === 'available' ? 'Available' : 'Not for rent'}
      </span>
      {keyAmenities.length > 0 ? (
        <ul data-testid="amenities-list">
          {keyAmenities.map((amenity) => (
            <li key={amenity}>{amenity}</li>
          ))}
        </ul>
      ) : (
        <p data-testid="amenities-empty">No amenities listed.</p>
      )}
    </article>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run components/ShortlistCard.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts components/ShortlistCard.tsx components/ShortlistCard.test.tsx
git commit -m "feat(ui): add shared UI types and ShortlistCard component"
```

---

### Task 2: `NeighborhoodPanel`

**Files:**
- Create: `components/NeighborhoodPanel.tsx`
- Test: `components/NeighborhoodPanel.test.tsx`

**Interfaces:**
- Consumes: `SourcedClaim`, `NeighborhoodSnapshot` from `lib/types.ts` (Task 1).
- Produces: `components/NeighborhoodPanel.tsx` default-exports `NeighborhoodPanel(props: { snapshot: NeighborhoodSnapshot })`. Renders `data-testid="neighborhood-panel"` on its root, `data-testid="{transit|safety|amenities}-section"` per section, and `data-testid="{section}-unavailable"` when a section has no data. Later tasks (`app/page.tsx`) rely on these exact test ids to assert per-item rendering.

- [ ] **Step 1: Write the failing test**

```tsx
// components/NeighborhoodPanel.test.tsx
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import NeighborhoodPanel from './NeighborhoodPanel';

describe('NeighborhoodPanel', () => {
  it('renders source tags for each claim in every section', () => {
    render(
      <NeighborhoodPanel
        snapshot={{
          transit: [{ text: 'Metro station 10 min walk', source: 'OSM: find_nearby_places(transit)' }],
          safety: [{ text: 'Well-lit main roads at night', source: 'Wikipedia: Koramangala' }],
          amenities: [{ text: 'Multiple supermarkets nearby', source: 'OSM: find_nearby_places(amenity)' }],
        }}
      />
    );

    const transitSection = screen.getByTestId('transit-section');
    expect(within(transitSection).getByText(/Metro station 10 min walk/)).toBeInTheDocument();
    expect(within(transitSection).getByText(/OSM: find_nearby_places\(transit\)/)).toBeInTheDocument();

    const safetySection = screen.getByTestId('safety-section');
    expect(within(safetySection).getByText(/Well-lit main roads at night/)).toBeInTheDocument();
    expect(within(safetySection).getByText(/Wikipedia: Koramangala/)).toBeInTheDocument();

    const amenitiesSection = screen.getByTestId('amenities-section');
    expect(within(amenitiesSection).getByText(/Multiple supermarkets nearby/)).toBeInTheDocument();
    expect(within(amenitiesSection).getByText(/OSM: find_nearby_places\(amenity\)/)).toBeInTheDocument();
  });

  it('shows an explicit unavailable message for uncertain or empty sections instead of leaving them blank', () => {
    render(
      <NeighborhoodPanel
        snapshot={{
          transit: [],
          safety: [{ text: 'Generally quiet residential lanes', source: 'Wikipedia: HSR Layout' }],
          amenities: [],
          uncertain: { amenities: true },
        }}
      />
    );

    expect(screen.getByTestId('transit-unavailable')).toHaveTextContent('Data unavailable for this area.');
    expect(screen.getByTestId('amenities-unavailable')).toHaveTextContent('Data unavailable for this area.');
    expect(screen.queryByTestId('safety-unavailable')).not.toBeInTheDocument();
    expect(screen.getByTestId('safety-section')).toHaveTextContent('Generally quiet residential lanes');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/NeighborhoodPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./NeighborhoodPanel"`.

- [ ] **Step 3: Implement `NeighborhoodPanel`**

```tsx
// components/NeighborhoodPanel.tsx
import { NeighborhoodSnapshot, SourcedClaim } from '../lib/types';

interface NeighborhoodPanelProps {
  snapshot: NeighborhoodSnapshot;
}

type SectionKey = 'transit' | 'safety' | 'amenities';

const SECTION_LABELS: Record<SectionKey, string> = {
  transit: 'Transit',
  safety: 'Safety',
  amenities: 'Amenities',
};

function Section({
  id,
  title,
  claims,
  isUncertain,
}: {
  id: SectionKey;
  title: string;
  claims: SourcedClaim[];
  isUncertain: boolean;
}) {
  const showUnavailable = isUncertain || claims.length === 0;

  return (
    <div data-testid={`${id}-section`}>
      <h3>{title}</h3>
      {showUnavailable ? (
        <p data-testid={`${id}-unavailable`}>Data unavailable for this area.</p>
      ) : (
        <ul>
          {claims.map((claim, index) => (
            <li key={`${id}-${index}`}>
              <span>{claim.text}</span>
              <span data-testid={`${id}-source-${index}`}> — {claim.source}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NeighborhoodPanel({ snapshot }: NeighborhoodPanelProps) {
  return (
    <section aria-label="Neighborhood snapshot" data-testid="neighborhood-panel">
      <Section
        id="transit"
        title={SECTION_LABELS.transit}
        claims={snapshot.transit}
        isUncertain={Boolean(snapshot.uncertain?.transit)}
      />
      <Section
        id="safety"
        title={SECTION_LABELS.safety}
        claims={snapshot.safety}
        isUncertain={Boolean(snapshot.uncertain?.safety)}
      />
      <Section
        id="amenities"
        title={SECTION_LABELS.amenities}
        claims={snapshot.amenities}
        isUncertain={Boolean(snapshot.uncertain?.amenities)}
      />
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/NeighborhoodPanel.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add components/NeighborhoodPanel.tsx components/NeighborhoodPanel.test.tsx
git commit -m "feat(ui): add NeighborhoodPanel with sourced claims and uncertainty states"
```

---

### Task 3: `SourcesPanel`

**Files:**
- Create: `components/SourcesPanel.tsx`
- Test: `components/SourcesPanel.test.tsx`

**Interfaces:**
- Consumes: `Citation` from `lib/types.ts` (Task 1).
- Produces: `components/SourcesPanel.tsx` default-exports `SourcesPanel(props: { citations: Citation[] })`, root `data-testid="sources-panel"`, each rendered citation wrapped in `data-testid="citation-item"`. `app/page.tsx` (Task 6) relies on this component accepting a flattened array of citations aggregated from multiple shortlist items.

- [ ] **Step 1: Write the failing test**

```tsx
// components/SourcesPanel.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SourcesPanel from './SourcesPanel';

describe('SourcesPanel', () => {
  it('dedupes citations by label+url and renders RAG links and OSM tags', () => {
    render(
      <SourcesPanel
        citations={[
          { label: 'Wikipedia: Koramangala', url: 'https://en.wikipedia.org/wiki/Koramangala', kind: 'rag' },
          { label: 'Wikipedia: Koramangala', url: 'https://en.wikipedia.org/wiki/Koramangala', kind: 'rag' },
          { label: 'OSM: find_nearby_places(transit)', kind: 'osm' },
        ]}
      />
    );

    const items = screen.getAllByTestId('citation-item');
    expect(items).toHaveLength(2);

    const link = screen.getByRole('link', { name: 'Wikipedia: Koramangala' });
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Koramangala');

    expect(screen.getByText('OSM: find_nearby_places(transit)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /OSM/i })).not.toBeInTheDocument();
  });

  it('renders a citation with no url as plain text, not a link', () => {
    render(<SourcesPanel citations={[{ label: 'Neighborhood guide (source pending)', kind: 'rag' }]} />);

    expect(screen.getByText('Neighborhood guide (source pending)')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/SourcesPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./SourcesPanel"`.

- [ ] **Step 3: Implement `SourcesPanel`**

```tsx
// components/SourcesPanel.tsx
import { Citation } from '../lib/types';

interface SourcesPanelProps {
  citations: Citation[];
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];
  for (const citation of citations) {
    const key = `${citation.label}|${citation.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

export default function SourcesPanel({ citations }: SourcesPanelProps) {
  const uniqueCitations = dedupeCitations(citations);

  if (uniqueCitations.length === 0) {
    return (
      <section aria-label="Sources" data-testid="sources-panel">
        <p data-testid="sources-empty">No sources cited yet.</p>
      </section>
    );
  }

  return (
    <section aria-label="Sources" data-testid="sources-panel">
      <ul>
        {uniqueCitations.map((citation) => (
          <li key={`${citation.label}|${citation.url ?? ''}`} data-testid="citation-item">
            <span data-testid="citation-kind">{citation.kind === 'rag' ? 'RAG' : 'OSM'}</span>{' '}
            {citation.kind === 'rag' && citation.url ? (
              <a href={citation.url} target="_blank" rel="noreferrer">
                {citation.label}
              </a>
            ) : (
              <span>{citation.label}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/SourcesPanel.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add components/SourcesPanel.tsx components/SourcesPanel.test.tsx
git commit -m "feat(ui): add SourcesPanel with de-duplicated RAG/OSM citations"
```

---

### Task 4: `BookingPanel`

**Files:**
- Create: `components/BookingPanel.tsx`
- Test: `components/BookingPanel.test.tsx`

**Interfaces:**
- Consumes: `Booking`, `BookingStatus` from `lib/types.ts` (Task 1).
- Produces: `components/BookingPanel.tsx` default-exports `BookingPanel(props: { booking?: Booking })`, root `data-testid="booking-panel"`, empty state `data-testid="booking-empty"`, populated state `data-testid="booking-slot"` / `"booking-code"` / `"booking-status"`. `app/page.tsx` (Task 6) renders this with `booking` initially `undefined`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/BookingPanel.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BookingPanel from './BookingPanel';

describe('BookingPanel', () => {
  it('renders an empty state when there is no booking', () => {
    render(<BookingPanel />);
    expect(screen.getByTestId('booking-empty')).toHaveTextContent('No booking yet');
  });

  it('renders slot, confirmation code, and message for a tentative booking', () => {
    render(
      <BookingPanel
        booking={{ slotLabel: 'Sat, 10 Aug, 10:00 AM', confirmationCode: 'NL-A742', status: 'tentative' }}
      />
    );
    expect(screen.getByTestId('booking-slot')).toHaveTextContent('Sat, 10 Aug, 10:00 AM');
    expect(screen.getByTestId('booking-code')).toHaveTextContent('NL-A742');
    expect(screen.getByTestId('booking-status')).toHaveTextContent('tentatively booked');
  });

  it('renders a cancelled-specific message', () => {
    render(
      <BookingPanel
        booking={{ slotLabel: 'Sat, 10 Aug, 10:00 AM', confirmationCode: 'NL-A742', status: 'cancelled' }}
      />
    );
    expect(screen.getByTestId('booking-status')).toHaveTextContent('cancelled');
  });

  it('renders a rescheduled-specific message', () => {
    render(
      <BookingPanel
        booking={{ slotLabel: 'Sun, 11 Aug, 3:00 PM', confirmationCode: 'NL-B913', status: 'rescheduled' }}
      />
    );
    expect(screen.getByTestId('booking-slot')).toHaveTextContent('Sun, 11 Aug, 3:00 PM');
    expect(screen.getByTestId('booking-status')).toHaveTextContent('rescheduled');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/BookingPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./BookingPanel"`.

- [ ] **Step 3: Implement `BookingPanel`**

```tsx
// components/BookingPanel.tsx
import { Booking } from '../lib/types';

interface BookingPanelProps {
  booking?: Booking;
}

const STATUS_MESSAGES: Record<Booking['status'], string> = {
  tentative: 'Your visit is tentatively booked. We will confirm shortly.',
  cancelled: 'This visit has been cancelled.',
  rescheduled: 'This visit has been rescheduled to a new slot.',
};

export default function BookingPanel({ booking }: BookingPanelProps) {
  if (!booking) {
    return (
      <section aria-label="Visit confirmation" data-testid="booking-panel">
        <p data-testid="booking-empty">No booking yet. Ask to schedule a visit to see it here.</p>
      </section>
    );
  }

  return (
    <section aria-label="Visit confirmation" data-testid="booking-panel">
      <p data-testid="booking-slot">{booking.slotLabel}</p>
      <p data-testid="booking-code">Confirmation code: {booking.confirmationCode}</p>
      <p data-testid="booking-status">{STATUS_MESSAGES[booking.status]}</p>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/BookingPanel.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/BookingPanel.tsx components/BookingPanel.test.tsx
git commit -m "feat(ui): add BookingPanel with empty/tentative/cancelled/rescheduled states"
```

---

### Task 5: `VoiceBar`

**Files:**
- Create: `components/VoiceBar.tsx`
- Test: `components/VoiceBar.test.tsx`

**Interfaces:**
- Consumes: `lib/voice/useVoiceRecorder(): { isRecording: boolean; start(): void; stop(): Promise<Blob> }`, `lib/voice/playAudio(blobOrUrl: Blob | string): Promise<void>` (voice-pipeline subsystem, mocked here), `POST /api/stt` → `{ text: string }`, `POST /api/agent` → text reply, `POST /api/tts` → audio bytes (all mocked via `vi.stubGlobal('fetch', ...)`).
- Produces: `components/VoiceBar.tsx` default-exports `VoiceBar()` (no props). Root `data-testid="voice-bar"`; mic button toggles accessible name between `"Start recording"` / `"Stop recording"`; `data-testid="transcript"` and `data-testid="agent-reply"` hold the live transcript and agent's reply text. `app/page.tsx` (Task 6) renders `<VoiceBar />` with no props.

- [ ] **Step 1: Write the failing test**

```tsx
// components/VoiceBar.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VoiceBar from './VoiceBar';
import { useVoiceRecorder } from '../lib/voice/useVoiceRecorder';
import { playAudio } from '../lib/voice/playAudio';

vi.mock('../lib/voice/useVoiceRecorder', () => ({
  useVoiceRecorder: vi.fn(),
}));
vi.mock('../lib/voice/playAudio', () => ({
  playAudio: vi.fn(),
}));

describe('VoiceBar', () => {
  const startMock = vi.fn();
  const stopMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useVoiceRecorder).mockReturnValue({
      isRecording: false,
      start: startMock,
      stop: stopMock,
    });
    vi.mocked(playAudio).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts recording on first click, then stops, transcribes, and shows the agent reply on second click', async () => {
    const blob = new Blob(['audio-bytes'], { type: 'audio/webm' });
    stopMock.mockResolvedValue(blob);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'find a 2bhk in Koramangala' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'Here are 3 matching listings.',
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['tts-bytes'], { type: 'audio/mpeg' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    expect(startMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
    expect(stopMock).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(screen.getByTestId('transcript')).toHaveTextContent('find a 2bhk in Koramangala')
    );

    await waitFor(() =>
      expect(screen.getByTestId('agent-reply')).toHaveTextContent('Here are 3 matching listings.')
    );

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/stt', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/agent',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'find a 2bhk in Koramangala' }),
      })
    );

    await waitFor(() => expect(playAudio).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/VoiceBar.test.tsx`
Expected: FAIL — `Failed to resolve import "./VoiceBar"`.

- [ ] **Step 3: Implement `VoiceBar`**

```tsx
// components/VoiceBar.tsx
'use client';

import { useState } from 'react';
import { useVoiceRecorder } from '../lib/voice/useVoiceRecorder';
import { playAudio } from '../lib/voice/playAudio';

const TTS_MAX_CHARS = 200;

type VoiceStatus = 'idle' | 'transcribing' | 'thinking' | 'error';

export default function VoiceBar() {
  const { start, stop } = useVoiceRecorder();
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState<VoiceStatus>('idle');

  async function handleMicClick() {
    if (!recording) {
      start();
      setRecording(true);
      return;
    }

    setRecording(false);
    setStatus('transcribing');

    try {
      const blob = await stop();

      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      const sttRes = await fetch('/api/stt', { method: 'POST', body: formData });
      if (!sttRes.ok) throw new Error('stt failed');
      const { text } = await sttRes.json();
      setTranscript(text);

      setStatus('thinking');
      const agentRes = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!agentRes.ok) throw new Error('agent failed');
      const replyText = await agentRes.text();
      setReply(replyText);
      setStatus('idle');

      if (replyText.length > 0 && replyText.length <= TTS_MAX_CHARS) {
        try {
          const ttsRes = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: replyText }),
          });
          if (ttsRes.ok) {
            const audioBlob = await ttsRes.blob();
            await playAudio(audioBlob);
          }
        } catch {
          // Speaking the reply is a nice-to-have; a TTS/playback failure must not
          // hide the text reply that's already rendered.
        }
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <section aria-label="Voice assistant" data-testid="voice-bar">
      <button type="button" onClick={handleMicClick} aria-pressed={recording}>
        {recording ? 'Stop recording' : 'Start recording'}
      </button>
      <p data-testid="voice-status">{status}</p>
      <p data-testid="transcript">{transcript || 'Say something to get started.'}</p>
      <p data-testid="agent-reply">{reply}</p>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/VoiceBar.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add components/VoiceBar.tsx components/VoiceBar.test.tsx
git commit -m "feat(ui): add VoiceBar mic control with stt/agent/tts wiring"
```

---

### Task 6: `app/page.tsx` — companion UI shell

**Files:**
- Create: `app/page.tsx`
- Test: `app/page.test.tsx`

**Interfaces:**
- Consumes: `ShortlistCard` (Task 1), `NeighborhoodPanel` (Task 2), `SourcesPanel` (Task 3), `BookingPanel` (Task 4), `VoiceBar` (Task 5), `ShortlistApiItem`/`Citation`/`Booking` types (Task 1), `GET /api/shortlist` → `ShortlistApiItem[]` (mocked via `vi.stubGlobal('fetch', ...)`), `lib/voice/useVoiceRecorder`/`lib/voice/playAudio` (mocked, since `VoiceBar` is rendered here transitively).
- Produces: default export `Home()`, the page component Next.js renders at `/`. No other task depends on this file's exports — it's the composition root.

- [ ] **Step 1: Write the failing test**

```tsx
// app/page.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './page';
import { useVoiceRecorder } from '../lib/voice/useVoiceRecorder';

vi.mock('../lib/voice/useVoiceRecorder', () => ({
  useVoiceRecorder: vi.fn(),
}));
vi.mock('../lib/voice/playAudio', () => ({
  playAudio: vi.fn(),
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
    },
    neighborhoodSnapshot: {
      transit: [],
      safety: [{ text: 'Quiet residential lanes', source: 'Wikipedia: HSR Layout' }],
      amenities: [],
      uncertain: { transit: true, amenities: true },
    },
    citations: [
      { label: 'Wikipedia: HSR Layout', url: 'https://en.wikipedia.org/wiki/HSR_Layout', kind: 'rag' },
    ],
  },
];

describe('Home (companion UI shell)', () => {
  beforeEach(() => {
    vi.mocked(useVoiceRecorder).mockReturnValue({
      isRecording: false,
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(new Blob()),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fixtureItems,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads the shortlist and renders a card, neighborhood panel, sources, and booking panel per item', async () => {
    render(<Home />);

    expect(screen.getByTestId('shortlist-loading')).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByTestId('shortlist-item')).toHaveLength(2));

    expect(screen.getByText('Prestige Falcon City')).toBeInTheDocument();
    expect(screen.getByText('Sobha Dream Acres')).toBeInTheDocument();

    expect(screen.getAllByTestId('neighborhood-panel')).toHaveLength(2);

    expect(screen.getByRole('link', { name: 'Wikipedia: Koramangala' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wikipedia: HSR Layout' })).toBeInTheDocument();

    expect(screen.getByTestId('booking-empty')).toBeInTheDocument();

    expect(screen.getByTestId('voice-bar')).toBeInTheDocument();

    expect(fetch).toHaveBeenCalledWith('/api/shortlist');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — `Failed to resolve import "./page"`.

- [ ] **Step 3: Implement `app/page.tsx`**

```tsx
// app/page.tsx
'use client';

import { useEffect, useState } from 'react';
import ShortlistCard from '../components/ShortlistCard';
import NeighborhoodPanel from '../components/NeighborhoodPanel';
import VoiceBar from '../components/VoiceBar';
import SourcesPanel from '../components/SourcesPanel';
import BookingPanel from '../components/BookingPanel';
import { Booking, Citation, ShortlistApiItem } from '../lib/types';

export default function Home() {
  const [items, setItems] = useState<ShortlistApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking] = useState<Booking | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function loadShortlist() {
      try {
        const res = await fetch('/api/shortlist');
        if (!res.ok) throw new Error('failed to load shortlist');
        const data: ShortlistApiItem[] = await res.json();
        if (!cancelled) {
          setItems(data);
        }
      } catch {
        if (!cancelled) {
          setError('Could not load your shortlist. Try again shortly.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadShortlist();

    return () => {
      cancelled = true;
    };
  }, []);

  const allCitations: Citation[] = items.flatMap((item) => item.citations);

  return (
    <main data-testid="companion-ui">
      <h1>Your Property Shortlist</h1>

      <VoiceBar />

      {loading && <p data-testid="shortlist-loading">Loading your shortlist...</p>}
      {error && <p data-testid="shortlist-error">{error}</p>}

      {!loading && !error && (
        <div data-testid="shortlist-items">
          {items.map((item) => (
            <div key={item.listing.id} data-testid="shortlist-item">
              <ShortlistCard listing={item.listing} />
              <NeighborhoodPanel snapshot={item.neighborhoodSnapshot} />
            </div>
          ))}
        </div>
      )}

      <SourcesPanel citations={allCitations} />
      <BookingPanel booking={booking} />
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full test suite for this subsystem**

Run: `npx vitest run components app/page.test.tsx`
Expected: PASS — all 6 test files (`ShortlistCard`, `NeighborhoodPanel`, `SourcesPanel`, `BookingPanel`, `VoiceBar`, `page`) green, 11 tests total.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/page.test.tsx
git commit -m "feat(ui): wire companion UI shell — shortlist, neighborhood, sources, booking, voice"
```

---

## Self-Review Notes

- **Spec coverage:** shortlist cards with rent/bedrooms/area/amenities → Task 1; neighborhood snapshot panel (transit/safety/amenities) → Task 2; mic button + live transcript → Task 5; Sources/References section → Task 3; visit-confirmation panel with slot + confirmation code → Task 4; all composed on the page → Task 6. Grounding & Hallucination requirement ("must say so, not guess") is satisfied by `NeighborhoodPanel`'s explicit unavailable-data message. Citations-in-UI requirement satisfied by `SourcesPanel` plus per-claim source tags in `NeighborhoodPanel`.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code and exact commands.
- **Type consistency:** `Listing`, `NeighborhoodSnapshot`, `SourcedClaim`, `Citation`, `Booking`, `ShortlistApiItem` are defined once in `lib/types.ts` (Task 1) and imported by name, unchanged, in every later task — no renamed fields or divergent shapes across tasks.
