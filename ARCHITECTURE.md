# ARCHITECTURE — Pixr Voice Action Agent

> Synced with PRD / AGENT_WORKFLOW / MEMORY_CONTEXT / INTEGRATIONS / UI_UX / IMPLEMENTATION_PLAN — 2026-09-25.

## ⚡ As built (2026-09-25): supersedes the rows below where they differ
- **Storage: SQLite** (`better-sqlite3`, `data/relay.db`) + LangGraph `SqliteSaver` (`data/checkpoints.db`) instead of Postgres. There's no Postgres on this machine, and the app is single-owner and local-first (D-02a, D-09). The schema mirrors §9 with `task_steps` folded into `tasks.state` JSON. Swap to Postgres + `PostgresSaver` when going multi-user.
- **LLM fallback: `openai/gpt-oss-20b`** (`llama-3.3-70b-versatile` isn't available on this Groq key). The primary gets one retry on Groq's intermittent "tool call validation failed".
- **Meet goes through Swytchcode** (see INTEGRATIONS "Update"). **All 14 integrations use Swytchcode method definitions** (INTEGRATIONS §0, §9).
- **Voice (2026-09-25):** follow-up questions keep the mic on (10 s wait, then "I didn't hear anything…" and idle; the task stays resumable). **"Hey Pixr" wake word** via the browser's Web Speech recognition while the tab is visible (Chrome/Edge/Safari; not Firefox; never in background tabs).
- **Swytchcode CLI pinned in the project** (`swytchcode@2.23.5` devDependency). The app spawns the native binary at `node_modules/swytchcode-cli-<platform>-<arch>/bin/` directly (Node refuses to spawn `.cmd` shims without a shell).
- **Ask/confirm events are sent by `runTurn` from the checkpoint**, not from inside the node, because a resume re-runs the node up to `interrupt()`.
- Files: `lib/{env,log,db,swytchcode,tools,integrations,agent,auth,types}.ts`, `app/api/{agent,stt,integrations,state,login}`, `components/{Assistant,Shell,voice}`, `proxy.ts` (Next 16's renamed middleware).

## 1. Decisions made (and why)

| ID | Decision | Rationale (evidence) |
|---|---|---|
| A-01 | **One Next.js (App Router) app, TypeScript strict**, Node runtime route handlers for the API. No separate backend service. | One deployable, one language, and SSE streaming works in route handlers. The repo is empty, so there's no legacy code to preserve. |
| A-02 | **Agent = LangGraph.js** (`@langchain/langgraph`) `StateGraph` with `interrupt()` + **Postgres checkpointer** (`@langchain/langgraph-checkpoint-postgres`). | The brief needs persistent state, interruption, resume and confirmations. `interrupt()`/`Command({resume})` is exactly that. Swytchcode ships a LangGraph quickstart and a `LangGraphProvider` in `@swytchcode/runtime`. |
| A-03 | **LLM via an OpenAI-compatible abstraction** (`@langchain/openai` `ChatOpenAI` with `configuration.baseURL = LLM_BASE_URL`). Default provider **Groq**: primary `openai/gpt-oss-120b`, fallback `llama-3.3-70b-versatile`, using LangChain's built-in `.withFallbacks()`. | Changing provider is a change to 3 env vars. Groq is fast (≈500 t/s), supports tool calling, and the user supplied a Groq key. Fallback uses a built-in feature, so there's no custom retry code. |
| A-04 | **STT = Groq Whisper** (`whisper-large-v3-turbo`) through a server route. Browser **Web Speech API** interim results are shown as a *display-only* live transcript where available (Chrome/Android). | Same key, ~$0.04/h, and works on every browser that has `MediaRecorder`. Web Speech alone is missing on Firefox and flaky on mobile. |
| A-05 | **TTS = browser `speechSynthesis`** (native). A premium TTS provider is behind the `TTS_PROVIDER` env var and not built in MVP (**D-05**). | Zero latency, zero cost, zero dependency. |
| A-06 | **Swytchcode kernel executed via an async wrapper around `swytchcode exec --json` (stdin JSON)**. The `@swytchcode/runtime` SDK is **not** used for execution. | Inspected `@swytchcode/runtime@1.1.6`: it is a *"thin runtime wrapper around the Swytchcode CLI"* and runs it with **`spawnSync`**, which blocks the Node event loop and would freeze every SSE stream while a tool runs. Our wrapper is the same protocol with `child_process.spawn` (~40 lines). |
| A-07 | **Curated capability layer**: we expose ~30 hand-picked tools with small, LLM-friendly Zod schemas. Each maps to an exact Swytchcode canonical ID. We do *not* dump raw schemas (Slack alone has 174 methods; the Calendar event body has 60+ fields). | Better tool-selection accuracy on open models and a smaller prompt. Risk tier and verifier are attached per tool. The LLM still chooses tools freely; nothing is phrase-mapped. |
| A-08 | **Google Meet = Google Calendar conferencing** (`calendar.event.create` / `calendar.event.update` with `conferenceDataVersion=1` + `conferenceData.createRequest.conferenceSolutionKey.type="hangoutsMeet"`). | There's no Google Meet integration in the Swytchcode registry (searched all 352 entries). The Calendar schema exposes `conferenceData` and `hangoutLink`, so the Meet link is real and verifiable. |
| A-09 | **Postgres (Supabase-hosted)** via `pg`. Plain SQL migrations. No ORM. | The LangGraph checkpointer needs `pg` anyway, and the schema is small. |
| A-10 | **Single-owner auth** (passcode → signed httpOnly cookie using `AUTH_SECRET`). Recommended; see **D-01**. | Swytchcode provider credentials are *one connected account per provider per workspace* (from `swy auth --help`), so the product is inherently single-tenant unless we run our own OAuth. |
| A-11 | **Runtime host = a long-lived Node process with the `swytchcode` CLI installed** (local machine for the demo; Docker on Render/Railway/Fly for deploy). **Not Vercel serverless.** See **D-02**. | The kernel is a local binary that reads `.swytchcode/` and the local credential store (`~/.swytchcode/credentials.db`). |
| A-13 | Styling: **Tailwind CSS v4** + CSS-variable tokens from `UI_UX.md`; icons **lucide-react**; motion: CSS transitions + a small amount of `motion` (Framer Motion successor) only for the orb and bottom sheets. | Native first, and the reference style is achievable with CSS. |

## 2. System diagram

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│  VoiceOrb / CommandWindow / BottomSheet  ─ useAgentSession (reducer)  │
│    MediaRecorder ─► POST /api/stt ─► transcript                        │
│    fetch POST /api/agent  ◄── SSE stream (status/step/ask/confirm/done)│
│    speechSynthesis (TTS)                                               │
└───────────────────────────────▲────────────────────────────────────────┘
                                │ HTTPS, httpOnly session cookie
┌───────────────────────────────┴──── Next.js server (Node) ──────────────┐
│ /api/stt ──► Groq Whisper (server-side key)                              │
│ /api/agent ──► LangGraph graph.stream(input | Command{resume}, thread)   │
│      nodes: load_context → agent(LLM+tools) → guard → [interrupt]        │
│             → execute → verify → agent … → finalize                      │
│      LLM: ChatOpenAI(baseURL=LLM_BASE_URL).withFallbacks([fallback])     │
│ capability registry (lib/tools/*) ── transport: swytchcode | direct     │
│      swytchcode transport ─► spawn `swytchcode exec <id> --json` (stdin) │
│      direct transport ─────► same Swytchcode method, Pixr-held token   │
│ /api/integrations  (live health probes, connect/disconnect)             │
│ /api/tasks, /api/preferences, /api/memory                               │
└──────────┬──────────────────────────────────┬────────────────────────────┘
           │ pg                                │ child process
   ┌───────▼────────┐                 ┌────────▼──────────────────────────┐
   │ Postgres       │                 │ swytchcode CLI (kernel)           │
   │ app tables +   │                 │ .swytchcode/{tooling,policies}.json│
   │ lg checkpoints │                 │ creds: env ▸ managed store ▸ .env  │
   └────────────────┘                 │ retries 429/503/504, idempotency  │
                                      └──────────┬────────────────────────┘
                                                 ▼
                 Google Calendar(+Meet) · Gmail · Slack · Notion · Drive · GitHub*
```
\* GitHub pending blocker B-01.

## 3. Repository layout (planned)

```
/app
  /(app)/page.tsx                 Home — voice assistant
  /(app)/history/page.tsx         Task history
  /(app)/apps/page.tsx            Connected apps
  /(app)/settings/page.tsx        Preferences + memory
  /login/page.tsx
  /api/agent/route.ts             POST: start/resume turn → SSE
  /api/stt/route.ts               POST: audio → text
  /api/integrations/route.ts      GET status; POST connect/disconnect
  /api/tasks/route.ts             GET history
  /api/preferences/route.ts       GET/PUT
  /api/memory/route.ts            GET/POST/PATCH/DELETE contacts & facts
/components                       orb, timeline, sheets, cards (see UI_UX.md)
/lib
  /agent/graph.ts                 StateGraph definition
  /agent/state.ts                 Annotation + types (TaskState, …)
  /agent/prompt.ts                system prompt builder
  /agent/guards.ts                provenance + schema + risk gates
  /llm.ts                         model factory (env-driven, fallback)
  /stt.ts                         Whisper client
  /swytchcode.ts                  async exec wrapper + error classification
  /tools/registry.ts              ToolDefinition type + registry
  /tools/{calendar,gmail,slack,notion,drive,github,zoom,discord,docs,sheets,slides,x,weather} (all in lib/tools.ts)
  /db.ts, /migrations/*.sql
  /memory.ts                      retrieval + writes
  /log.ts                         structured logger with redaction
/.swytchcode/tooling.json, policies.json   (committed; bundles fetched by `swy bootstrap`)
Dockerfile, .env.example
```

## 4. Frontend

- **State machine** in `useAgentSession` (a `useReducer`): `IDLE → LISTENING → THINKING → (ASKING | CONFIRMATION | EXECUTING)* → SPEAKING → SUCCESS | ERROR → IDLE`. The UI only renders the machine state plus the server event log. It never invents a status.
- **Transport**: `fetch('/api/agent', {method:'POST', body})` and read `response.body` as an SSE stream (EventSource can't POST).
- **Voice capture**: `getUserMedia` → `MediaRecorder` (webm/opus; mp4 on Safari) → blob → `/api/stt`. Stop on release, tap-again, or 1.2 s of silence (AnalyserNode RMS). Max 30 s.
- **Hands-free follow-up**: after TTS finishes a question (ASKING), the mic re-opens automatically if `prefs.handsFree` is on (default on for mobile).
- **PWA**: `app/manifest.ts` + minimal service worker for installability only. No offline agent.

## 5. Backend API

| Route | Method | Body / Query | Returns |
|---|---|---|---|
| `/api/agent` | POST | `{sessionId, input: {type:'text', text}} \| {sessionId, resume: {kind:'answer', value} \| {kind:'confirm', decision:'approve'\|'cancel'\|'edit', edits?} \| {kind:'retry'}}` | `text/event-stream` of events (below) |
| `/api/stt` | POST | multipart `audio` (≤ 25 MB, ≤ 30 s) | `{text, durationMs}` or `{error}` |
| `/api/integrations` | GET | – | `[{id, name, transport, status:'connected'\|'not_connected'\|'expired'\|'error'\|'unavailable', account?, checkedAt, detail?}]` |
| `/api/integrations` | POST | `{id, action:'connect'\|'disconnect'}` | `{status, instructions?}` |
| `/api/tasks` | GET | `?cursor` | paginated task history |
| `/api/preferences` | GET/PUT | prefs object (Zod-validated) | prefs |
| `/api/memory` | GET/POST/PATCH/DELETE | contact/fact | items |

**SSE event types** (the only contract between agent and UI):

```ts
type AgentEvent =
  | { type: 'state'; state: 'THINKING'|'EXECUTING'|'ASKING'|'CONFIRMATION'|'SUCCESS'|'ERROR' }
  | { type: 'plan'; steps: { id: string; label: string; tool?: string }[] }
  | { type: 'step'; id: string; label: string; status: 'pending'|'running'|'done'|'failed'|'skipped'; evidence?: { url?: string; id?: string } }
  | { type: 'ask'; question: string; field: string; inputHint?: 'email'|'text'|'date'|'time'|'choice'; choices?: string[] }
  | { type: 'confirm'; actionId: string; title: string; preview: Record<string, string>; risk: 'low'|'high' }
  | { type: 'final'; spoken: string; display: string; outcomes: Outcome[] }
  | { type: 'error'; userMessage: string; retryable: boolean };
```

All routes check the session cookie. `/api/agent` and `/api/stt` have per-session rate limits (in-memory token bucket; `ponytail: single-process limiter, move to Postgres/Redis if horizontally scaled`).

## 6. Agent (summary; full spec in `AGENT_WORKFLOW.md`)

- **Thread** = one voice session (`sessionId` → LangGraph `thread_id`). **Task** = one user goal inside the thread (`state.task`). A thread can hold many sequential tasks. Finished tasks are archived to `agent_tasks`.
- **Graph**: `load_context → agent → route{ ask_user | integration tool | finish } → guard → (interrupt: confirm) → execute → verify → agent … → finalize`.
- **Control tools** given to the LLM besides integration tools: `update_plan`, `ask_user`, `remember` (propose a memory, user-confirmed), `memory_list`, `memory_delete`, `finish`.
- **Guards (deterministic, not LLM)**: Zod validation of args; **provenance check** (every email/phone/ID in write args must appear in user utterances, confirmed memory or a tool result for this task); risk gate (confirmation); step cap (`recursionLimit: 40`, max 12 tool executions per task).

## 7. LLM layer

```ts
// lib/llm.ts (shape)
const base = { apiKey: env.LLM_API_KEY, configuration: { baseURL: env.LLM_BASE_URL }, temperature: 0.2, timeout: 20_000, maxRetries: 1 };
export const model = new ChatOpenAI({ ...base, model: env.LLM_MODEL })
  .bindTools(tools)                                    // same tools on both
  .withFallbacks([new ChatOpenAI({ ...base, model: env.LLM_FALLBACK_MODEL }).bindTools(tools)]);
```
- `LLM_PROVIDER` is informational/logging only. Any OpenAI-compatible provider works by changing `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY`.
- Tool list per call = control tools + tools of **currently connected** integrations only (≈15–30). This keeps within model tool limits and stops the model choosing an unconnected app.
- No chain-of-thought is streamed. Only `plan`/`step` labels (short action summaries) reach the UI.

## 8. Swytchcode layer

- **Project**: `.swytchcode/` at repo root, `mode: production`. `tooling.json` = the allowlist of the canonical IDs in `INTEGRATIONS.md` (Swytchcode's own trust boundary; the kernel refuses anything else). `policies.json` = BLOCK rules for methods we never want run (e.g. `gmail.user.messages.delete`, `drive.file.trash.delete`) as defence-in-depth.
- **Exec wrapper** (`lib/swytchcode.ts`):
  ```ts
  exec(canonicalId, { body?, params?, headers? }, { timeoutMs = 45_000 }) → Promise<unknown>
  // spawn(SWYTCHCODE_BIN ?? 'swytchcode', ['exec', id, '--json'], { cwd: SWYTCHCODE_PROJECT_DIR, env: {…process.env} })
  // write JSON to stdin; collect stdout/stderr; on exit≠0 parse stderr JSON {error, category, retryable, suggested_action}
  ```
  Errors map to `ToolError{category:'auth'|'policy'|'validation'|'not_found'|'rate_limit'|'timeout'|'network'|'provider', retryable, userMessage}` (see `AGENT_WORKFLOW.md` §9).
- **Retries**: the kernel already retries 429/503/504 with backoff (from `manifest.json` `execution_policy`: `max_retries: 3`, `retry_on: [429,503,504]`, `total_timeout_ms: 90000`). **We don't add another retry layer for provider errors.** We retry once only on spawn failure/timeouts, and only for **read** tools.
- **Idempotency**: manifests ship `idempotency.mode: "none"`. For our write tools we set `dynamic` in `manifest.json`/`tooling.json` where the provider honours `Idempotency-Key` (verify in Phase 0; Google APIs mostly don't). For Calendar, `conferenceData.createRequest.requestId = actionId` gives natural dedupe of Meet creation. Guard against double-execution with the `tool_executions.action_id` unique constraint.
- **Auth to Swytchcode**: local dev uses `swy login` session; server/Docker uses **`SWYTCHCODE_TOKEN`** (`swy_key_…`, read from the process env only, never from `.env` by the CLI; per Swytchcode Authentication guide).
- **Provider credentials**: `swy auth connect <provider>` (browser OAuth) on the host machine; resolution order *env vars ▸ managed store ▸ project .env*. Exact provider env-var names for headless deploy are **unverified** → Phase 0 task P0-6.

## 9. Database (Postgres)

```sql
create table users (id uuid primary key default gen_random_uuid(), email text unique not null, name text, created_at timestamptz default now());
create table sessions (id uuid primary key, user_id uuid references users, created_at timestamptz default now(), last_seen_at timestamptz);
create table messages (id bigserial primary key, session_id uuid references sessions, task_id uuid, role text check (role in ('user','agent')), text text not null, via text check (via in ('voice','text')), created_at timestamptz default now());
create table agent_tasks (id uuid primary key, user_id uuid references users, session_id uuid, request text not null, intent text, goal text,
  status text check (status in ('running','asking','awaiting_confirmation','completed','failed','cancelled')),
  state jsonb not null default '{}',          -- snapshot of TaskState (no secrets, no raw tool payloads)
  final_result jsonb, error jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create table task_steps (id bigserial primary key, task_id uuid references agent_tasks on delete cascade, seq int, label text, tool_id text,
  status text check (status in ('pending','running','done','failed','skipped')), evidence jsonb, created_at timestamptz default now());
create table tool_executions (id bigserial primary key, task_id uuid references agent_tasks on delete cascade, action_id text unique,
  tool_id text not null, integration text not null, transport text check (transport in ('swytchcode','direct')), risk text,
  args_redacted jsonb, status text check (status in ('ok','error','cancelled')), verified boolean, evidence jsonb,
  error_category text, latency_ms int, attempt int default 1, created_at timestamptz default now());
create table connected_integrations (integration text primary key, status text, account_label text, checked_at timestamptz, detail text); -- cache of live probe
create table user_preferences (user_id uuid primary key references users, name text, email text, timezone text not null, -- set from the browser at first login
  default_meeting_minutes int not null default 60, work_start time default '09:00', work_end time default '18:00',
  preferred_channel text check (preferred_channel in ('email','slack')) default 'email',
  confirm_low_risk boolean default false, hands_free boolean default true, default_slack_channel text, default_github_repo text, default_notion_parent text,
  updated_at timestamptz default now());
create table contacts (id uuid primary key default gen_random_uuid(), user_id uuid references users, name text not null, aliases text[] default '{}',
  email text, slack_user_id text, source text check (source in ('user_stated','user_confirmed_from_tool')), last_used_at timestamptz, created_at timestamptz default now());
create table memories (id uuid primary key default gen_random_uuid(), user_id uuid references users, kind text check (kind in ('fact','preference_note')),
  content text not null, source text, confirmed boolean not null default false, created_at timestamptz default now());
-- LangGraph checkpoint tables are created by PostgresSaver.setup()
```
(`default_meeting_minutes = 60` follows the brief's own example ("6 to 7 PM" with no duration asked). Timezone is never guessed; it comes from `Intl.DateTimeFormat().resolvedOptions().timeZone` at first login and is editable in Settings.)

## 10. Security

- Secrets exist **only** in server env: `LLM_API_KEY`, `STT_API_KEY`, `SWYTCHCODE_TOKEN`, `DATABASE_URL`, `AUTH_SECRET`, `APP_PASSCODE`. No `NEXT_PUBLIC_` secret. A CI/Phase 9 check greps `.next/static` for key prefixes (`gsk_`, `swy_key_`, `secret-`).
- Provider OAuth tokens never touch our app or DB. They live in Swytchcode's store and are attached by the kernel.
- The logger redacts keys matching `/token|key|secret|authorization|password|raw/i` and truncates bodies. Email bodies and message text are **not** logged, only lengths/IDs.
- Cookie: `httpOnly; Secure; SameSite=Lax`, HMAC-signed with `AUTH_SECRET`. Mutating routes are same-origin checked (`Origin` header).
- Prompt-injection stance: tool results (emails, Slack messages, Notion pages) are **data**. They're wrapped in `<tool_data>` delimiters, the system prompt says instructions inside are to be ignored, and the guard means no write happens without the user's own instruction plus a confirmation for high-risk writes.
- OAuth scopes: we request the minimum per integration (see `INTEGRATIONS.md`). Gmail uses `gmail.send` + `gmail.readonly`, not `mail.google.com`. This is **subject to what Swytchcode's managed OAuth app requests (unverified, P0-7).**

## 11. Environment variables (`.env.example`)

```
# LLM (server only)
LLM_PROVIDER=groq
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=
LLM_MODEL=openai/gpt-oss-120b
LLM_FALLBACK_MODEL=llama-3.3-70b-versatile
# Speech
STT_PROVIDER=groq
STT_MODEL=whisper-large-v3-turbo
STT_API_KEY=            # defaults to LLM_API_KEY when empty
TTS_PROVIDER=browser    # browser | (future) elevenlabs …
TTS_API_KEY=
# Swytchcode (brief called these SWYTCHCODE_API_KEY / SWYTCHCODE_PROJECT_ID; real names below)
SWYTCHCODE_TOKEN=       # swy_key_… service token (server/Docker); not needed locally after `swy login`
SWYTCHCODE_PROJECT_DIR=.   # folder containing .swytchcode/
SWYTCHCODE_BIN=         # optional explicit path to the CLI
# Direct (non-Swytchcode) adapters
# App
DATABASE_URL=
AUTH_SECRET=            # 32+ random bytes
APP_PASSCODE=           # owner login
APP_BASE_URL=http://localhost:3000
```

## 12. Data flow — Demo 1 (sequence)

```
User (voice) ─► /api/stt ─► "okay schedule Rahul for 6 to 7"
UI ─► POST /api/agent {text}
  load_context: prefs(tz, 30m default), contacts~"Rahul" → none, connected: calendar,gmail,…
  agent: update_plan([check free/busy, create event+Meet, email invite])     ─► SSE plan
  agent: calendar_find_events(18:00–19:00)  → guard(read) → execute → verify  ─► SSE step done
  agent: needs attendee email → ask_user("What's Rahul's email address?")   ─► SSE ask ; interrupt
User: "rahul at acme dot com" ─► POST resume{answer} → normalised "rahul@acme.com" (echoed for confirmation in the ask card)
  agent: calendar_create_event(..., createMeet:true) → guard: provenance ✓ (email came from user), risk=high (external attendee) → interrupt confirm
User taps Confirm ─► resume{approve}
  execute calendar.event.create → verify(id ✓, hangoutLink ✓)                ─► SSE step done + evidence
  agent: gmail_send(to rahul@…, body with Meet link) → guard high → interrupt confirm ─► Confirm
  execute gmail.user.send.create1 → verify(id ✓, labelIds∋SENT)               ─► SSE step done
  agent: finish(...) → finalize: template checks all writes verified          ─► SSE final (spoken + display)
  remember proposal: "Save Rahul's email?" (chip in final card, one tap)
```
(Merging the two confirmations into one "plan confirmation" is an option; see **D-07**.)

## 13. Observability

One JSON log line per event: `{ts, level, taskId, sessionId, node, toolId, integration, transport, status, latencyMs, attempt, errorCategory, model, fallbackUsed}`. Persisted execution records live in `tool_executions`. A dev-only `/history` "details" drawer shows the step log. No secrets or payload bodies are logged.

## 14. Deployment

- **Demo (recommended)**: run on the presenter's laptop (`npm run build && npm start`), with CLI logged in and providers connected via `swy auth connect`, DB on Supabase. This is the most reliable path (**D-02**).
- **Hosted**: `Dockerfile` (node:22-slim + `npm i -g swytchcode` + `swy bootstrap` at build) → Render/Railway/Fly, env from dashboard, `SWYTCHCODE_TOKEN`. Provider creds for headless hosts are pending P0-6.
