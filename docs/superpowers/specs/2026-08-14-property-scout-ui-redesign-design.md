# Property Scout UI Redesign — Design

> Scope: the renter-facing companion UI only (the app's one persona today — voice-first property search for renters in Bengaluru). No agent/landlord/property-manager persona exists or is planned; nothing here introduces one.

## 1. Goal

Reskin the existing, functionally-complete but visually plain (`app/page.tsx`) companion UI into the mobile card-based layout in `data/UI.png`, using real data end-to-end (no mock/placeholder content beyond a neutral property image). Preserve all existing tested behavior (shortlist rendering, neighborhood grounding, citations, booking, email, voice) — this is a reskin plus two small, purpose-built backend additions, not a rewrite.

Reference mockup: `data/UI.png` (mobile screenshot — header, hero, search bar, filter pills, featured-property cards, floating mic button, bottom nav).

## 2. Non-goals

- No "For Sale" listings or toggle — app is rental-only (`ARCHITECTURE.md`, orchestrator `SYSTEM_PROMPT`). The mockup's "For Sale" pill becomes "For Rent" and is always active/non-interactive.
- No real property photos — the listings table has no photo field and the scraped source provides none. Cards use one neutral placeholder image.
- No real user accounts/avatar — the mockup's header avatar is dropped entirely (title takes full header width).
- "Saved" and "Profile" bottom-nav tabs are visual-only placeholders — no new pages, no new functionality.
- "See all" (Featured Properties section) is decorative — no separate listing page exists or is being built.
- No new npm dependencies (no Tailwind, no icon library, no component kit).

## 3. Visual direction

- Mobile-first layout, single column, capped at a max content width (~480px) and centered on wider viewports — avoids a broken desktop look without building a separate responsive grid.
- Styling via `app/globals.css` (CSS custom-property tokens: colors, spacing, radii) + one CSS Module per new component. Exact palette (near-black navy primary, orange/coral accent, light-gray page background, white cards, per `data/UI.png`) refined during implementation using the frontend-design skill.
- Icons are hand-rolled inline SVGs (search, heart, bed, sqft/ruler, mic, house/compass, person) — seven small icons, no library.

## 4. Component breakdown

All new unless noted. Composed from `app/page.tsx`.

| Component | Responsibility |
|---|---|
| `Header` | "Property Scout" title, decorative search glyph. No avatar. |
| `Hero` | "Find your perfect home" headline + subtitle. Static copy. |
| `SearchBar` | Controlled text input for locality; debounced; drives `GET /api/shortlist?locality=`. |
| `FilterPills` | "For Rent" (static, always active) / "2 BHK" / "3 BHK" (mutually exclusive bedroom filter); drives `GET /api/shortlist?bedrooms=`. |
| `PropertyCard` | Placeholder image, "New" badge (see §6), heart button (remove from shortlist), price/address/bed/sqft. Tapping the card body toggles an inline expanded state. |
| *(expanded state, inside `PropertyCard`)* | Reveals existing `NeighborhoodPanel`, `SourcesPanel` (scoped to that listing's citations), `BookingPanel`, `EmailShortlistButton` — all reused unmodified, just relocated. |
| `BottomNav` | Explore (active, real) / Saved (placeholder) / AI Scout (opens `VoiceSheet`) / Profile (placeholder). |
| `FloatingMicButton` | Fixed-position circular button, bottom-right; opens `VoiceSheet`. |
| `VoiceSheet` | Bottom-sheet overlay wrapping the existing `VoiceBar` component unmodified (transcript/status/reply logic untouched — only container/positioning is new). Opened by `FloatingMicButton` or the `BottomNav` "AI Scout" tab; either entry point opens the same sheet. |

`ShortlistCard` is superseded by `PropertyCard` (its rent/bedrooms/sqft/amenities rendering logic carries over; presentation changes). `VoiceBar`, `NeighborhoodPanel`, `SourcesPanel`, `BookingPanel`, `EmailShortlistButton` are reused as-is, only repositioned.

## 5. Backend changes

Two small, purpose-built additions — not a general-purpose shortlist API.

### 5.1 `GET /api/shortlist` becomes session-aware and filterable

Currently stateless (no cookie, always returns a fresh top-6 `searchListings({})` call — see `app/api/shortlist/route.ts`). Changes:

- Reads/creates the `nextleap_session` cookie (same helper `getOrCreateSession` used by `/api/agent`).
- Accepts optional `?locality=` and `?bedrooms=` query params, passed as constraints to `searchListings`.
- After fetching results, for each listing not yet present as a `shortlistItems` row for this session, inserts one with `status: 'active'`. Existing rows (`active` or `dropped`) are left untouched.
- Excludes from the response any listing whose `shortlistItems` row for this session has `status: 'dropped'` — so a heart-removed card stays removed even after changing filters, without needing to track "removed" state anywhere else.

This is a deliberate, minimal statefulness addition: it's what makes the heart-remove button (§5.2) meaningful and persistent within a session, and reuses the same session/cookie plumbing `/api/agent` already established.

### 5.2 New `POST /api/shortlist/remove`

- Body: `{ listingId: number }`.
- Reads the session cookie (400 if listing id missing/invalid; no session-creation on this route — removing from a shortlist that doesn't exist yet is a no-op 400, since `GET` always runs first in the real flow).
- Calls the existing, already-tested `applyShortlistEdit({ sessionId, editIntent: { op: 'remove', listingId } })` — no new mutation logic, reuses what the orchestrator's chat flow already exercises.
- Returns the resulting `ShortlistDiff` (`{ changed, unchanged }`).

## 6. Interaction & state details

- **Search/filter**: `SearchBar` and `FilterPills` are lifted state in `app/page.tsx`; changes re-fetch `GET /api/shortlist` with updated query params (debounced ~300ms for the text input, immediate for pill taps).
- **"New" badge**: shown when a listing's `scrapedAt` is within the last 7 days of the current date; otherwise omitted. Derived from real data already returned by the API, no schema change.
- **Heart tap**: optimistically removes the card from the list, calls `POST /api/shortlist/remove`; on failure, restores the card and shows an inline error (matches the existing error-handling style in `EmailShortlistButton`).
- **Card expand/collapse**: local component state, one card open at a time or independently — independently is simpler and avoids cross-card state coupling; going with independent.
- **Voice sheet**: open/closed boolean lifted in `app/page.tsx`; `FloatingMicButton` and the `BottomNav` "AI Scout" tab both set it open. Closing (backdrop tap or a close control) does not interrupt an in-flight recording/transcription — same behavior `VoiceBar` already has, just no longer inline on the page.

## 7. Testing

TDD throughout, consistent with `/api/agent` and `/api/stt`:

- `app/api/shortlist/route.test.ts` — rewritten for session-awareness, query-param filtering, seed-on-read, and dropped-item exclusion.
- `app/api/shortlist/remove/route.test.ts` — new, covers happy path, missing session, invalid listingId.
- Component tests for `PropertyCard`, `Header`, `Hero`, `SearchBar`, `FilterPills`, `BottomNav`, `FloatingMicButton`, `VoiceSheet` — new.
- `app/page.test.tsx` — rewritten to match new composition and data flow.
- `ShortlistCard.test.tsx` — removed (component superseded by `PropertyCard`).
- `VoiceBar.test.tsx`, `NeighborhoodPanel.test.tsx`, `SourcesPanel.test.tsx`, `BookingPanel.test.tsx`, `EmailShortlistButton.test.tsx` — unchanged (components reused unmodified).

## 8. Open risk / judgment call flagged during design

`GET /api/shortlist` writing DB rows on every read is slightly unusual for a GET, but is the smallest way to make heart-remove persistent without inventing a second stateful mechanism; documented here rather than silently done.
