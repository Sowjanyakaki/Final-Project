# Implementation Plan — Status & Remaining Work

> Companion to [`problem_statement.md`](../problem_statement.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md). Those two define *what to build*; this document tracks *what's actually built, tested, and live-verified* versus what's left. Unlike the per-subsystem plans in `docs/superpowers/plans/`, this file reflects reality as executed, not a plan written before implementation — it gets updated as work lands, not re-derived from scratch.

## 1. Overall status

All 6 planned subsystems are implemented and unit-tested. Most have been **live-verified** against real data or a real (locally-run) service, not just mocks. Git is initialized and the `/api/agent` route is built and live-verified. Two concrete things are still missing before this meets the problem statement's baseline requirements: **a deployed public URL, and the `/api/stt` + `/api/tts` routes** that would let the companion UI's voice pipeline actually work end-to-end in a browser (chat via `/api/agent` already works without voice).

| Subsystem | Built | Unit-tested | Live-verified |
|---|---|---|---|
| Data ingestion (scraper + RAG ingest) | ✅ | ✅ | ✅ 187 real listings, 6 real Wikipedia chunks |
| MCP integrations (`lib/agent/tools/*`) | ✅ | ✅ (20 tests) | ✅ OSM MCP + Booking MCP both tested against real local servers |
| Orchestration agent | ✅ | ✅ | ✅ real multi-step Groq conversation, tool calls, grounding/uncertainty behavior |
| Companion UI | ✅ | ✅ | ✅ real data rendered in a real browser (`next dev`) |
| Evaluation suite | ✅ | ✅ | ✅ all 3 evals run live against fixtures; grounding's LLM judge caught a real hallucination |
| n8n-notify | ✅ | ✅ | ✅ `/api/notify` tested against a real DB session + stand-in webhook |
| **`/api/agent` route** | ✅ | ✅ (5 tests) | ✅ real `next dev` + real Groq key: shortlist search, follow-up edit, and session-cookie reuse all confirmed over HTTP |
| **Voice pipeline (STT/TTS routes)** | ⚠️ partial | ✅ (mocked) | ❌ `/api/stt`, `/api/tts` don't exist |
| **Git / version control** | ✅ | — | — repo initialized, commits on `main` |
| **Deployment** | ❌ | — | — nothing deployed; everything run locally |

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
- `ShortlistCard`, `NeighborhoodPanel`, `SourcesPanel`, `BookingPanel`, `VoiceBar`, `EmailShortlistButton`, composed in `app/page.tsx`.
- Filled a gap the plan assumed was pre-built: real `lib/voice/useVoiceRecorder.ts` (MediaRecorder-based push-to-talk) and `playAudio.ts`.
- Added a real `GET /api/shortlist` route (beyond the plan's mocked-only scope) so the UI shows actual scraped listings + actual grounded safety claims + honest "data unavailable" for ungrounded categories.
- **Live-verified in a real browser**: real listings, real citations, correct uncertainty states, working mic button UI (recording itself untested — no real mic in this environment).

### Evaluation suite — `evals/`
- `feasibility.ts` (rule-based, supports `--fixture` and `--session <id>`), `edit-correctness.ts` (rule-based, fixture-only), `grounding.ts` (LLM-assisted via Groq `generateObject`).
- Adapted types to reuse the *real* `EditIntent`/`ShortlistDiff` from `applyShortlistEdit.ts` instead of the plan's guessed shape; fixtures use numeric ids matching our actual schema.
- **Live-verified with a real Groq key**: had to fix two real Groq API incompatibilities (`structuredOutputs` not supported on this model; `json_object` mode requires the literal word "json" in the prompt). After fixing, the grounding eval's LLM judge correctly passed a well-grounded claim and correctly failed one that contradicted its cited source.

### `/api/agent` route — `app/api/agent/route.ts`
- Wraps `getOrCreateSession` + `createAgent(sessionId).stream(messages)` as a real `POST` route handler, matching the request/response contract `components/VoiceBar.tsx` already expected (`{ message }` in, full text reply out via `res.text()`).
- Session identity is a new `nextleap_session` httpOnly cookie (read via `next/headers`'s `cookies()`), since no route previously wired one up — `getOrCreateSession` existed but was untested-in-production until now.
- **Live-verified**: real `next dev` + real Groq key — a shortlist search request returned a real grounded reply citing an actual DB listing, a follow-up "drop anything above 30000" on the same session cookie correctly triggered `applyShortlistEdit`, and both 400 error paths (empty message, invalid JSON) behave as expected.
- Message history is single-turn only (no `messages` table exists yet to persist prior turns per session) — each request is `[{ role: 'user', content: message }]`. Multi-turn context within one voice exchange still works via the agent's own tool-call loop; cross-request conversational memory is a known gap, not silently papered over.

### n8n-notify — `app/api/notify/`, `components/EmailShortlistButton.tsx`, `n8n/`
- Found and fixed two real bugs in the plan's own given test code (a Vitest hoisting/TDZ bug, and a test race condition on the loading state).
- **Live-verified**: seeded a real session + real shortlist items, pointed `N8N_WEBHOOK_URL` at a throwaway local HTTP server, ran `next dev` for real, confirmed `200 {"status":"sent"}` and that the correct PII-free payload arrived.
- The actual n8n workflow (`n8n/shortlist-to-pdf-email.json`) is import-ready but has never been imported into a running n8n instance — that's a deploy-time step, out of scope per the plan.

## 3. External integrations — what's live-tested, what's still blocked

| Integration | Local test status | What's blocking full production use |
|---|---|---|
| **Groq** (`GROQ_API_KEY`) | ✅ Real key, live-tested, working | Nothing — this one's ready |
| **OSM MCP** | ✅ Stood up locally (your fork + `mcp-proxy` bridge), 3 bugs fixed in our code, 1 fixed in the fork (uncommitted) | Needs a real Railway deployment of the bridge; `ARCHITECTURE.md` §3.2a still says `supergateway`, which is confirmed broken (crashes on a 2nd connection) — needs updating to `mcp-proxy` |
| **Booking MCP** | ✅ Stood up locally, full HTTP/auth layer confirmed correct | Needs real Google Calendar OAuth (`credentials.json` + `python auth.py`, blocked on your Google Cloud Console setup) before `list_slots`/`create_hold` return real data |
| **n8n** | ✅ Tested against a stand-in webhook | No real n8n instance exists yet; needs Railway provisioning + workflow import per `n8n/README.md` |

## 4. Known, flagged limitations (not silently papered over)

- `osmNearby`'s `commute` category can't produce a meaningful result: the real `analyze_commute` tool needs two coordinate pairs (home + work), but the tool's current interface only accepts one point + a category string. Needs an interface change (Zod schema in `orchestrator.ts`, `osmNearby.ts`'s signature) to fix properly.
- The grounding eval's commute-consistency check (`evals/feasibility.ts`) assumes `osmNearby`'s tool-call input carries a `commutePoint` field. The real tool's schema doesn't have one. Fixture-mode (what's tested) is unaffected; DB-mode against real `toolCallLog` rows would currently false-flag every commute check.
- Companion UI has no visual styling (plain HTML) — matches the given plan's own reference components, which were also unstyled.

## 5. Remaining work

Roughly in priority order:

- [x] Initialize git, make an initial commit — done; repo is on `main` with several commits.
- [x] Build `app/api/agent/route.ts` — done, tested, and live-verified (see §2 above).
- [ ] Build `/api/stt` and `/api/tts` — Groq Whisper transcription and Groq TTS (or a browser `SpeechSynthesis` fallback per `ARCHITECTURE.md`'s contingency). Not started at all; only the client-side recorder/player hooks exist.
- [ ] Deploy: Railway project with the app service, Postgres (or keep SQLite for the demo — flag this decision explicitly if sticking with SQLite in production), the OSM MCP bridge (as `mcp-proxy`, not `supergateway`), the Booking MCP service, and an n8n service. Required by the problem statement ("Deployed prototype (public URL)").
- [ ] Complete Google Calendar OAuth for the Booking MCP (`python auth.py`, needs your Google account) so booking actually works end-to-end.
- [ ] Import `n8n/shortlist-to-pdf-email.json` into a real n8n instance and configure real SMTP credentials.
- [ ] Update `docs/ARCHITECTURE.md` §3.2a to say `mcp-proxy` instead of `supergateway`.
- [ ] Commit the pending fix in the OSM MCP fork (`D:\NextLeap\OpenStreetMap_MCP`, `server.py` — missing `User-Agent` headers) — that's a separate repo, needs a decision/commit from you.
- [ ] Decide whether to fix the `commute`-category interface gap (two-point support) or leave it as a documented limitation.
- [ ] Optional: visual styling for the companion UI (currently unstyled by design, matching the given plan).

## 6. Running things locally today

- `npm run dev` — companion UI (shortlist and `/api/agent` chat work with real data; voice specifically will 404 until `/api/stt` and `/api/tts` exist)
- `npm test` — full suite (113 tests)
- `npm run scrape:listings` / `npm run ingest:docs` — refresh real data
- `npm run eval:feasibility` / `eval:edit-correctness` / `eval:grounding` — run evals against fixtures (grounding needs `GROQ_API_KEY` in `.env`)
- OSM MCP / Booking MCP / n8n: no persistent local instance is running by default — each was spun up temporarily for testing and torn down. See `docs/ARCHITECTURE.md` and `n8n/README.md` for how to stand them up again.
