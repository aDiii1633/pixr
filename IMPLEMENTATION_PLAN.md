# IMPLEMENTATION_PLAN — ordered build plan

> Synced with all six sibling docs — 2026-09-25. Section IDs (P0-x, D-x, B-x, T-x) are referenced from the other docs.

## 1. Current state (inspected 2026-09-25)

- `D:\swytchcode` contains only these 7 planning docs. It is not yet a git repository.
- Toolchain: Node 24.20, npm 11.19, Python 3.14, git 2.53. Swytchcode CLI **2.20.4** installed and logged in (`swy whoami` → valid user session; the interactive session expires hourly). An update to 2.23.5 is available.
- No provider accounts are connected yet (`swy auth status` → "No connected accounts").
- Git Bash in this environment fails to fork (`0xC0000142`), so scripts use PowerShell/Node.
- Groq API key: provided by the user in a local text file. It will go **only** into `.env.local` (gitignored), never into source. **Recommend rotating it after the hackathon**, since it has lived in a plain-text file.

## ⚡ Build status (2026-09-25)
Phases 1–7 are built (web app). Defaults were taken where you didn't decide: D-01 single owner, D-02 local, D-05 browser TTS, D-07 per-action confirm, D-08 30 days, D-09 SQLite locally. B-01 is resolved (GitHub is in Swytchcode). Integrations added in place of the earlier event-platform option: Zoom, Discord, Google Docs/Sheets/Slides, X.com, OpenWeather. Verified with real calls: Groq planning + tool calling; the ask → resume and confirm → resume flows (resume also survives a server restart); spoken-email normalisation; the truthfulness guards; the live Apps status from `swytchcode auth status`. **Still open:** connecting the 8 apps (browser sign-in, done by you), then Phase 0 checks P0-8…P0-12 against real accounts (Slack token type, Notion-Version, Gmail send content-type, Drive v2/v3, Meet `conferenceData`), then Phase 8 end-to-end demos.

## 2. DECISION REQUIRED

| ID | Question | Options | Recommendation |
|---|---|---|---|
| **D-01** | Single owner or multi-user? | (a) single owner, Swytchcode-managed creds; (b) multi-tenant with our own Google/Slack/Notion OAuth apps, passing per-user `Authorization` in exec args | **(a)** for the hackathon. (b) is a bigger project (OAuth app verification, token storage). |
| **D-02** | Where does the demo run? | (a) presenter's laptop (CLI + OAuth local); (b) hosted Docker (Render/Railway/Fly) | **(a)** for the live demo; (b) is built to prove "deployable" once P0-6 answers headless credentials |
| **D-04** | GitHub if still blocked after P0-1/P0-2 | (a) keep waiting on Swytchcode; (b) temporary direct GitHub REST adapter (fine-grained PAT), labelled "Direct"; (c) drop GitHub, use the Slack → Notion demo | Decide at the end of Phase 0: (b) if the demo must show GitHub, else (c) |
| **D-05** | Voice output quality | (a) browser `speechSynthesis`; (b) premium TTS (ElevenLabs/Groq TTS) | (a) now; (b) only if time remains after Phase 8 |
| **D-06** | Which accounts are connected for the demo, and who is "Rahul"? | Personal accounts vs a dedicated demo Google Workspace/Slack/Notion | **Dedicated demo accounts** + a "Rahul" mailbox you control. Real emails and events get created. |
| **D-07** | Confirmation granularity for multi-write tasks (Demo 1) | (a) confirm each high-risk action (event, then email); (b) one "plan confirmation" covering all writes; (c) use Google's native invite (`sendUpdates:'all'`) and skip the Gmail send | **(a)** matches the brief ("Ready to send this email to Rahul. Send it?") and is safest |
| **D-08** | History retention | 7 / 30 / 90 days / forever | 30 days |
| **D-09** | Database | (a) new Supabase free project (MCP available here); (b) existing Supabase project; (c) local Postgres | (a). Creating the project needs your OK and org choice. |
| **D-10** | Product name / wordmark | "Pixr" (working name) or yours | Your call; only affects copy and logo |
| **D-11** | Deadline / demo date | – | Needed to decide what's cut if time runs short (see §8) |

## 3. Blockers

| ID | Blocker | Owner | Unblock |
|---|---|---|---|
| **B-01** | GitHub bundle fetch fails (`SWY-ERR-AB06DD`, `SWY-ERR-A7F07D`, `SWY-ERR-F2F877`) | You + Swytchcode | P0-1, P0-2, else D-04 |
| B-02 | No provider accounts connected | You (browser OAuth) | P0-4 |
| B-03 | No `SWYTCHCODE_TOKEN` for server/Docker | You (app.swytchcode.com) | P0-5 |

## 4. Phases

```
P0 Verify ─┬─► P1 Scaffold ─► P2 DB/Auth ─┬─► P4 Agent ─► P5 Memory ─┐
           └─► P3 Tool layer ─────────────┘                          ├─► P8 E2E ─► P9 Harden ─► P10 Deploy+Demo
               P6 Voice (after P1) ─────────► P7 UI (after P1; wires to P4/P6) ┘
```

### Phase 0 — Verify capabilities (no app code) · *gate for everything*
| Task | Detail | Done when |
|---|---|---|
| P0-1 | Upgrade CLI: `irm https://cli.swytchcode.com/install.ps1 \| iex` (you run it), then `swy get github` | Bundle saved, or new error recorded |
| P0-2 | If it still fails: send the reference IDs to Swytchcode (hello@swytchcode.com / Discord) | Ticket sent |
| P0-3 | `git init`; `swy init --editor=none --mode=production`; `swy get` Calendar, Gmail, Slack, Notion, Google Drive (+GitHub); `swy add` each canonical ID in INTEGRATIONS §2–7 | `tooling.json` lists exactly those IDs; `swy doctor` clean |
| P0-4 | `swy auth connect "Google Calendar" / "Gmail" / "Slack" / "Notion" / "Google Drive"` with the D-06 accounts | `swy auth status` shows 5 |
| P0-5 | Create a service token in app.swytchcode.com → `SWYTCHCODE_TOKEN` in `.env.local` | `swy whoami` works with only the token set |
| P0-6 | Find how provider creds resolve headless (env var names) from docs/support/`swy auth` on a clean machine | Documented in ARCHITECTURE §8, or D-02 fixed to (a) |
| P0-7 | Record the scopes granted per provider | INTEGRATIONS updated |
| P0-8 | Slack: does the kernel inject `token`? Is it a user or bot token? Does `search.messages` work? (S-R1) | Answer recorded; tool set adjusted |
| P0-9 | Notion: required `Notion-Version`; `notion.search.create` and `notion.page.create` real calls | Working header value pinned |
| P0-10 | Gmail G-R1: `--dry-run` then a real send-to-self with `raw` | `labelIds` contains `SENT`; header override pinned if needed |
| P0-11 | Drive D-R1: real `drive.file.list` → confirm v2 or v3 semantics | Query syntax pinned |
| P0-12 | Calendar: create an event with `conferenceDataVersion=1` + `hangoutsMeet` → `hangoutLink` present; then delete it | Verified |
| P0-13 | Groq: `openai/gpt-oss-120b` with ~30 tool schemas, a tool-call round-trip, measured latency; the fallback model the same | p50 < 2 s per LLM step |
| P0-15 | Save **redacted** real responses as test fixtures (`tests/fixtures/*.json`) | One fixture per tool |

**Exit:** a `scripts/smoke.ts` run prints ✓/✕ per integration from real calls, and the docs are updated with the answers.

### Phase 1 — Scaffold (½ day)
- `create-next-app` (TS strict, App Router, Tailwind v4, ESLint), `next/font` Outfit + Nunito Sans, tokens from UI_UX §2 in `globals.css`.
- `lib/env.ts`: Zod-validated server env (fails fast; never imported by client components; `server-only` package guard).
- `.env.example` (ARCHITECTURE §11), `.gitignore` (`.env*`, `.swytchcode/integrations/`, credentials), `Dockerfile` skeleton.
- Deps (whole project): `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`, `@langchain/openai`, `@langchain/core`, `zod`, `pg`, `lucide-react`, `motion`. **No others without a stated reason.**

### Phase 2 — Database + auth (½ day) · needs D-09
- `lib/migrations/001_init.sql` = ARCHITECTURE §9 (with `default_meeting_minutes` default **60**, from the brief's own example; the timezone default is set from the browser at first login).
- `lib/db.ts` (single `pg.Pool`), `scripts/migrate.ts` (runs SQL files in order, `schema_migrations` table).
- `PostgresSaver.fromConnString(DATABASE_URL).setup()` on boot.
- Passcode login → HMAC cookie; `middleware.ts` protects `(app)` and `/api/*` except `/api/login`.

### Phase 3 — Tool layer (1 day) · needs P0
- `lib/swytchcode.ts`: async `spawn` exec wrapper (ARCHITECTURE §8), stderr JSON classification → `ToolError`, redacting logger.
- `lib/tools/registry.ts` + `calendar.ts`, `gmail.ts` (MIME `raw` builder), `slack.ts`, `notion.ts`, `drive.ts`, `github.ts` (only after B-01 or D-04b).
- Health probes + `/api/integrations` (GET status, POST connect → `swy auth connect <Project>` spawned detached on a local host; disconnect → `swy auth disconnect`).
- `.swytchcode/policies.json` BLOCK list via `swy policy add` (INTEGRATIONS §11).
- Unit tests: `toRequest` snapshots and `verify` against Phase 0 fixtures (verified/unverified/error cases).

### Phase 4 — Agent core (1.5 days) · needs P2, P3
- `lib/agent/state.ts`, `graph.ts` (nodes per AGENT_WORKFLOW §3), `prompt.ts`, `guards.ts` (schema, provenance, risk, idempotency), `finalize` truthfulness check.
- `lib/llm.ts` with `.withFallbacks`.
- `/api/agent` SSE route: input or `Command({resume})`, `streamMode: ['updates','custom']` → `AgentEvent`s; writes `messages`, `agent_tasks`, `task_steps`, `tool_executions`.
- Tests (Node test runner, deterministic): a scripted chat model (`FakeListChatModel`-style, **test-only**) drives the graph through ask → resume, confirm → cancel/approve/edit, provenance rejection, verification failure → honest final, step cap. The transport is stubbed with Phase 0 fixtures **in tests only**. Production code has no fixture path.

### Phase 5 — Memory (½ day) · needs P4
- `load_context` retrieval (MEMORY_CONTEXT §5), rolling summary, `remember`/`memory_list`/`memory_delete` tools, `/api/memory`, `/api/preferences`, retention cleanup on boot.
- Tests: retrieval by alias, conflict rules, secret rejection in `remember`.

### Phase 6 — Voice (1 day) · needs P1
- `/api/stt` → Groq `audio/transcriptions` (`whisper-large-v3-turbo`, `language: en`, `response_format: json`), 25 MB/30 s guard, empty-text handling.
- `useRecorder` (MediaRecorder + AnalyserNode RMS + 1.2 s silence auto-stop + 30 s cap), `useInterimTranscript` (Web Speech where available), `useSpeaker` (`speechSynthesis`, voice/rate prefs, barge-in cancel), `useAgentSession` reducer (UI_UX §5).
- Permission pre-prompt, denied and unsupported flows.

### Phase 7 — UI (2 days) · needs P1; wires to P4/P6
Order: tokens + AppFrame/TopNav/BottomNav → VoiceOrb (all states) → Home hero + active stage → AskCard → ConfirmSheet → ExecutionTimeline → OutcomeCard → Apps → History (+detail drawer) → Settings (+memory) → Login → Command window (⌘K) → PWA manifest/icons. Follow UI_UX §12 checklist per component.

### Phase 8 — End-to-end integration (1 day) · needs P3–P7 + P0-4
Run the test matrix (§6) against **real** connected demo accounts; fix; re-run.

### Phase 9 — Hardening (½ day)
- Security: `rg -n "gsk_|swy_key_" .next/static` = 0 hits; no `NEXT_PUBLIC_` secrets; cookie flags; Origin check; log redaction test.
- "No fake success" audit: `rg -n "success|verified: true" lib/` reviewed; every `verified:true` must derive from a response field.
- a11y: keyboard-only Demo 1; axe run on the 5 screens; reduced-motion pass.
- Perf: orb at 60 fps on a mid-range Android (Chrome devtools CPU 4× throttle); first status < 1.5 s.
- Error copy review against AGENT_WORKFLOW §9.

### Phase 10 — Deploy + demo (½ day)
- Local production build on the demo laptop (D-02a); Docker image build + run with `.env` to prove deployability (D-02b); Supabase prod DB migrated.
- Demo rehearsal ×3 (§7); a pre-demo checklist script: `swy auth status`, probes green, Groq OK, mic permission granted, TTS voice chosen.

## 5. Work split by area (cross-reference)

| Area | Phases | Key files |
|---|---|---|
| Database | P2, P5 | `lib/migrations/*.sql`, `lib/db.ts` |
| Agent | P4, P5 | `lib/agent/*`, `app/api/agent/route.ts` |
| Integrations | P0, P3 | `.swytchcode/*`, `lib/swytchcode.ts`, `lib/tools/*` |
| Voice | P6 | `app/api/stt/route.ts`, `hooks/useRecorder.ts`, `hooks/useSpeaker.ts` |
| UI | P7 | `components/*`, `app/(app)/*` |
| Testing | P3–P5 unit, P8 E2E | `tests/*` |
| Security | P1 env guard, P2 auth, P9 audit | `lib/env.ts`, `middleware.ts`, `lib/log.ts` |
| Deployment | P1 Dockerfile, P10 | `Dockerfile`, `.env.example` |

## 6. Test matrix (brief §40 → test IDs)

| ID | Scenario | Type | Pass criteria |
|---|---|---|---|
| T-CAL-READ | "Meetings between 5 and 7 today?" | E2E real | Correct events spoken; empty range → "You're free" |
| T-CAL-CREATE | Create event with no attendees | E2E real | Low-risk, no confirm (default), `id` evidence |
| T-GMAIL-SEARCH | "Any emails from Rahul this week?" | E2E real | Summarized list, no bodies logged |
| T-GMAIL-SEND | Send an email to self | E2E real | Confirm shown; `SENT` label verified |
| T-SLACK-MSG | "Tell #demo the deploy is delayed 2 hours" | E2E real | Confirm → `ok:true` + permalink |
| T-GH-SEARCH | List issues needing attention | E2E real | After B-01/D-04 |
| T-GH-CREATE | "Create an issue for the login bug" | E2E real | Repo asked if ambiguous; `html_url` verified |
| T-NOTION-SEARCH | "Find my hackathon notes" | E2E real | Results or "not shared with integration" explanation |
| T-DRIVE-SEARCH | "Find my latest hackathon presentation" | E2E real | Newest matching file + link |
| T-ZOOM-DOC | Demo 2 flow (Zoom call + agenda doc) | E2E real | ≤ 1 question, `join_url` + `documentId` verified |
| T-MEET-CREATE | "Create a Meet for my 6 PM meeting" | E2E real | `hangoutLink` verified |
| T-MULTI-1 | Demo 1 full chain | E2E real | 3 tools, 2 confirms, all verified |
| T-MISSING-1 | "Schedule a meeting with Rahul tomorrow" (no time) | unit + E2E | Asks only "What time?" (duration from prefs) |
| T-AMBIG-CONTACT | Two Rahuls in contacts | unit | Choice question; no send before choice |
| T-TOOL-FAIL | Disconnect Slack, then send | E2E real | "Your Slack connection has expired/isn't connected…"; no success claim |
| T-CONFIRM-CANCEL | Cancel at email confirm | unit + E2E | Nothing sent; final says event created, email not sent |
| T-CONFIRM-EDIT | Edit subject at confirm | unit | Edited args re-guarded and executed |
| T-RETRY | Timeout on a read → auto-retry once; on a write → read-check first | unit | Correct branches |
| T-RESUME | Reload the page while ASKING | E2E | Question re-shown from the checkpoint; the answer resumes the task |
| T-PROVENANCE | Model supplies an email not in any source | unit | Blocked → ask_user |
| T-VOICE-DENIED | Mic permission denied | manual | Typing fallback + instructions |
| T-VOICE-EMPTY | Silence / noise only | manual + unit (STT empty) | "I didn't catch that" |
| T-VOICE-FAIL | STT 5xx | unit | Error + "Type instead" |
| T-LLM-FALLBACK | Primary model 429/5xx | unit | Fallback used; logged `fallbackUsed:true` |
| T-SECRETS | Build output grep | CI/manual | 0 hits |

## 7. Final demo script (≈3 min)

1. **(0:00)** Home on a phone (or laptop), hero visible. "Check if I have any meetings between 5 and 7." → the timeline shows "Checking Google Calendar" → spoken answer.
2. **(0:25)** "Okay, schedule Rahul for 6 to 7." → the plan appears (3 steps) → "What's Rahul's email?" (or "Is that Rahul at …?") → answer by voice/typing → ConfirmSheet (event + Meet) → Confirm → ✓ with a Meet link → ConfirmSheet (email preview) → Send → ✓ SENT → "Done. Rahul's invited for tomorrow 6 to 7, Meet link's in the email." → tap "Save Rahul's email".
3. **(1:30)** "Set up a Zoom call tomorrow and make an agenda doc." → "What time?" (mic stays on) → "5 PM" → ✓ Zoom join link + ✓ Google Doc, both opened live.
4. **(2:20)** "Check my GitHub issues and tell me which need attention." (or the fallback: "Summarize what the team said about the deployment in Slack and save it to Notion.") → spoken top 3 + list card.
5. **(2:50)** Open History: three tasks with tool chips and evidence links. Close on the Apps page showing real connection status.

## 8. If time runs short (cut order)
1. The command window (⌘K) goes; Home works on desktop too.
2. The interim Web Speech transcript goes (Whisper final transcript stays).
3. Drive and Notion tools are cut from the demo but kept in Apps.
4. GitHub waits on B-01.
**Never cut**: confirmations, verification, provenance guard, honest error reporting, secret hygiene.
