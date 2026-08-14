# Implementation Plan — Status & Remaining Work

> Companion to [`problem_statement.md`](../problem_statement.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md). Those two define *what to build*; this document tracks *what's actually built, tested, and live-verified* versus what's left. Unlike the per-subsystem plans in `docs/superpowers/plans/`, this file reflects reality as executed, not a plan written before implementation — it gets updated as work lands, not re-derived from scratch.

## 1. Overall status

All 6 planned subsystems are implemented and unit-tested. Most have been **live-verified** against real data or a real (locally-run) service, not just mocks. Git is initialized, and `/api/agent` + `/api/stt` are built and live-verified. TTS does **not** go through Groq — `playai-tts` was fully retired (shutdown 2025-12-31) and its replacement is preview-only ("not for production" per Groq's own docs), so voice output uses the browser's native `SpeechSynthesis` API per `ARCHITECTURE.md`'s own documented contingency. The companion UI has been redesigned to a mobile card-based layout (`data/UI.png`), with two new backend routes making search/filter/remove real rather than cosmetic. The one concrete thing still missing before this meets the problem statement's baseline requirements is **a deployed public URL**.

| Subsystem | Built | Unit-tested | Live-verified |
|---|---|---|---|
| Data ingestion (scraper + RAG ingest) | ✅ | ✅ | ✅ 187 real listings, 6 real Wikipedia chunks |
| MCP integrations (`lib/agent/tools/*`) | ✅ | ✅ (22 tests) | ✅ OSM MCP tested against the real **deployed** Railway service (streamable HTTP); Booking MCP tested against a real local server |
| Orchestration agent | ✅ | ✅ | ✅ real multi-step Groq conversation, tool calls, grounding/uncertainty behavior |
| Companion UI (redesigned) | ✅ | ✅ | ✅ real data in a real browser: search, bedroom filter, expand/collapse, heart-remove (persists across reload), voice sheet (floating button + AI Scout tab) all confirmed working end-to-end |
| Evaluation suite | ✅ | ✅ | ✅ all 3 evals run live against fixtures; grounding's LLM judge caught a real hallucination |
| n8n-notify | ✅ | ✅ | ✅ `/api/notify` tested against a real DB session + stand-in webhook |
| **`/api/agent` route** | ✅ | ✅ (5 tests) | ✅ real `next dev` + real Groq key: shortlist search, follow-up edit, and session-cookie reuse all confirmed over HTTP |
| **`/api/stt` route** | ✅ | ✅ (4 tests) | ✅ real `next dev` + real Groq key: a synthesized speech WAV was transcribed correctly end-to-end |
| **Voice output (TTS)** | ✅ (browser `SpeechSynthesis`, not a server route) | ✅ (3 tests) | ✅ real Chrome: `speechSynthesis`/`SpeechSynthesisUtterance` API surface confirmed to match `lib/voice/speak.ts`'s assumptions |
| **Git / version control** | ✅ | — | — repo initialized, commits on `main` |
| **Deployment** | ⚠️ partial | — | OSM MCP is deployed to Railway and live; the app itself, Booking MCP, and n8n are still local-only |

## 2. What's built and verified, subsystem by subsystem

### Data ingestion — `scripts/`, `lib/pii/`, `lib/rag/`, `lib/geo/`
- `scrape-listings.ts` pulls real pins from bengaluru.rent's own public Supabase endpoint (discovered by inspecting live network traffic — no Playwright needed). Filters to `pin_kind==='rent'`, `listing_type` set, `!is_suspicious`. PII-stripped (the source has none in practice; `stripPII` is defensive).
- `ingest-neighborhood-docs.ts` pulls real Wikipedia extracts for the 5 default localities, chunks, embeds locally via `@xenova/transformers`.
- Live result: **187 available listings**, **6 grounded RAG chunks** in `data/nextleap.db`.

### MCP integrations — `lib/agent/tools/`
- `osmNearby.ts`, `listBookingSlots.ts`, `createBookingHold.ts`, `cancelBookingHold.ts`, `rescheduleBookingHold.ts`, plus shared `requireEnv.ts`/`types.ts`.
- Adapted from the original plan's guessed AI SDK v4-era API to the actually-installed `ai@7`/`@ai-sdk/mcp` API (`inputSchema` not `parameters`, `ModelMessage` not `CoreMessage`, MCP client moved to `@ai-sdk/mcp`).
- **Live-tested against real servers** (see §3) — found and fixed real bugs in both our code and the third-party OSM server fork.

### Orchestration agent — `lib/agent/orchestrator.ts`, `session.ts`, tools
- `searchListings`, `retrieveNeighborhoodDocs` (cosine-similarity RAG, adapted for SQLite instead of pgvector), `applyShortlistEdit`, `getOrCreateSession`, and `createAgent()` wiring all 6 tools behind Groq `llama-3.3-70b-versatile` via `streamText`.
- Two real bugs found and fixed during live testing: missing `stopWhen` (defaults to a single step, so the agent would never explain its tool results), and non-JSON `Date` values in tool output breaking the SDK's own multi-step message validation.
- **Live-verified**: a real conversation turn correctly called `retrieveNeighborhoodDocs` twice, stated uncertainty when the grounding data didn't answer the question, then called `searchListings` and replied with a real shortlisted listing.

### Companion UI — `app/`, `components/`, `lib/voice/`
- Redesigned (see `docs/superpowers/specs/2026-08-14-property-scout-ui-redesign-design.md` and `docs/superpowers/plans/2026-08-14-property-scout-ui-redesign.md`) to match `data/UI.png`'s mobile card layout: `Header`, `Hero`, `SearchBar`, `FilterPills`, `PropertyCard` (supersedes the old `ShortlistCard`), `BottomNav`, `FloatingMicButton`, `VoiceSheet`, composed in a rewritten `app/page.tsx`. `NeighborhoodPanel`/`SourcesPanel` live inside each `PropertyCard`'s expand-on-tap detail view; `BookingPanel`/`EmailShortlistButton`/`VoiceBar` are reused completely unmodified, at the page level (not per-card — they operate on the whole session, not one listing).
- `GET /api/shortlist` is now session-aware and filterable (`?locality=&bedrooms=`), returns `{ sessionId, items }` (not a bare array — needed so the client can learn its own session id, since the cookie is httpOnly), and seeds/excludes `shortlistItems` rows per session so a heart-removed card stays removed across reloads. New `POST /api/shortlist/remove` reuses the existing, already-tested `applyShortlistEdit`.
- Filled a gap the plan assumed was pre-built: real `lib/voice/useVoiceRecorder.ts` (MediaRecorder-based push-to-talk) and `speak.ts` (see §2 below for why this is `SpeechSynthesis`-based rather than a `playAudio.ts`/`/api/tts` blob-playback pair).
- Styling is hand-rolled CSS Modules + `app/globals.css` design tokens — no new npm dependencies, no icon library (7 inline SVG icons in `components/icons/icons.tsx`). Property photos are a neutral placeholder (`public/property-placeholder.svg`) — the listings table has no photo field.
- **Live-verified in a real browser**: 6 real listings render with real citations and grounded neighborhood content on expand; the bedroom filter pill and locality search both correctly narrow results (independently and combined); removing a card via the heart icon updates immediately and stays removed after a full page reload (with the list backfilling to 6 from the next matching real listing); the floating mic button and the bottom nav's "AI Scout" tab both open the same voice sheet wrapping the real `VoiceBar`, and it closes via backdrop click or the close button. Mic *recording* itself remains untested — no real microphone in this environment.

### Evaluation suite — `evals/`
- `feasibility.ts` (rule-based, supports `--fixture` and `--session <id>`), `edit-correctness.ts` (rule-based, fixture-only), `grounding.ts` (LLM-assisted via Groq `generateObject`).
- Adapted types to reuse the *real* `EditIntent`/`ShortlistDiff` from `applyShortlistEdit.ts` instead of the plan's guessed shape; fixtures use numeric ids matching our actual schema.
- **Live-verified with a real Groq key**: had to fix two real Groq API incompatibilities (`structuredOutputs` not supported on this model; `json_object` mode requires the literal word "json" in the prompt). After fixing, the grounding eval's LLM judge correctly passed a well-grounded claim and correctly failed one that contradicted its cited source.

### `/api/agent` route — `app/api/agent/route.ts`
- Wraps `getOrCreateSession` + `createAgent(sessionId).stream(messages)` as a real `POST` route handler, matching the request/response contract `components/VoiceBar.tsx` already expected (`{ message }` in, full text reply out via `res.text()`).
- Session identity is a new `nextleap_session` httpOnly cookie (read via `next/headers`'s `cookies()`), since no route previously wired one up — `getOrCreateSession` existed but was untested-in-production until now.
- **Live-verified**: real `next dev` + real Groq key — a shortlist search request returned a real grounded reply citing an actual DB listing, a follow-up "drop anything above 30000" on the same session cookie correctly triggered `applyShortlistEdit`, and both 400 error paths (empty message, invalid JSON) behave as expected.
- Message history is single-turn only (no `messages` table exists yet to persist prior turns per session) — each request is `[{ role: 'user', content: message }]`. Multi-turn context within one voice exchange still works via the agent's own tool-call loop; cross-request conversational memory is a known gap, not silently papered over.

### `/api/stt` route — `app/api/stt/route.ts`
- Reads a multipart `audio` field from the POST body, transcribes it via the AI SDK's `transcribe()` against `groq.transcription('whisper-large-v3-turbo')`, returns `{ text }` — matching the contract `components/VoiceBar.tsx` already expected.
- **Live-verified**: real `next dev` + real Groq key — synthesized a real speech WAV locally (Windows SAPI) saying "Find a two bedroom apartment in Koramangala under forty thousand rupees" and posted it to the running route; Groq Whisper transcribed it correctly (numbers and structure exact; a phonetic near-miss on "Koramangala" — expected Whisper behavior, not a bug). Also fixed a real bug found live: an empty/non-multipart body threw inside `request.formData()` uncaught, returning a bare 500 instead of a 400 — now caught and returns `{ error }` with 400.

### Voice output (TTS) — `lib/voice/speak.ts`, not a route
- `ARCHITECTURE.md` specifies Groq TTS (`playai-tts`) with browser `SpeechSynthesis` as an explicit fallback "if quality/availability is insufficient." Checked against Groq's current docs: `playai-tts` and `playai-tts-arabic` were **fully shut down 2025-12-31**; the replacement (`canopylabs/orpheus-v1-english`) is a preview model Groq's own docs mark "intended for evaluation purposes only... may be discontinued without notice." Also, `@ai-sdk/groq` (installed `4.0.26`) exposes no `.speech()`/TTS model factory at all — only `.transcription()`.
- Given that, went with the documented fallback rather than building against a model Groq itself says not to use in production: `components/VoiceBar.tsx` now calls `speak(replyText)` (browser `SpeechSynthesisUtterance`) directly instead of POSTing to a (removed) `/api/tts` route. No server round-trip for voice output.
- Removed `lib/voice/playAudio.ts` (dead code once nothing POSTs to `/api/tts` for a blob to play back).
- **Live-verified**: loaded the real companion UI in Chrome and confirmed `window.speechSynthesis`, `SpeechSynthesisUtterance`, and its `onend`/`onerror` handlers all exist and match what `speak.ts` assumes; no app-caused console errors. Actually *hearing* speech and the mic-to-transcript flow remain unverified in this headless-adjacent environment (no real microphone/audio output here), consistent with the companion UI's existing "recording itself untested" limitation.

### n8n-notify — `app/api/notify/`, `components/EmailShortlistButton.tsx`, `n8n/`
- Found and fixed two real bugs in the plan's own given test code (a Vitest hoisting/TDZ bug, and a test race condition on the loading state).
- **Live-verified**: seeded a real session + real shortlist items, pointed `N8N_WEBHOOK_URL` at a throwaway local HTTP server, ran `next dev` for real, confirmed `200 {"status":"sent"}` and that the correct PII-free payload arrived.
- The actual n8n workflow (`n8n/shortlist-to-pdf-email.json`) is import-ready but has never been imported into a running n8n instance — that's a deploy-time step, out of scope per the plan.

## 3. External integrations — what's live-tested, what's still blocked

| Integration | Local test status | What's blocking full production use |
|---|---|---|
| **Groq** (`GROQ_API_KEY`) | ✅ Real key, live-tested, working | Nothing — this one's ready |
| **OSM MCP** | ✅ Deployed to Railway and live-verified: real `initialize` handshake + real nearby-places data for a Koramangala coordinate | Nothing — this one's ready. Turned out to need no bridge at all: the fork runs FastMCP's `streamable-http` transport natively (see `docs/ARCHITECTURE.md` §3.2a); fixed a real mismatch where our client was configured for SSE at the URL root instead of HTTP at `/mcp` |
| **Booking MCP** | ✅ Stood up locally, full HTTP/auth layer confirmed correct | Needs real Google Calendar OAuth (`credentials.json` + `python auth.py`, blocked on your Google Cloud Console setup) before `list_slots`/`create_hold` return real data |
| **n8n** | ✅ Tested against a stand-in webhook | No real n8n instance exists yet; needs Railway provisioning + workflow import per `n8n/README.md` |

## 4. Known, flagged limitations (not silently papered over)

- `osmNearby`'s `commute` category can't produce a meaningful result: the real `analyze_commute` tool needs two coordinate pairs (home + work), but the tool's current interface only accepts one point + a category string. Needs an interface change (Zod schema in `orchestrator.ts`, `osmNearby.ts`'s signature) to fix properly.
- The grounding eval's commute-consistency check (`evals/feasibility.ts`) assumes `osmNearby`'s tool-call input carries a `commutePoint` field. The real tool's schema doesn't have one. Fixture-mode (what's tested) is unaffected; DB-mode against real `toolCallLog` rows would currently false-flag every commute check.
- ~~Companion UI has no visual styling~~ — resolved: redesigned to match `data/UI.png` (see §2 above).
- ~~The search bar's locality matching was an exact match~~ — resolved: reported by the user testing the redesigned UI ("no results shown even when flats are available" for a typed area name). `searchListings`'s `eq()` locality filter required an exact-case, exact-string match; switched to a case-insensitive substring match (`like(sql\`lower(locality)\`, '%' + lower(input) + '%')`, portable across SQLite and the eventual Postgres target — not SQLite-specific `ilike`). Fixes both the UI search bar and the voice agent's `searchListings` tool, since they share this function. TDD'd against a real in-memory SQLite DB (the existing mocked tests only exercised JS-level filtering, not the actual SQL condition) — new tests cover different-case input, partial-substring input, and confirm unrelated localities still correctly return nothing. Live-verified in the running app: "koramangala" and "whitef" both now correctly return real matching listings.
- `GET /api/shortlist` writes DB rows (session seeding) on every read — a deliberate, minimal statefulness choice to make heart-remove persistent, not an oversight (see the redesign spec §8).
- Chrome DevTools flags a minor accessibility advisory ("form field element should have an id or name attribute") on the `SearchBar` and `EmailShortlistButton` inputs — both already have `aria-label` (so screen readers get an accessible name), this is a browser-autofill-heuristic nit, not a WCAG violation. Pre-existing pattern on `EmailShortlistButton`; not fixed as part of the redesign since it wasn't in scope.
- ~~`loadShortlist` had no guard against out-of-order responses~~ — resolved: a slow, superseded search/filter request could resolve after a newer one and silently overwrite fresh results with stale ones. Found by the redesign's final whole-branch review (a class of bug the pre-redesign code guarded against for unmount, but the rewrite dropped — and it matters more now that re-fetches, not just unmounts, are routine). Fixed with a request-token `useRef` guard in `app/page.tsx`; TDD test resolves two in-flight requests out of order and asserts the later one wins.
- `handleRemove`'s optimistic UI update can, in a narrow window, be overwritten by a concurrent `loadShortlist` refetch that was already in flight before the removal's `POST` committed — e.g. the user changes a filter and immediately hearts a card before the filter's GET resolves. Not fixed: requires coordinating two independent requests (harder than the stale-response fix above, which only discards *superseded* GETs) and needs simultaneous user actions to trigger. Flagged rather than built around, per YAGNI for a prototype.
- No empty-state message when a search/filter combination legitimately returns zero results (e.g. a locality genuinely not in the dataset, or a locality+bedroom combination with no matches) — the property list area just renders empty with no explanation.
- Every search/filter change blanks the entire card list to a loading message during the refetch, rather than updating in place — functional but not the smoothest UX.
- `SearchBar`'s real debounce-into-real-refetch path (typing → 300ms → `onChange` → `GET /api/shortlist`) is only tested as two disconnected halves (`SearchBar.test.tsx` proves debounce→callback; `app/page.test.tsx` proves callback→refetch via a stubbed `SearchBar`) — no single test exercises the real component driving a real refetch end-to-end.
- ~~Voice replies were sometimes silently not spoken~~ — resolved: reported by the user ("sometimes there is no voice"). Two real causes, both in `components/VoiceBar.tsx` / `lib/voice/speak.ts`: (1) any agent reply over 200 chars was skipped from TTS entirely rather than spoken — since the LLM doesn't reliably keep replies under that limit despite the system prompt asking it to, this meant a large fraction of turns produced zero voice output by design, not a bug in the strict sense but a bad default; now truncated at the last sentence boundary within the limit and always spoken, full text still always renders in the UI. (2) `speechSynthesis.speak()` has a well-known Chrome bug where a stuck/interrupted prior utterance silently swallows the next `speak()` call with no error; now calls `speechSynthesis.cancel()` before every `speak()` to clear the queue first. Both TDD'd; live-verified the shorter-reply path still speaks unmodified text.

## 5. Remaining work

Roughly in priority order:

- [x] Initialize git, make an initial commit — done; repo is on `main` with several commits.
- [x] Build `app/api/agent/route.ts` — done, tested, and live-verified (see §2 above).
- [x] Build `/api/stt` — done, tested, and live-verified (see §2 above).
- [x] Voice output — done via browser `SpeechSynthesis` per `ARCHITECTURE.md`'s documented fallback (`playai-tts` is fully retired; its replacement is preview-only). No `/api/tts` route exists by design — see §2 above. Update `ARCHITECTURE.md` §1/§2/§3.3 to reflect this if/when convenient (currently still describes a Groq-TTS `/api/tts` route).
- [x] OSM MCP deployment — done; fork deployed to Railway running natively over streamable HTTP, `OSM_MCP_URL` set, live-verified (see §3 above and `docs/ARCHITECTURE.md` §3.2a).
- [ ] Deploy the app itself: Railway project with the app service, Postgres (or keep SQLite for the demo — flag this decision explicitly if sticking with SQLite in production), the Booking MCP service, and an n8n service. OSM MCP is already deployed and just needs `OSM_MCP_URL` set on the app service too. Required by the problem statement ("Deployed prototype (public URL)").
- [ ] Complete Google Calendar OAuth for the Booking MCP (`python auth.py`, needs your Google account) so booking actually works end-to-end.
- [ ] Import `n8n/shortlist-to-pdf-email.json` into a real n8n instance and configure real SMTP credentials.
- [ ] Commit the pending fix in the OSM MCP fork (`D:\NextLeap\OpenStreetMap_MCP`, `server.py` — missing `User-Agent` headers) — that's a separate repo, needs a decision/commit from you.
- [ ] Decide whether to fix the `commute`-category interface gap (two-point support) or leave it as a documented limitation.
- [x] Visual styling for the companion UI — done; redesigned to match `data/UI.png` (see §2 above).

## 6. Running things locally today

- `npm run dev` — companion UI: search, filters, expand/collapse, heart-remove, shortlist, `/api/agent` chat, `/api/stt` transcription, and browser-native spoken replies all work with real data/services. Mic capture itself is untested here (no real microphone in this environment).
- `npm test` — full suite (179 tests)
- `npm run scrape:listings` / `npm run ingest:docs` — refresh real data
- `npm run eval:feasibility` / `eval:edit-correctness` / `eval:grounding` — run evals against fixtures (grounding needs `GROQ_API_KEY` in `.env`)
- OSM MCP / Booking MCP / n8n: no persistent local instance is running by default — each was spun up temporarily for testing and torn down. See `docs/ARCHITECTURE.md` and `n8n/README.md` for how to stand them up again.
