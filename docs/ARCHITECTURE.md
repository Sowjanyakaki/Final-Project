# Architecture Plan — Voice-First AI Property Scout

> Companion to [`problem_statement.md`](../problem_statement.md). This document defines system architecture, tech stack, data model, and component boundaries before any implementation plan is written.

## 1. Assumptions & Decisions

The spec leaves several implementation choices open. Defaults chosen below, so we can start building — swap any of these out if you have a preference.

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router), deployed on Railway | Single deploy target for UI + API/orchestration; Railway runs it as a standard Node.js service |
| Hosting | Railway (app service + Postgres + n8n, all as services in one Railway project) | User's choice — keeps app, DB, and workflow automation under one platform/billing |
| LLM access | Groq via AI SDK's Groq provider (`@ai-sdk/groq`), default model `llama-3.3-70b-versatile` (tool-calling support required for the agent) | User-provided Groq API key; Groq's inference speed suits a voice agent where response latency matters |
| STT | Groq-hosted Whisper (`whisper-large-v3-turbo`) via AI SDK `transcribe()` | Same provider/key as the LLM, very low latency, good accuracy |
| TTS | Groq TTS (`playai-tts`) via AI SDK `generateSpeech()` | Keeps the whole voice pipeline on one provider; fallback to browser `SpeechSynthesis` API if quality/availability is insufficient |
| Database | Postgres w/ `pgvector` extension, hosted as a Railway service | One store for listings, RAG chunks + embeddings, sessions, bookings. Railway's default Postgres image doesn't ship `pgvector` — deploy from the `pgvector/pgvector` Docker image (or `ankane/pgvector`) instead of the stock Postgres template |
| Embeddings | Local, in-process: `@xenova/transformers` running `Xenova/all-MiniLM-L6-v2` (384-dim) | Groq has no embeddings endpoint; a local model avoids adding a third API key/provider just for RAG chunking. `neighborhood_docs.embedding` is `vector(384)` to match |
| Testing | Vitest for all unit/component tests; external calls (Groq SDK, MCP clients, Booking MCP HTTP calls, Playwright, DB) mocked at the module boundary — no real network/API calls in the test suite | Keeps `npm test` runnable with zero credentials, which the eval/test steps in each implementation plan depend on |
| Voice capture UI | Push-to-talk mic button (MediaRecorder API), not always-on streaming | Simpler, reliable MVP; avoids WebRTC/real-time complexity given no explicit "real-time interruption" requirement |
| Scraper | Playwright script, run offline / on-demand, output persisted to DB | bengaluru.rent needs JS rendering + map pin interaction |
| OSM MCP | User's fork/clone of [jagan-shanmugam/open-streetmap-mcp](https://github.com/jagan-shanmugam/open-streetmap-mcp) (Python, `geocode_address`/`find_nearby_places`/`analyze_commute`/`analyze_neighborhood`/etc.), connected via AI SDK `experimental_createMCPClient` | Explicit requirement — must be visible in orchestration layer. URL to be provided once the user's fork is ready |
| Booking MCP | User's own [Sowjanyakaki/MCP-server](https://github.com/Sowjanyakaki/MCP-server) (FastAPI + Google Calendar), deployed as its own Railway service, called by the agent's booking tools | Provides `list_slots`/`create_hold`/`cancel_hold`/`reschedule_hold`/`add_attendee` backed by a real Google Calendar — replaces a from-scratch booking tool |
| Workflow automation | n8n, deployed as its own Railway service (official n8n Railway template), triggered via webhook from the app | Matches "implement an n8n workflow" requirement; same platform as the rest of the stack |
| Evals | Standalone Node/TS scripts in `evals/`, runnable via `npm run eval:*`, LLM-assisted where judgment is needed, rule-based where it's a clean check | "Must be runnable" — no dependency on a specific eval framework |
| Version control | Git repo initialized locally, pushed to GitHub | Explicit requirement |

## 2. System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                              BROWSER (UI)                             │
│  Mic button + live transcript · Shortlist cards · Neighborhood panel  │
│  Sources/citations panel · Visit-confirmation panel                   │
└───────────────┬─────────────────────────────────────┬─────────────────┘
                │ REST/streaming (fetch)               │ audio blob
                ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   NEXT.JS APP (Railway service, Node.js)              │
│                                                                        │
│  /api/stt         → Groq Whisper transcription                        │
│  /api/tts         → Groq TTS for spoken replies                       │
│  /api/agent       → orchestrator (agent loop, tool calls, streaming)  │
│  /api/booking     → create/confirm site-visit slot                    │
│  /api/shortlist   → CRUD for session shortlist state                  │
│  /api/notify      → triggers n8n webhook (shortlist → PDF → email)    │
│                                                                        │
│  Orchestration layer (AI SDK agent, Groq model):                      │
│   tools: searchListings · osmNearby (MCP) · retrieveNeighborhoodDocs  │
│          (RAG) · applyShortlistEdit · explainDecision ·               │
│          listBookingSlots / createBookingHold (Booking MCP)           │
└───────┬───────────────┬────────────────┬─────────────────┬───────┬───┘
        │               │                │                 │       │
        ▼               ▼                ▼                 ▼       ▼
┌───────────────┐ ┌───────────────┐ ┌──────────────┐ ┌──────────┐ ┌───────────────┐
│ Postgres +     │ │ OpenStreetMap │ │ n8n workflow │ │ Groq API │ │ Booking MCP    │
│ pgvector       │ │ MCP server    │ │ (Railway     │ │ (LLM +   │ │ (Railway svc,  │
│ (Railway       │ │ (amenities,   │ │ service;     │ │  STT/TTS)│ │ Sowjanyakaki/  │
│ service)       │ │ transit, POI) │ │ webhook →    │ └──────────┘ │ MCP-server) →  │
│ listings,      │ └───────────────┘ │ PDF → email) │              │ Google Calendar│
│ neighborhood   │                   └──────────────┘              └───────────────┘
│ docs+embeds,   │
│ sessions,      │
│ shortlists,    │
│ bookings       │
└───────────────┘
        ▲
        │ offline / on-demand ingestion
┌───────────────────────────┐
│ Scraper (Playwright)       │  bengaluru.rent → listings (PII stripped)
│ Neighborhood doc fetcher   │  Wikipedia/city guides → chunked + embedded
└───────────────────────────┘
```

## 3. Component Breakdown

### 3.1 Data Ingestion (offline, run before/alongside dev)

**Listings scraper** (`scripts/scrape-listings.ts`)
- Playwright drives bengaluru.rent, extracts pins.
- Filters out pins marked "Not for rent" — only currently-available listings kept.
- Extracts: rent, bedrooms, furnishing, amenities, society name, sqft, availability status, lat/lng, locality.
- **PII strip step is mandatory and non-optional**: any owner/agent name or phone number field is dropped before the record ever reaches the DB, in-memory cache, or logs. Implemented as a dedicated `stripPII()` function unit-tested against sample scraped records.
- Writes to `listings` table with a `source_url` + `scraped_at` for traceability.

**Neighborhood doc ingester** (`scripts/ingest-neighborhood-docs.ts`)
- Pulls Wikipedia / open city-guide pages per locality (Koramangala, HSR Layout, Indiranagar, etc. — scoped to localities that appear in scraped listings).
- Chunks text (~500 tokens), embeds each chunk, stores in `neighborhood_docs` with `source_url`, `source_title`, `locality`.
- This is the RAG corpus for "neighborhood practical guidance" claims.

### 3.2 Orchestration Layer (the "agent")

Single conversational agent per session, implemented with AI SDK's tool-calling loop (`streamText` with `tools`). Tools available to it:

- **`searchListings(constraints)`** — app-code SQL query against `listings` (budget, bedrooms, must-haves, locality). This is *not* an LLM call — deterministic filtering/ranking logic lives here so results are auditable.
- **`osmNearby(lat, lng, category)`** — calls the OSM MCP server (via MCP client), using its `find_nearby_places` / `analyze_commute` / `analyze_neighborhood` tools for transit stops, amenities, and commute checks. Every amenity/transit claim shown to the user must trace back to a call to this tool.
- **`retrieveNeighborhoodDocs(locality, topic)`** — pgvector similarity search over `neighborhood_docs`, returns chunks + citations. Used for safety/character claims and for grounding "why this area" explanations.
- **`applyShortlistEdit(sessionId, editIntent)`** — parses a structured edit (e.g. `{op: "filter", field: "rent", op: "<=", value: 40000}` or `{op: "add", filters: {balcony: true}}`) and applies it as a diff against the *current* shortlist only — never regenerates the full list from scratch. This is what makes the Edit Correctness Eval possible: the diff is logged, so "only affected listings changed" is checkable.
- **`listBookingSlots(dayPreference, timePreference)`** — calls the Booking MCP's `POST /list_slots`, returns up to 2 real candidate slots off the connected Google Calendar.
- **`createBookingHold(sessionId, listingId, slot)`** — app code generates a confirmation code (e.g. `NL-A742`), calls the Booking MCP's `POST /create_hold` with `{topic: "<society_name>, <locality>", code, slot}`, then writes a `bookings` row locally with the returned `holdId` + status. See §3.5a.

The agent's system prompt enforces:
- Max 5 clarifying questions before shortlisting.
- Never state a neighborhood/amenity fact without having called `osmNearby` or `retrieveNeighborhoodDocs` first in that turn.
- If a tool call returns nothing/low-confidence, respond with explicit uncertainty ("I don't have reliable transit data for this listing") rather than filling the gap from general knowledge.

Session state (constraints, current shortlist, conversation history, tool-call log) persisted in `sessions` table, keyed by a session id set in a cookie — no auth required for MVP.

### 3.2a OSM MCP transport: SSE bridge (decided)

The upstream `open-streetmap-mcp` server only speaks **stdio** (`osm-mcp-server` reads/writes on standard input/output) — it has no built-in HTTP/SSE mode and ships no Dockerfile/Railway config, unlike the Booking MCP's plain REST API. That means it can't be pointed at directly as a public Railway URL the way the Booking MCP can.

**Decision: wrap it with an stdio→SSE bridge**, deployed as its own Railway service, matching the decoupled-service pattern used for the Booking MCP:

- In the user's forked repo, add a small bridge process using `supergateway` (or `mcp-proxy`) that spawns `osm-mcp-server` over stdio and re-exposes it as SSE, e.g.:
  ```bash
  npx supergateway --stdio "uvx osm-mcp-server" --port $PORT
  ```
- Add a `railway.toml`/Dockerfile to that fork so Railway can build and run the bridge (needs both Node — for `supergateway`/`npx` — and Python/`uv` — for `osm-mcp-server` — in the same container).
- The app connects via AI SDK's `experimental_createMCPClient({ transport: { type: 'sse', url: OSM_MCP_URL } })`.

`osmNearby` in the orchestration layer is written against the MCP client interface, so this is purely a deployment/config concern for the forked repo — no app-code changes needed once `OSM_MCP_URL` points at the bridge's Railway URL.

### 3.3 Voice Pipeline

1. Browser records audio (MediaRecorder) on push-to-talk → blob POSTed to `/api/stt`.
2. `/api/stt` runs Groq Whisper transcription, returns text + updates live transcript in UI.
3. Transcript sent to `/api/agent` as the user turn; agent streams back a text response.
4. Short spoken confirmations (e.g. "I've dropped 2 listings over ₹40k") are also sent to `/api/tts` and played back; full explanations always also render as text + citations in the UI (per spec: "voice explanations can be short; citations must appear in the UI").

### 3.4 Companion UI (Next.js pages/components)

- `ShortlistCard` — rent, bedrooms, area, key amenities, availability badge.
- `NeighborhoodPanel` — per-listing transit/safety/amenities snapshot, each line tagged with its source (OSM tool-call or RAG citation).
- `VoiceBar` — mic button, live transcript, agent's spoken/textual reply.
- `SourcesPanel` — flat list of every citation (RAG doc titles+URLs, OSM query summary) used in the current turn.
- `BookingPanel` — slot picker + confirmation code once booked.

### 3.5a Booking MCP (site-visit scheduling)

Uses the existing [Sowjanyakaki/MCP-server](https://github.com/Sowjanyakaki/MCP-server) repo as-is rather than building booking from scratch. It's a small FastAPI service backed by a real Google Calendar, deployed as its own Railway service alongside the rest of the stack.

Relevant endpoints (called by the agent tools above, over HTTPS with an `X-API-Key` header):

| Endpoint | Purpose |
|---|---|
| `POST /list_slots` `{dayPreference, timePreference}` | Returns up to 2 free slots (`{id, startIso, label}`) matching a loose day/time preference |
| `POST /create_hold` `{topic, code, slot}` | Creates a tentative Calendar event titled `Advisor Q&A — {topic} — {code}`; the `code` is our app-generated confirmation code, stored on the event as a private property for later lookup |
| `POST /cancel_hold` `{code}` | Deletes the hold — usable if the user says "cancel my visit" |
| `POST /reschedule_hold` `{code, newSlot}` | Moves the hold to a new slot — usable for "actually, move it to Wednesday" |
| `POST /add_attendee` `{code, email}` | Adds the renter's email as a Calendar invite attendee, if they give one — optional, not required by the spec |

Notes/constraints carried over from that repo:
- All mutating endpoints (`create_hold`, `cancel_hold`, `reschedule_hold`, `add_attendee`) go through a human-in-the-loop approval check that **auto-approves when `RAILWAY_ENVIRONMENT` is set** — since we deploy it on Railway, this is automatic, no code change needed there.
- The service needs its own Google Cloud OAuth setup (`GOOGLE_CREDENTIALS_JSON`, `GOOGLE_TOKEN_JSON` env vars, `calendar.events` scope) — this is separate from our app's credentials and lives entirely in that repo/service.
- Our app only needs that service's public Railway URL + its `API_SECRET_KEY` value, stored as `BOOKING_MCP_URL` / `BOOKING_MCP_API_KEY` in the app's env.
- The repo also exposes `/append_to_doc` (Google Docs) and `/create_email_draft` (Gmail draft, not send) — not used for the required n8n PDF-email flow, but available later if useful.

### 3.5 n8n Workflow

- Trigger: Webhook node, called by `/api/notify` with `{ sessionId, shortlist, email }`.
- Node chain: Webhook → Function (format shortlist into HTML) → HTML-to-PDF node (or Puppeteer/Chromium node) → Email node (SMTP or a provider like Resend/SendGrid) → respond 200 to caller.
- Runs as a separate Railway service (deployed from the official n8n Railway template) — not part of the Next.js deploy. URL stored as `N8N_WEBHOOK_URL` env var in the app.

### 3.6 Evaluation Suite (`evals/`)

Each is a standalone script reading recorded session transcripts/shortlist snapshots from the DB (or fixture files) and printing pass/fail + reasons.

- **`evals/feasibility.ts`** — rule-based: every listing in a shortlist satisfies stated budget/must-haves; commute-time claims reference the stated commute point (not some other locality).
- **`evals/edit-correctness.ts`** — rule-based: diffs the shortlist before/after an edit tool-call against the logged `applyShortlistEdit` intent; fails if listings outside the intent's scope changed.
- **`evals/grounding.ts`** — LLM-assisted: for each neighborhood claim in a transcript, checks (a) a citation is attached, (b) the citation's source text actually supports the claim (LLM-as-judge via `generateObject` with a strict schema), (c) listings referenced exist in `listings` and are `available`.

## 4. Data Model (Postgres)

```
listings
  id, source_url, society_name, locality, lat, lng,
  rent, bedrooms, furnishing, amenities (jsonb), sqft,
  availability_status ('available' | 'not_for_rent'),
  scraped_at
  -- no owner/agent name or phone columns exist, by design

neighborhood_docs
  id, locality, source_title, source_url, chunk_text, embedding (vector(384)),
  fetched_at
  -- embedding produced by @xenova/transformers, Xenova/all-MiniLM-L6-v2

sessions
  id, created_at, constraints (jsonb), status

shortlist_items
  id, session_id, listing_id, status ('active'|'dropped'),
  reason (text), added_at

tool_call_log
  id, session_id, tool_name, input (jsonb), output (jsonb), created_at
  -- backs the Edit Correctness + Grounding evals

bookings
  id, session_id, listing_id, confirmation_code, hold_id,
  slot_start_iso, slot_label, status ('tentative'|'cancelled'|'rescheduled'),
  created_at
  -- hold_id + status mirror the Booking MCP's create_hold/cancel_hold/reschedule_hold responses
```

## 5. Folder Structure (proposed)

```
/
├── problem_statement.md
├── docs/
│   └── ARCHITECTURE.md
├── app/                        # Next.js App Router
│   ├── page.tsx                # companion UI shell
│   ├── components/
│   │   ├── ShortlistCard.tsx
│   │   ├── NeighborhoodPanel.tsx
│   │   ├── VoiceBar.tsx
│   │   ├── SourcesPanel.tsx
│   │   └── BookingPanel.tsx
│   └── api/
│       ├── stt/route.ts
│       ├── tts/route.ts
│       ├── agent/route.ts
│       ├── shortlist/route.ts
│       ├── booking/route.ts
│       └── notify/route.ts
├── lib/
│   ├── db/                     # schema + queries (drizzle or postgres.js)
│   ├── agent/
│   │   ├── tools/
│   │   │   ├── searchListings.ts
│   │   │   ├── osmNearby.ts        # MCP client wiring
│   │   │   ├── retrieveNeighborhoodDocs.ts
│   │   │   ├── applyShortlistEdit.ts
│   │   │   ├── listBookingSlots.ts  # Booking MCP wiring
│   │   │   └── createBookingHold.ts # Booking MCP wiring
│   │   └── orchestrator.ts
│   └── pii/stripPII.ts
├── scripts/
│   ├── scrape-listings.ts
│   └── ingest-neighborhood-docs.ts
├── evals/
│   ├── feasibility.ts
│   ├── edit-correctness.ts
│   └── grounding.ts
├── n8n/
│   └── shortlist-to-pdf-email.json   # exported workflow for import
└── package.json
```

## 6. Sequence: Preference → Shortlist → Booking

1. User speaks preferences → STT → agent extracts structured constraints, asks ≤5 clarifying questions, confirms constraints back to user.
2. Agent calls `searchListings(constraints)` → candidate listings from DB.
3. For each candidate, agent calls `osmNearby` (transit/amenities) and `retrieveNeighborhoodDocs` (character/safety) to build the neighborhood snapshot — every claim tagged with its source.
4. Shortlist + snapshots + citations rendered in UI; spoken summary via TTS.
5. User issues voice edit → agent parses intent → `applyShortlistEdit` mutates only the matching subset → UI re-renders diffed cards.
6. User asks "why this one?" → agent calls `retrieveNeighborhoodDocs`/reads `tool_call_log` for that listing → answers with citations, short spoken version + full text version in UI.
7. User picks a listing → agent calls `listBookingSlots` (Booking MCP) with the user's stated day/time preference → presents up to 2 real slots → user picks one → agent generates a confirmation code and calls `createBookingHold` (Booking MCP `create_hold`) → `BookingPanel` shows the slot + confirmation code + tentative status.
8. User says "email me this" → `/api/notify` → n8n webhook → PDF generated → emailed.

## 7. Deployment

All on **Railway**, as separate services inside one Railway project:

- **App service**: Next.js, deployed from the GitHub repo (Railway auto-builds via Nixpacks, or a Dockerfile if we need more control). Env vars: `GROQ_API_KEY`, `DATABASE_URL` (from the Postgres service), `OSM_MCP_URL`, `N8N_WEBHOOK_URL`, `BOOKING_MCP_URL`, `BOOKING_MCP_API_KEY`.
- **Database service**: Postgres deployed from a `pgvector`-enabled image (not Railway's stock Postgres template), so `CREATE EXTENSION vector;` works out of the box.
- **n8n service**: deployed from Railway's official n8n template; exposes its own public URL, which becomes `N8N_WEBHOOK_URL` in the app service.
- **Booking MCP service**: [Sowjanyakaki/MCP-server](https://github.com/Sowjanyakaki/MCP-server) deployed from its own repo using the `railway.toml` it already ships (`uvicorn server:app --host 0.0.0.0 --port $PORT`). Needs its own env vars set on that service: `API_SECRET_KEY` (shared secret our app sends as `X-API-Key`), `GOOGLE_CREDENTIALS_JSON`, `GOOGLE_TOKEN_JSON` (base64/JSON-string OAuth creds with the `calendar.events` scope — generated locally via `python auth.py` and copied in), optionally `CALENDAR_ID`.
- **OSM MCP service**: user's fork of `open-streetmap-mcp`, wrapped with an stdio→SSE bridge (`supergateway`/`mcp-proxy`) and deployed as its own Railway service (see §3.2a). URL becomes `OSM_MCP_URL` in the app service. Pending the fork's GitHub URL.
- **Scraper/ingestion scripts**: run locally against the Railway Postgres's public connection string (not part of the request path); output lands in the same DB the deployed app reads from.

Secrets handling: `GROQ_API_KEY`, DB credentials, and `BOOKING_MCP_API_KEY` are set directly as Railway service environment variables (and in a local `.env.local`, gitignored) — never committed to the repo or pasted into chat/logs.

## 8. Open Items / Confirm Before Building

- Confirm which Bengaluru localities to scope the neighborhood RAG corpus to initially (can't realistically cover the whole city for a prototype).
- Need a GitHub repo target to push to, and a Railway project created (app + Postgres + n8n + Booking MCP + OSM MCP services) before scripts/deploys can actually run.
- Groq TTS (`playai-tts`) coverage/quality should be spot-checked early — if it's insufficient for natural-sounding explanations, fall back to browser `SpeechSynthesis` for output while keeping Groq for LLM + STT.
- Booking MCP's Google Calendar needs a real (or dummy/test) Google account behind it — the `python auth.py` OAuth step has to be run once locally to produce `token.json` before the Booking MCP service can be deployed with working calendar access.
- `DAILY_SLOT_TEMPLATE` in that repo is hardcoded to 10:00/15:00 IST, 30-min slots, weekdays only — fine as a default; flag if visit slots should be configurable differently.
- **Waiting on the OSM MCP fork's GitHub URL.** SSE-bridge approach is decided (§3.2a) — once the fork's URL is shared, add the `supergateway` bridge + Railway config to it and set `OSM_MCP_URL` in the app service.

---

**Next step:** once this architecture is approved (or amended), I'll write per-subsystem implementation plans (data ingestion, orchestration/MCP/RAG, voice pipeline, UI, evals, n8n) using the writing-plans skill, and we execute them one at a time.
