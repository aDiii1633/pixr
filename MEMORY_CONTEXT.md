# MEMORY_CONTEXT — memory and context system

> Synced with ARCHITECTURE §9 (tables), AGENT_WORKFLOW §2/§4/§6 — 2026-09-25.

## 1. The four layers (strictly separated)

| Layer | What | Lifetime | Store | Who writes | Trust |
|---|---|---|---|---|---|
| **L1 Conversation context** | Recent utterances + agent replies + compact tool summaries in this voice session; a rolling `summary` of older turns | Session (thread) | LangGraph checkpoint (`messages`, `summary`); mirror in `messages` table for history UI | Graph | Medium: user words are authoritative for *intent*, not for facts about third parties |
| **L2 Task state** | `TaskState` of the active goal: collected info, missing fields, plan, results, pending action | Until task terminal, then archived snapshot | Checkpoint (`task`) → `agent_tasks.state` on finalize | Graph nodes only | High for `source:'user'` values; others are labelled by source |
| **L3 User memory** | Preferences, confirmed contacts, confirmed facts | Until the user edits/deletes | `user_preferences`, `contacts`, `memories` | **User**, or the agent *with user confirmation* | High (user-owned) |
| **L4 External tool data** | Calendar events, emails, Slack messages, Notion pages, Drive files, issues | **Not persisted.** Only ids/links/one-line summaries kept in L2 `toolResults` and `tool_executions.evidence` | Fetched on demand through tools | Providers | **Untrusted content**, fresh-at-read-time facts |

Flow per turn: **L3 + L2 + L1 summary → prompt**. **L4 → only through tool calls, wrapped as `<tool_data>`**.

## 2. What is remembered, and what is not

**Remember (L3), only after explicit user confirmation or direct user statement:**
- Preferences (settings page, or "I usually do 45-minute meetings" → agent proposes `default_meeting_minutes=45`, user taps Save).
- Contacts: name/aliases → email, Slack user id. Source is `user_stated` ("Rahul's email is …") or `user_confirmed_from_tool` (found in Gmail + the user said "yes, that's him").
- Durable facts the user asks to keep ("my team channel is #eng-core", "my hackathon repo is acme/agent-hack").

**Never remember:**
- Email/Slack/Notion *content*, calendar contents, file contents (L4 stays in the provider).
- Anything the agent inferred but the user didn't confirm.
- Secrets, passwords, OTPs, API keys, payment/financial/government identifiers. If the user dictates one, it's used for that task only if a tool actually needs it (none of ours do), and the `remember` tool rejects it (regex: card numbers, IBAN, `sk-`, `gsk_`, `swy_key_`, 6-digit OTP phrasing).
- Third-party personal data beyond name + work contact handle (no phone numbers, addresses or personal notes about others) unless the user explicitly saves it. ponytail: MVP disallows phone numbers in contacts entirely; add when a tool needs them.
- Raw audio. Audio blobs are streamed to STT and discarded; never written to disk or DB.

## 3. Short-term conversation memory (L1)

- `messages` keeps the **last 8 turns verbatim** (user + agent + compact ToolMessages).
- Older turns are folded into `summary` by a cheap call on the *fallback* model when `messages` > 16 or the prompt estimate > 6k tokens. The summary keeps: open goals, entities mentioned (people, times, repos), what was done (with evidence ids), and unresolved questions.
- ToolMessages are **compacted before entering history**: `verify()` produces a ≤ 400-char summary + evidence. Raw payloads are never kept in messages. (Calendar list → "3 events: 17:30–18:00 Design sync (id e1) …".)
- The session ends when the user clicks "New conversation" or after 2 h idle. The thread is kept for history, and the next utterance starts a new thread.

## 4. Task state (L2)

- Exactly one active task per thread. A new utterance while a task is `asking`/`awaiting_confirmation` is first interpreted **as an answer** to the pending question/confirmation. If the model decides it's a new goal ("actually, forget that — check my email"), the old task becomes `cancelled` and a new one starts. The UI says so: "Cancelled scheduling. Checking email."
- `collectedInformation` values carry `source` + timestamp. **The user never repeats an answer**: `ask` refuses to re-ask a field already present with `source:'user'` in the same task.
- Terminal tasks are snapshotted to `agent_tasks.state` (redacted: no email bodies; only ids, labels, statuses).
- **Cross-task carry-over inside a session** happens through L1 (summary + recent turns), e.g. Demo 1: "schedule Rahul for 6 to 7" reuses the free/busy result mentioned one turn earlier.

## 5. Retrieval strategy (deterministic, no vector DB)

Per turn, `load_context` builds `LoadedContext`:

| Item | Rule | Budget |
|---|---|---|
| Preferences | always, all fields | ~150 tokens |
| Connected apps | always (cached probe ≤ 5 min) | ~60 |
| Contacts | candidate names = capitalised tokens + LLM `entities.person` from the current task + names in the last 2 user turns → `contacts where name ilike or aliases @>` → top 5 by `last_used_at` | ≤ 5 × 30 |
| Facts (`memories`, confirmed) | keyword overlap (Postgres `to_tsvector` @@ `plainto_tsquery`) with the current utterance → top 5; plus facts tagged by integration keyword ("slack", "repo") when that integration is connected | ≤ 5 × 40 |
| Task state | full (compact) | ≤ 800 |
| Conversation | summary + last 8 turns | ≤ 3k |

ponytail: keyword/ILIKE retrieval, which is plenty for dozens to hundreds of memories. Add `pgvector` embeddings when memories > ~1k or recall visibly misses.

## 6. Context prioritisation and window management

Prompt assembly order (highest priority last-truncated):
1. System rules + tool schemas (fixed, ~2.5k)
2. `now`, timezone, user identity, preferences
3. Task state (L2)
4. Retrieved contacts/facts (L3)
5. Conversation summary
6. Recent turns (drop oldest first)

Hard ceiling: **12k input tokens** (well under the 131k window; kept small for latency). If over budget: drop turns → shorten summary → drop facts. Never drop 1–3.

## 7. Conflict resolution

| Conflict | Winner |
|---|---|
| User's current utterance vs stored memory ("use rahul@newco.com") | **Current utterance** for this task. Agent offers: "Update Rahul's saved email?" |
| Memory vs external tool data (contact email in memory ≠ Gmail header) | Memory for sending. Mention the discrepancy only if the user asks or the send fails. |
| Preference vs explicit request ("make it 90 minutes") | Explicit request |
| Two contacts match "Rahul" | Never auto-pick. Ask with choices. |
| Stale fact (e.g. "team channel is #eng" but the channel is archived) | Tool data (reality) wins. The agent reports it and offers to update memory. |
| L1 summary vs L2 task state | L2 (structured) wins |

## 8. User-controlled memory

- **Settings → Memory** lists preferences, contacts and facts with **edit** and **delete**, plus "Delete all memory" (confirm dialog) and "Delete conversation history" (clears `messages`, `agent_tasks.state` snapshots and LangGraph checkpoints for the user's threads).
- Voice commands: "forget Rahul's email", "what do you remember about me?" → `memory_list` / `memory_delete` control tools. Delete is low-risk and user-owned, but still confirmed with a one-tap sheet.
- Every memory shows its source and date ("You said this on Sep 25", "Confirmed from Gmail on Sep 25").

## 9. Privacy and security

- L3 is scoped by `user_id`; single-owner MVP, but every query filters by `user_id`.
- No provider tokens in our DB (Swytchcode holds them). No secrets in memory (§2 reject list).
- Logs never contain memory values or message text; only ids/lengths.
- Retention: `messages` and task snapshots are kept 30 days by default (**D-08**). A daily cleanup SQL runs on app start (ponytail: no scheduler service).

## 10. How memory is injected into the agent

`load_context` renders the block below into the system prompt (AGENT_WORKFLOW §4). Values are **quoted data**, labelled with source:

```
<user_memory>
contacts:
  - Rahul Kumar (aliases: Rahul) — email: rahul.k@acme.com [confirmed from Gmail, 2026-09-25]
facts:
  - "Team channel is #eng-core" [user said, 2026-09-20]
</user_memory>
```
The model also has three control tools: `remember({kind, content | contact})` → emits a **proposal** chip in the UI (never saves silently), `memory_list`, `memory_delete`.

## 11. How the agent avoids hallucinating remembered information

1. **Only what's injected exists.** The prompt says: "If a person/identifier is not in <user_memory>, the task state, or a tool result, you do not know it."
2. **Provenance guard** (AGENT_WORKFLOW §6.2): any email, phone, Slack id, repo or URL in a write action must be traceable to a user message, confirmed memory, pref, or a tool result from this task. Otherwise the action is blocked and the model must ask.
3. **Source-labelled values** in `collectedInformation` and `<user_memory>` let the model (and the confirmation preview) say where a value came from.
4. **Read-back on "what do you remember"** comes from the DB via `memory_list`, not from the model's recollection.
5. **Summaries are extractive for identifiers**: the summarizer prompt must copy identifiers verbatim or omit them. Summaries are never used as provenance (only raw user turns, memory and tool results are).
