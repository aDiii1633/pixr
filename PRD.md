# PRD — Voice Action Agent (working name: **Pixr**)

> Source-of-truth set: `PRD.md` · `ARCHITECTURE.md` · `AGENT_WORKFLOW.md` · `MEMORY_CONTEXT.md` · `INTEGRATIONS.md` · `UI_UX.md` · `IMPLEMENTATION_PLAN.md`.
> Any change to scope, tools, states, env vars or tables must be reflected in all seven.
> Last synced: 2026-09-25.

## 1. Vision

**"Tell me what you want. I will figure out how to do it."**

Pixr is a voice-first AI agent that turns a spoken goal into verified actions across the user's connected apps. It works out the intent and a plan, picks tools, asks only for information it's missing, and runs the work through Swytchcode. It checks each result, then gives a short spoken answer while the UI shows exactly what happened.

It is **not** a chatbot with a microphone. Its answer is an action with evidence (event ID, Meet link, issue URL, Slack permalink). It is never just a paragraph of text.

## 2. Target users

| Persona | Context | What they need |
|---|---|---|
| **Primary: the builder/operator** (hackathon owner, founder, PM, dev lead) | Juggles Calendar, Gmail, Slack, GitHub, Notion daily; often on the move (phone) or deep in work (desktop) | Hands-free cross-app actions; zero re-typing; trust that nothing is sent without their say-so |
| Secondary: hackathon judges / demo audience | Watching a 3-minute live demo | Visible proof of multi-step agentic behaviour: plan → ask → act → verify |

MVP is **single-owner** (see D-01): one person's connected accounts. The data model keeps `user_id` everywhere so the product can become multi-user later.

## 3. Core features (MVP)

| # | Feature | Acceptance criteria |
|---|---|---|
| F1 | **Voice in** | Tap/hold the orb or press Space → live listening state + level meter → transcript shown within ~1.5 s of stopping (Groq Whisper). Typing fallback always available. |
| F2 | **Intent + planning** | Agent produces a visible plan (timeline) before the first write action. Multi-tool plans are supported. |
| F3 | **Follow-up question engine** | Asks **one** question at a time, only for genuinely missing required fields. Never guesses emails/phones/IDs. |
| F4 | **Task memory** | Answers are stored in task state (LangGraph checkpoint) and the task resumes, even after a page reload. The user never repeats an answer. |
| F5 | **Tool execution via Swytchcode** | Calendar, Gmail, Drive, Meet, Docs, Sheets, Slides, Slack, Notion, GitHub, Zoom, Discord, X and OpenWeather, all through Swytchcode method definitions (kernel when connected there, otherwise the same definitions with a Pixr-held connection). |
| F6 | **Confirmation system** | High-impact actions (send email/Slack, external event, delete/cancel) show a preview with Confirm / Edit / Cancel. They are never executed silently. |
| F7 | **Verification** | Success is claimed only when the tool response carries proof (ID/URL/`ok:true`/`SENT` label). Unverified = reported as unverified. |
| F8 | **Voice out** | Short spoken summary through browser `speechSynthesis`. The on-screen text matches the spoken text. |
| F9 | **Execution timeline** | Live steps with status icons: pending, running, done, failed, needs input. |
| F10 | **Connected apps** | Real status for each integration from a live health probe. Connect/disconnect goes through the Swytchcode auth flow. |
| F11 | **Task history** | Request, time, tools used, status, result links and errors for every task. |
| F12 | **Preferences + memory** | Name, email, timezone, default meeting duration, work hours, preferred channel, confirmation preferences. Saved contacts and facts can be viewed, edited and deleted. |
| F13 | **Responsive** | Native-feeling mobile (bottom sheets, 72 px mic target) plus a desktop floating command window (Ctrl/⌘+K). |

## 4. Primary use cases (demo-grade, end-to-end)

1. **Calendar check → schedule with Meet → email invite**
   "Check if I have any meetings between 5 and 7." → reads the calendar → "Okay, schedule Rahul for 6 to 7." → asks for Rahul's email only if it isn't in memory → creates a Calendar event with a Meet link → previews the Gmail invite → the user confirms → sends it → verifies → "Done. Rahul's invited, Meet link's in the email."
2. **Zoom call + agenda doc** — "Set up a Zoom call tomorrow and make an agenda doc." The agent asks only for what's missing (the time) and keeps the mic on for the answer. It creates the Zoom meeting (join link verified) and a Google Doc with the agenda, then reads both links back.
3. **"Which GitHub issues need attention?"** — lists open issues, sorts them (bugs, stale, unassigned, high comment count) and speaks the top three. *Depends on B-01.* If GitHub is still blocked on demo day, the fallback third demo is **"Summarize what the team said about the deployment in Slack and save it to Notion"** (Slack → Notion, both verified working bundles).

Additional supported cases: Gmail search/summary/draft/send, Slack message to channel/person, Notion search/create note, Drive "find my latest X", "give me the Meet link for today's 3 PM", "move my 6 PM to 7" (Calendar update + notify).

## 5. MVP scope

**In scope:** everything in §3, the 8 named integrations (with the transport caveats in `INTEGRATIONS.md`), a single owner, a PWA-installable web app, English voice.

**Non-goals (MVP):**
- Multi-tenant SaaS with per-user OAuth (architecture allows it later; see D-01).
- Wake word / always-on listening; background agents; scheduled or proactive tasks.
- Native iOS/Android binaries (PWA only).
- Languages other than English for voice.
- Attachments and file uploads in emails; Drive file editing; GitHub PR review/merge.
- Autonomous destructive actions of any kind. Bulk deletes are not exposed as tools at all.
- A vector database / semantic long-term memory (deterministic retrieval is enough at MVP scale; see `MEMORY_CONTEXT.md`).

## 6. Success criteria (definition of done)

Taken from the master brief §45 and made testable (test IDs refer to `IMPLEMENTATION_PLAN.md` §9):

- [ ] Speak naturally → transcript → intent (T-VOICE-*)
- [ ] A multi-step plan is shown and executed (T-MULTI-*)
- [ ] Follow-up questions are asked one at a time; answers are retained across turns and a page reload (T-MISSING-*, T-RESUME-*)
- [ ] ≥3 Swytchcode integrations used meaningfully (Calendar, Gmail, Slack, Notion, Drive; GitHub when unblocked)
- [ ] Real actions with verification evidence; zero hard-coded success paths (grep audit in Phase 9)
- [ ] Confirmation required for sensitive actions; cancel and edit both work (T-CONFIRM-*)
- [ ] Voice response; UI reflects all 9 UI states (the brief's 8 agent states + SPEAKING, UI_UX §5)
- [ ] Mobile (375 px) and desktop (1440 px) layouts pass the UI checklist
- [ ] Integration status is real (live probe) and the connect flow works
- [ ] Error states are human-friendly (no raw `HTTP 401`)
- [ ] No secrets in client bundles (build-output grep in Phase 9)
- [ ] ≥3 complete end-to-end workflows demoed live
- [ ] Deployable (Docker image builds and runs with `.env`)

## 7. Metrics (demo + dogfooding)

| Metric | Target |
|---|---|
| Voice stop → first status update on screen | < 1.5 s |
| Read-only task end-to-end (e.g. calendar check) | < 5 s p50 |
| Follow-up questions per task (Demo 1, email unknown) | exactly 1 |
| Tasks that claim success without evidence | 0 |
| High-impact actions executed without confirmation | 0 |

## 8. Decisions log

`DECISION REQUIRED` items are consolidated in `IMPLEMENTATION_PLAN.md` §2. Decisions already made are recorded in `ARCHITECTURE.md` §1.
