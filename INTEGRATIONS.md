# INTEGRATIONS — verified capability map

> Synced with ARCHITECTURE §1/§8, AGENT_WORKFLOW §6/§8/§9 — 2026-09-25.
> **Evidence method.** Every canonical ID and field below was read from the real Swytchcode bundles, not from memory. Swytchcode CLI `2.20.4`, logged in as the owner, probe project in a scratch dir. Commands used: `swy search --json --all` (352 integrations), `swy get "<Project>"`, `.swytchcode/integrations/**/methods.json`, `swy info <id> --json`. Items marked **UNVERIFIED** must be proven in Phase 0 before they are built on.

## ⚡ Update after build (2026-09-25, CLI 2.23.5): supersedes the rows below where they differ
- **Google Meet is in the registry** (`Google Meet.meet@2.0`; the first search was a stale cache). Tool: `google_meet.space.create` → `meetingUri`. Meet links for events still come from Calendar `conferenceData`.
- **GitHub bundle fetched** (`GitHub.github@1.1.4`, 1,204 methods) after the 4th `swytchcode bootstrap` retry. The earlier failures were client timeouts on a very large bundle. Tools: `github.repo.list`, `github.issue.get1` (list repo issues), `github.issue.get2`, `github.issue.create`, `github.issue.comments.create`, `github.user.list1` (probe). **B-01 is resolved.**
- **All 8 integrations now run through Swytchcode.** Drive tools were added from `Google Drive@drive.v3`; the list endpoint still takes v2-style params (`maxResults`, `title contains`), with a v3 fallback in code.
- Status table format of `swytchcode auth status`: `PROVIDER ACCOUNT TYPE TIER STATUS` (slugs such as `google-calendar`). The project uses workspace `swytchcode`.
- **Swytchcode hosted sign-in is broken (2026-09-25):** `auth.swytchcode.com` serves a Vite *dev* server (`/@vite/client` 27 s, `/@react-refresh` 49 s per module), so the OAuth page stays blank. In CLI 2.23.5, `exec` accepts **only** credentials from that managed flow: env vars (`GITHUB_TOKEN`, `SLACK_BOT_TOKEN`, `NOTION_API_KEY`, `GMAIL_API_KEY` show as "env var" in `whoami`), a `~/.swytchcode/credentials` file, and a per-call `Authorization` are all ignored by `exec` (tested).
- **Pixr connections (fallback):** `/apps` connects Google (own OAuth client → Calendar/Gmail/Drive/Meet/Docs/Sheets/Slides in one consent), Zoom (Server-to-Server OAuth credentials) and Slack/Notion/GitHub/Discord/X/OpenWeather (token paste). Each is validated live and stored AES-256-GCM encrypted (`lib/creds.ts`). `exec()` tries the Swytchcode kernel first; on "missing credentials" it runs the **same Swytchcode method definition** (`swytchcode info` → `http_method`, `endpoint`, input locations + manifest `production_endpoint`) directly with the Pixr token (`lib/direct.ts`). The Apps page shows "via Swytchcode" or "connected in Pixr".
- `exec` errors: log lines + one JSON line on stderr, e.g. `{"error":"missing credentials for Gmail - run ...","category":"auth",...}`, exit code 3.

## 0. Summary

| Integration | In Swytchcode registry? | Bundle fetched? | Transport | Status |
|---|---|---|---|---|
| Google Calendar | ✅ `Google Calendar` | ✅ `calendar@v3` (38 methods) | swytchcode | Ready (needs `swy auth connect`) |
| Gmail | ✅ `Gmail` | ✅ `gmail@v1` (95 methods; + postmaster bundles, unused) | swytchcode | Ready, **send content-type risk (G-R1)** |
| Slack | ✅ `Slack` | ✅ `slack@1.7.0` (174 methods) | swytchcode | Ready, **search needs user token (S-R1)** |
| Notion | ✅ `Notion` | ✅ `notion@2.0.0` (24 methods) | swytchcode | Ready (first fetch attempt errored, second succeeded) |
| Google Drive | ✅ `Google Drive` | ✅ `drive@v3` (+v2, activity, labels) | swytchcode | Ready, **endpoint version risk (D-R1)** |
| GitHub | ✅ `GitHub` listed | ❌ `swy get github` fails 3×: `SWY-ERR-AB06DD`, `SWY-ERR-A7F07D`, `SWY-ERR-F2F877` | swytchcode | **BLOCKED (B-01)** |
| Google Meet | ❌ not in registry (searched "google meet", "meet", "video conference"; full list has Zoom but no Meet) | – | **via Google Calendar conferencing** | Ready (real Meet links through `conferenceData`) |
| Zoom · Discord · Google Docs · Google Sheets · Google Slides · X.com · OpenWeather | ✅ | ✅ (Zoom after retries) | swytchcode | See §9 |

**Common to all Swytchcode bundles** (from `.swytchcode/integrations/manifest.json`): `auth.type: oauth2`, `execution_policy: {max_retries: 3, base_delay_ms: 500, retry_on: [429,503,504], non_retryable: [400,401,403,404,422], on_401: "fail", http_timeout_ms: 30000, total_timeout_ms: 90000, max_concurrent: 5, max_response_bytes: 102400, idempotency.mode: "none"}`.
- ⚠ `max_response_bytes: 102400` (100 KB). Large list responses (Gmail full messages, Drive lists, Slack history) must request **small pages / partial fields** (`maxResults`, `fields`, `format=metadata`, `limit`) or they may be truncated/fail. Every read tool below sets these.
- Connect: `swy auth connect "<Project>"` (browser OAuth on the host), status `swy auth status`, disconnect `swy auth disconnect "<Project>"`. **One connected account per provider per workspace.**
- Errors from `swytchcode exec` arrive as JSON on stderr: `{error, category, retryable, suggested_action, docs_url}` (from `@swytchcode/runtime` `parseClassifiedError`).

## 1. Capability layer contract

Every agent tool is a `ToolDefinition`:

```ts
interface ToolDefinition<I, O> {
  name: string;                       // LLM-facing, snake_case, ≤ 64 chars
  integration: 'calendar'|'gmail'|'slack'|'notion'|'drive'|'meet'|'github'|'zoom'|'discord'|'docs'|'sheets'|'slides'|'x'|'weather';
  transport: 'swytchcode' | 'direct';
  canonicalId?: string;               // exact Swytchcode id (swytchcode transport)
  description: string;                // one-line capability for tool selection
  input: ZodType<I>;                  // SMALL schema, LLM-facing
  risk: 'read'|'low'|'high' | ((args: I) => 'read'|'low'|'high');
  toRequest(args: I, ctx): { body?: unknown; params?: Record<string,string>; headers?: Record<string,string> };
  verify(res: unknown, args: I): { verified: boolean; summary: string; evidence?: { id?: string; url?: string } };
  preview?(args: I): Record<string,string>;   // confirmation card rows
}
```
To add a new Swytchcode integration: `swy get <Project>` → `swy add <id>` (tooling.json) → a `lib/tools/<app>.ts` file with definitions. No other change.

---

## 2. Google Calendar (`Google Calendar.calendar@v3`, base `https://www.googleapis.com/calendar/v3`)

| Agent tool | Canonical ID | HTTP | Key inputs (location) | Risk |
|---|---|---|---|---|
| `calendar_find_events` | `calendar.event.get` | GET `/calendars/{calendarId}/events` | `calendarId`(path, req; `primary`), `timeMin`, `timeMax`, `singleEvents=true`, `orderBy=startTime`, `q`, `maxResults≤25`, `timeZone` (query) | read |
| `calendar_free_busy` | `calendar.freebusy.create` | POST `/freeBusy` | body `{timeMin, timeMax, timeZone, items:[{id}]}` | read |
| `calendar_get_event` | `calendar.event.get1` | GET event by id | `calendarId`, `eventId` | read |
| `calendar_create_event` | `calendar.event.create` | POST `/calendars/{calendarId}/events` | `calendarId`; query `conferenceDataVersion` (0–1), `sendUpdates` (`all`/`externalOnly`/`none`); body `summary, description, location, start{dateTime,timeZone}, end{…}, attendees[{email,displayName}], conferenceData.createRequest{requestId, conferenceSolutionKey{type}}, extendedProperties.private` | low (no attendees) / **high** (attendees) |
| `calendar_update_event` | `calendar.event.update` | PATCH `/calendars/{calendarId}/events/{eventId}` | same body subset + `conferenceDataVersion`, `sendUpdates` | **high** |
| `calendar_cancel_event` | `calendar.event.delete` | DELETE event | `calendarId`, `eventId`, `sendUpdates` | **high** |
| (health probe) | `calendar.me.calendarList.get` | GET calendarList/primary | `calendarId=primary` | read |

- **Meet creation**: `conferenceDataVersion=1` + `body.conferenceData.createRequest = { requestId: <actionId>, conferenceSolutionKey: { type: "hangoutsMeet" } }`. Output fields present in schema: `hangoutLink`, `conferenceData.entryPoints[].uri`, `conferenceData.createRequest.status.statusCode`.
- Scopes (from wrekenfile `SECURITY`): read `calendar.readonly` / `calendar.events.readonly`; write `calendar` or `calendar.events`. Actual granted scopes depend on Swytchcode's OAuth app (**UNVERIFIED P0-7**).
- Error cases: 401 expired → reconnect; 403 `insufficientPermissions`; 404 wrong `eventId`; 409 duplicate `id`; 400 invalid time range; Meet `createRequest.status=pending|failure`.
- Agent use cases: availability checks, schedule with/without Meet, reschedule, cancel, "Meet link for today's 3 PM" (find → read `hangoutLink`), "add a Meet to my 6 PM" (update with `conferenceDataVersion=1`).

## 3. Google Meet (via Calendar)

| Capability | How | Verified output |
|---|---|---|
| Create Meet for new meeting | `calendar_create_event({createMeet:true})` | `hangoutLink` |
| Add Meet to an existing event | `calendar_update_event({eventId, createMeet:true})` | `hangoutLink` |
| Get Meet link of an event | `calendar_find_events` / `calendar_get_event` | `hangoutLink` / `conferenceData.entryPoints[type=video].uri` |

**Not available** (no Swytchcode integration): standalone Meet spaces, recordings, transcripts, participants. The UI labels the capability "Google Meet (via Calendar)".

## 4. Gmail (`Gmail.gmail@v1`, base `https://gmail.googleapis.com/`)

| Agent tool | Canonical ID | HTTP | Key inputs | Risk |
|---|---|---|---|---|
| `gmail_search` | `gmail.user.messages.get` | GET `/gmail/v1/users/{userId}/messages` | `userId=me`(path), `q` (Gmail search syntax), `maxResults≤10`, `labelIds` | read |
| `gmail_read_message` | `gmail.user.messages.get1` | GET `…/messages/{id}` | `id`, `format=metadata` + `metadataHeaders=[From,To,Subject,Date]` for lists; `format=full` for one message (body trimmed to 4 KB) | read |
| `gmail_read_thread` | `gmail.user.threads.get1` | GET `…/threads/{id}` | `id`, `format=metadata` | read |
| `gmail_create_draft` | `gmail.user.drafts.create` | POST `…/drafts` | body `{message:{raw}}` | low |
| `gmail_send` | `gmail.user.send.create1` | POST `…/messages/send` | body `{raw}` = base64url RFC 2822 (`To`, `Subject`, `Content-Type: text/plain; charset=UTF-8`), optional `threadId` | **high** |
| `gmail_send_draft` | `gmail.user.send.create` | POST `…/drafts/send` | body `{id}` | **high** |
| (health / identity) | `gmail.user.profile.get` | GET `…/profile` | `userId=me` → `emailAddress` | read |

- The **`raw` MIME encoding is done in `toRequest`** (the LLM supplies `to[], cc[], subject, bodyText`), so the model never hand-writes base64.
- ⚠ **G-R1 (UNVERIFIED)**: the wrekenfile declares `CONTENT_TYPE: message/cpim` for `send.create1`, `send.create` and `drafts.create`. Google expects `application/json` for this JSON body. Phase 0: `swy exec gmail.user.send.create1 --dry-run` to see the header actually sent, then a real send to self. If broken: pass `headers: {"Content-Type":"application/json"}` in exec args (`ExecArgs.headers` is supported) or report to Swytchcode.
- Scopes: send `gmail.send`; read `gmail.readonly`/`gmail.metadata`.
- Errors: 400 `Invalid To header` (bad email) → ask the user; 401 → reconnect; 403 `insufficientPermissions`; 429 per-user rate limit.
- Use cases: find the person's email (headers of recent threads, **user must confirm**), summarize the inbox or a thread, draft, send invites/updates.
- Never exposed: `messages.delete`, `batchDelete`, `threads.delete`, filters, forwarding, delegates, `sendAs` (also BLOCKed in `policies.json`).

## 5. Slack (`Slack.slack@1.7.0`, base `https://slack.com/api`)

| Agent tool | Canonical ID | Key inputs | Risk |
|---|---|---|---|
| `slack_list_channels` | `slack.conversations.list.list` | `types=public_channel,private_channel`, `exclude_archived=true`, `limit≤200` (query) | read |
| `slack_channel_history` | `slack.conversations.history.list` | `channel`, `limit≤30`, `oldest` | read |
| `slack_thread_replies` | `slack.conversations.reply.list` | `channel`, `ts` | read |
| `slack_search_messages` | `slack.search.message.list` | `query` (req), `count≤20`, `sort=timestamp` | read |
| `slack_find_user` | `slack.users.lookupbyemail.list` / `slack.users.list.list` | `email` / `limit` | read |
| `slack_open_dm` | `slack.conversations.open.create` | body `users` | low |
| `slack_send_message` | `slack.chat.postmessage.create` | body `{channel, text, thread_ts?}` | **high** |
| `slack_get_permalink` | `slack.chat.getpermalink.list` | `channel`, `message_ts` | read |
| (health) | `slack.auth.test.list` | – | read |

- `token` appears as a required input (`header`/`query`) in the wrekenfile. **UNVERIFIED P0-8**: confirm the kernel injects the managed OAuth token (expected) so we never pass it.
- ⚠ **S-R1**: Slack's `search.messages` works only with a **user** token (`search:read`). If Swytchcode's Slack connection is a bot token, `slack_search_messages` returns `not_allowed_token_type`. The fallback is `conversations.history` on the target channel. Verify in Phase 0.
- Errors (HTTP 200 with `ok:false`): `channel_not_found`, `not_in_channel` (bot must join → `slack.conversations.join.create`, low risk, public channels only), `invalid_auth`/`token_revoked` → reconnect, `ratelimited`.
- Use cases: "tell the team deployment is delayed 2h" (channel from `prefs.default_slack_channel` or ask with choices from `slack_list_channels`), DM a person, summarize a channel/thread.

## 6. Notion (`Notion.notion@2.0.0`, base `https://api.notion.com`)

| Agent tool | Canonical ID | Key inputs | Risk |
|---|---|---|---|
| `notion_search` | `notion.search.create` | header `Notion-Version`; body `{query, filter:{property:'object', value:'page'}, page_size≤10}` | read |
| `notion_read_page` | `notion.markdown.get` | `page_id` → enhanced Markdown (trim 6 KB) | read |
| `notion_get_page` | `notion.page.get` | `page_id` | read |
| `notion_create_page` | `notion.page.create` | body `{parent:{page_id}\|{data_source_id}, properties:{title}, children?}` | low |
| `notion_append` | `notion.children.update` | `block_id`, body `{children:[…]}` | low |
| `notion_update_markdown` | `notion.markdown.update` | `page_id`, header `Notion-Version`(req), body `{type, insert_content\|replace_content…}` | low (append) / **high** (replace) |
| (health) | `notion.me.list` | – | read |

- `Notion-Version` is a header input. **UNVERIFIED P0-9**: which version string the bundle expects (the markdown endpoints are recent API additions).
- Parent resolution: `prefs.default_notion_parent`, else `notion_search` → choose → ask to confirm. Notion integrations only see pages **shared with the integration**, so empty search results are explained as such.
- Errors: `object_not_found` (not shared with integration), `validation_error`, `restricted_resource`, 401.
- Use cases: "save this as my hackathon idea" (create a page under the parent with the content of the current conversation/task), search notes, read a doc and summarize it.

## 7. Google Drive (`Google Drive.drive@v3` bundle)

| Agent tool | Canonical ID | Key inputs | Risk |
|---|---|---|---|
| `drive_search_files` | `drive.file.list` | `q` (e.g. `name contains 'hackathon' and mimeType='application/vnd.google-apps.presentation' and trashed=false`), `orderBy=modifiedTime desc`, `fields`, page size ≤ 10 | read |
| `drive_get_file` | `drive.file.get` | `fileId`, `fields=id,name,mimeType,modifiedTime,webViewLink,owners` | read |
| (health) | `drive.about.list` | `fields=user` | read |

- ⚠ **D-R1 (UNVERIFIED)**: `manifest.json` lists `production_endpoint: https://www.googleapis.com/drive/v2` for `Google Drive.drive` even though the `v3` bundle was fetched. `drive.file.list` exposes v2-style params (`maxResults`, `corpus`) *and* v3 ones (`corpora`, `driveId`). v2 names the field `title`, v3 `name`. Phase 0 must run one real `drive.file.list` and pin the query syntax/fields to whatever the endpoint actually is.
- Scope: `drive.metadata.readonly` is enough (metadata + `webViewLink`). File content download/export is **not** in MVP.
- Errors: 400 invalid `q`, 403 `insufficientFilePermissions`, 401.
- Use cases: "find my latest hackathon presentation" → search → newest → link card; "share the deck link with Rahul" = Drive search + Gmail send (multi-tool).

## 8. GitHub — BLOCKED (B-01)

- The registry lists `GitHub`, but `swy get github` / `swy get "GitHub"` fail with `× Failed to fetch integration bundles` (reference IDs above). `swy doctor` is healthy and the other bundles fetch, so it's a registry-side issue or a CLI-version issue. The CLI reports `update available: 2.20.4 -> v2.23.5`.
- Canonical IDs **cannot be documented yet**. Swytchcode's own docs are inconsistent (`github.issues.create` in the CLI quickstart, `github.issue.create` in the JS SDK page, `github.pull_requests.list` in the LangGraph page). Per the no-invention rule, **no GitHub tool is defined until the bundle is inspected.**
- Planned tools (names only; IDs to be filled from `methods.json`): `github_list_repos` (read), `github_list_issues` (read), `github_get_issue` (read), `github_create_issue` (**high**), `github_comment_issue` (**high**).
- Unblock steps: P0-1 (upgrade CLI, retry), P0-2 (contact Swytchcode support with the reference IDs). If still blocked: **D-04**.

## 9. Added integrations (Swytchcode registry, fetched 2026-09-25)

| Integration | Bundle / base | Auth (Pixr connection) | Agent tools → canonical IDs | Risk |
|---|---|---|---|---|
| Zoom | `Zoom.zoom@v2`, `https://api.zoom.us/v2` | Server-to-Server OAuth (Account ID, Client ID, secret) → 1-hour token minted on demand | `zoom_list_meetings` → `zoom.meeting.get3` (`/users/me/meetings`); `zoom_create_meeting` → `zoom.meeting.create`; probe `zoom.user.get` | read / low |
| Discord | `Discord.discord@v1`, `https://discord.com/api/v10` | Bot token (`Authorization: Bot …`) | `discord_list_servers` → `discord.me.guilds.list`; `discord_list_channels` → `discord.channel.get1`; `discord_read_channel` → `discord.message.get`; `discord_send_message` → `discord.message.create`; probe `discord.me.list2` | read / **high** |
| Google Docs | `Google Docs.docs@1.0.0` | Google sign-in (`documents`) | `docs_create` → `google_docs.document.create` (+ `documentidbatchupdate.create` insertText); `docs_read` → `google_docs.document.get`; `docs_append` → batchUpdate `endOfSegmentLocation` | low / read |
| Google Sheets | `Google Sheets.sheets@4.0.0` | Google sign-in (`spreadsheets`) | `sheets_create` → `google_sheets.spreadsheet.create`; `sheets_read` → `google_sheets.value.get`; `sheets_append` → `google_sheets.value.rangeappend.create` (`USER_ENTERED`) | low / read |
| Google Slides | `Google Slides.slides@1.0.0` | Google sign-in (`presentations`) | `slides_create` → `google_slides.presentation.create`; `slides_read` → `google_slides.presentation.get` (endpoint uses `{+presentationId}`); `slides_add_slide` → `google_slides.presentationidbatchupdate.create` (createSlide TITLE_AND_BODY + insertText) | low / read |
| X.com | `X.com.x@2`, `https://api.x.com` | OAuth 2.0 user access token (Bearer) | `x_search_recent` → `x_v2.tweet.recent.list1` (needs an X plan with search); `x_post` → `x_v2.tweet.create`; probe `x_v2.user.me.list` | read / **high** |
| OpenWeather | `OpenWeather.openweather@2.0.0`, `https://api.openweathermap.org` | API key as `appid` query param | `weather_now` → `openweather.2.5.weather.list`; `weather_forecast` → `openweather.2.5.forecast.list` | read |

- **OpenWeather has no geocoding method in the bundle**; both tools require `lat`/`lon`. The model passes the well-known coordinates of the named place, and the result includes OpenWeather's resolved place name (`resolved_place`), so a wrong location is visible rather than silent.
- **Zoom** `start_url` carries a host token and is never shown or logged; only `join_url` is surfaced.
- Docs/Sheets/Slides share the single Google consent (scopes in `lib/creds.ts` `GOOGLE_APP_SCOPES`). An app is marked connected only if its scopes were actually granted.

## 10. Multi-tool workflows (all built only from tools above)

| Workflow | Chain | Confirmations |
|---|---|---|
| **W1 Schedule + Meet + invite** (Demo 1) | `calendar_find_events`/`calendar_free_busy` → (`gmail_search` for contact, user confirms) or `ask_user` → `calendar_create_event{createMeet}` → `gmail_send` | event (high: external attendee) + email (high). Merge is an option (D-07). |
| **W2 Zoom + agenda doc** (Demo 2) | `ask_user` (time) → `zoom_create_meeting` → `docs_create` (agenda with the join link) | 0 (both low risk) |
| **W3 GitHub triage** (Demo 3, after B-01) | `github_list_issues` → LLM ranking → optional `slack_send_message` summary | 0 (read) / 1 if posting |
| **W3-fallback Slack → Notion digest** | `slack_search_messages` or `slack_channel_history` → LLM summary → `notion_create_page` | 0–1 (low) |
| W4 Reschedule + notify | `calendar_find_events` → `calendar_update_event{sendUpdates:'none'}` → `slack_send_message` or `gmail_send` (preferred channel) | 2 |
| W5 Share a file | `drive_search_files` → `gmail_send` / `slack_send_message` with `webViewLink` | 1 |
| W6 Meeting prep | `calendar_find_events` (next meeting) → `gmail_search` (attendee threads) → `notion_search` → spoken brief | 0 |

## 11. `tooling.json` allowlist (target)

All canonical IDs in §2–§7 plus health probes. **Nothing else.** `policies.json` BLOCK list: `gmail.user.messages.delete`, `gmail.user.batchDelete.create`, `gmail.user.threads.delete`, `drive.file.delete`, `drive.file.trash.delete`, `drive.drive.delete`, `slack.chat.delete.create`, `notion.block.delete`, `calendar.calendar.delete`, `calendar.clear.create`. Exact `policies.json` syntax is to be written with `swy policy add` in Phase 3 (schema at docs.swytchcode.com/configuration/policy-json).
