import { z } from "zod";
import { exec, ToolError } from "./swytchcode";
import type { Prefs } from "./db";

// ---------------------------------------------------------------------------
// Capability layer: small LLM-facing schemas mapped onto exact Swytchcode
// canonical IDs (verified in INTEGRATIONS.md). Every write returns `verified`
// computed from real response fields — never assumed.
// ---------------------------------------------------------------------------

export type Risk = "read" | "low" | "high";
export type IntegrationId = "calendar" | "gmail" | "slack" | "notion" | "drive" | "meet" | "github" | "zoom" | "discord" | "docs" | "sheets" | "slides" | "x" | "weather";

export const INTEGRATIONS: Record<IntegrationId, { name: string; provider: string; blurb: string }> = {
  calendar: { name: "Google Calendar", provider: "Google Calendar", blurb: "Read and create events" },
  meet: { name: "Google Meet", provider: "Google Meet", blurb: "Create meeting spaces" },
  gmail: { name: "Gmail", provider: "Gmail", blurb: "Search, draft and send email" },
  slack: { name: "Slack", provider: "Slack", blurb: "Read channels and send messages" },
  notion: { name: "Notion", provider: "Notion", blurb: "Search and create pages" },
  drive: { name: "Google Drive", provider: "Google Drive", blurb: "Find files and links" },
  github: { name: "GitHub", provider: "GitHub", blurb: "Issues and repositories" },
  docs: { name: "Google Docs", provider: "Google Docs", blurb: "Create, read and append docs" },
  sheets: { name: "Google Sheets", provider: "Google Sheets", blurb: "Create sheets, read and add rows" },
  slides: { name: "Google Slides", provider: "Google Slides", blurb: "Create decks and add slides" },
  zoom: { name: "Zoom", provider: "Zoom", blurb: "Schedule and list meetings" },
  discord: { name: "Discord", provider: "Discord", blurb: "Read channels and post messages" },
  x: { name: "X", provider: "X.com", blurb: "Search and publish posts" },
  weather: { name: "OpenWeather", provider: "OpenWeather", blurb: "Current weather and forecasts" },
};

export interface Ctx { prefs: Prefs; timezone: string; actionId: string }
export interface Link { label: string; url: string }
export interface ToolResult { verified: boolean; summary: string; evidence?: { id?: string; links?: Link[] }; data?: unknown }
export interface Preview { title: string; verb: string; rows: [string, string][] }

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  integration: IntegrationId;
  description: string;
  input: S;
  risk: Risk | ((a: z.infer<S>) => Risk);
  label: (a: z.infer<S>) => string;
  preview?: (a: z.infer<S>, ctx: Ctx) => Preview;
  run: (a: z.infer<S>, ctx: Ctx) => Promise<ToolResult>;
}

const def = <S extends z.ZodType>(d: ToolDef<S>) => d as unknown as ToolDef;

// ---------------------------------------------------------------- time utils
const HAS_OFFSET = /(Z|[+-]\d\d:?\d\d)$/i;

function tzOffsetMs(utcMs: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utcMs;
}

/** "2026-09-25T18:00" in `tz` → UTC ISO string. Strings that carry an offset are taken as-is. */
export function toUtc(local: string, tz: string): string {
  if (HAS_OFFSET.test(local)) return new Date(local).toISOString();
  const [d, t = "00:00"] = local.split("T");
  const [Y, M, D] = d.split("-").map(Number);
  const [h, m, s = 0] = t.split(":").map((x) => Number(x));
  const guess = Date.UTC(Y, M - 1, D, h, m, Math.floor(s));
  let utc = guess - tzOffsetMs(guess, tz);
  const second = guess - tzOffsetMs(utc, tz);
  if (second !== utc) utc = second; // DST edge
  if (Number.isNaN(utc)) throw new ToolError("validation", `"${local}" isn't a valid date/time.`);
  return new Date(utc).toISOString();
}

/** UTC → "2026-09-25T18:00:00" wall time in tz (what Google wants alongside timeZone). */
export function toLocal(utcIso: string, tz: string) {
  const ms = Date.parse(utcIso);
  return new Date(ms + tzOffsetMs(ms, tz)).toISOString().slice(0, 19);
}

export const fmt = (iso: string | undefined, tz: string) =>
  iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "";
const fmtTime = (iso: string | undefined, tz: string) =>
  iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "";

const LocalDT = z.string().describe("Date-time in the user's timezone, e.g. 2026-09-25T18:00");

// ---------------------------------------------------------------- helpers
type J = Record<string, any>; // provider JSON
const obj = (x: unknown): J => (x && typeof x === "object" ? (x as J) : {});
const clip = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };

function repoParts(repo: string) {
  const m = repo.trim().replace(/^https?:\/\/github\.com\//, "").match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new ToolError("validation", `"${repo}" isn't a repository in owner/name form.`);
  return { owner: m[1], repo: m[2] };
}


const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

function mime(a: { to: string[]; cc?: string[]; subject: string; body: string }) {
  const lines = [`To: ${a.to.join(", ")}`];
  if (a.cc?.length) lines.push(`Cc: ${a.cc.join(", ")}`);
  lines.push(`Subject: ${encWord(a.subject)}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", Buffer.from(a.body, "utf8").toString("base64"));
  return b64url(lines.join("\r\n"));
}

function decodeBody(payload: J): string {
  if (payload?.mimeType === "text/plain" && payload?.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf8");
  for (const p of payload?.parts ?? []) { const t = decodeBody(p); if (t) return t; }
  if (payload?.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf8").replace(/<[^>]+>/g, " ");
  return "";
}

const header = (m: J, name: string) => (m?.payload?.headers ?? []).find((h: J) => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? "";

function slackOk(res: unknown): J {
  const r = obj(res);
  if (r.ok === false) {
    const e = String(r.error ?? "unknown_error");
    const cat = /invalid_auth|token_revoked|not_authed|account_inactive/.test(e) ? "auth"
      : /missing_scope|not_allowed_token_type|restricted_action/.test(e) ? "permission"
      : /not_found/.test(e) ? "not_found" : /ratelimited/.test(e) ? "rate_limit" : "provider";
    throw new ToolError(cat, `Slack said: ${e}`, cat === "rate_limit", e);
  }
  return r;
}

const NOTION = { "Notion-Version": "2022-06-28" };
const notionTitle = (p: J) => {
  const props = obj(p.properties);
  for (const v of Object.values(props) as J[]) if (v?.type === "title") return (v.title ?? []).map((t: J) => t.plain_text).join("") || "Untitled";
  return (p.title ?? []).map?.((t: J) => t.plain_text).join("") || "Untitled";
};

function notionBlocks(content: string) {
  const text = (s: string) => [{ type: "text", text: { content: s.slice(0, 1900) } }];
  return content.split(/\r?\n/).filter((l) => l.trim()).slice(0, 90).map((l) => {
    if (l.startsWith("## ")) return { object: "block", type: "heading_2", heading_2: { rich_text: text(l.slice(3)) } };
    if (l.startsWith("# ")) return { object: "block", type: "heading_1", heading_1: { rich_text: text(l.slice(2)) } };
    if (/^[-*] /.test(l)) return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: text(l.slice(2)) } };
    return { object: "block", type: "paragraph", paragraph: { rich_text: text(l) } };
  });
}

// ---------------------------------------------------------------- calendar
const Attendee = z.object({ email: z.string().describe("Exact email address — never guess"), name: z.string().optional() });

function eventLinks(e: J): Link[] {
  const links: Link[] = [];
  if (e.htmlLink) links.push({ label: "Open event", url: e.htmlLink });
  const meet = e.hangoutLink ?? (e.conferenceData?.entryPoints ?? []).find((p: J) => p.entryPointType === "video")?.uri;
  if (meet) links.push({ label: "Join Google Meet", url: meet });
  return links;
}

function compactEvent(e: J, tz: string) {
  return {
    id: e.id, title: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date,
    when: `${fmt(e.start?.dateTime ?? e.start?.date, tz)} – ${fmtTime(e.end?.dateTime, tz)}`,
    meet: e.hangoutLink ?? null, attendees: (e.attendees ?? []).map((a: J) => a.email).slice(0, 10), location: e.location ?? null,
  };
}

async function waitForMeet(eventId: string, e: J): Promise<J> {
  let cur = e;
  for (let i = 0; i < 3 && cur.conferenceData?.createRequest?.status?.statusCode === "pending"; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    cur = obj(await exec("calendar.event.get1", { params: { calendarId: "primary", eventId } }));
  }
  return cur;
}

const calendarTools = [
  def({
    name: "calendar_find_events",
    integration: "calendar",
    description: "List events on the user's primary Google Calendar between two times (also returns Meet links). Use for availability checks.",
    input: z.object({ start: LocalDT, end: LocalDT, query: z.string().optional().describe("Optional text filter") }),
    risk: "read",
    label: () => "Checking Google Calendar",
    run: async (a, ctx) => {
      const res = obj(await exec("calendar.event.get", { params: {
        calendarId: "primary", timeMin: toUtc(a.start, ctx.timezone), timeMax: toUtc(a.end, ctx.timezone),
        singleEvents: true, orderBy: "startTime", maxResults: 25, timeZone: ctx.timezone, ...(a.query ? { q: a.query } : {}),
      } }));
      const events = (res.items ?? []).filter((e: J) => e.status !== "cancelled").map((e: J) => compactEvent(e, ctx.timezone));
      return { verified: true, summary: events.length ? `${events.length} event(s): ${events.map((e: J) => `${e.title} (${e.when})`).join("; ")}` : "No events in that range.", data: events };
    },
  }),
  def({
    name: "calendar_create_event",
    integration: "calendar",
    description: "Create an event on the user's primary calendar. Set add_meet=true to attach a real Google Meet link. End defaults to the user's default meeting length.",
    input: z.object({
      title: z.string(), start: LocalDT, end: LocalDT.optional(),
      attendees: z.array(Attendee).optional(), description: z.string().optional(), location: z.string().optional(),
      add_meet: z.boolean().optional(), notify_attendees: z.boolean().optional().describe("Let Google email the invite (default false when you will email it yourself)"),
    }),
    risk: (a) => (a.attendees?.length ? "high" : "low"),
    label: (a) => (a.add_meet ? "Creating event with Google Meet" : "Creating calendar event"),
    preview: (a, ctx) => {
      const startUtc = toUtc(a.start, ctx.timezone);
      const endUtc = a.end ? toUtc(a.end, ctx.timezone) : new Date(Date.parse(startUtc) + ctx.prefs.default_meeting_minutes * 60000).toISOString();
      return { title: `Create “${a.title}”?`, verb: "Create event", rows: [
        ["When", `${fmt(startUtc, ctx.timezone)} – ${fmtTime(endUtc, ctx.timezone)}`],
        ["Guests", a.attendees?.map((x) => x.email).join(", ") || "Just you"],
        ["Google Meet", a.add_meet ? "Yes" : "No"],
        ["Invite email from Google", a.notify_attendees ? "Yes" : "No"],
      ] };
    },
    run: async (a, ctx) => {
      const startUtc = toUtc(a.start, ctx.timezone);
      const endUtc = a.end ? toUtc(a.end, ctx.timezone) : new Date(Date.parse(startUtc) + ctx.prefs.default_meeting_minutes * 60000).toISOString();
      if (Date.parse(endUtc) <= Date.parse(startUtc)) throw new ToolError("validation", "The end time must be after the start time.");
      let e = obj(await exec("calendar.event.create", {
        params: { calendarId: "primary", conferenceDataVersion: a.add_meet ? 1 : 0, sendUpdates: a.notify_attendees ? "all" : "none" },
        body: {
          summary: a.title, description: a.description, location: a.location,
          start: { dateTime: toLocal(startUtc, ctx.timezone), timeZone: ctx.timezone },
          end: { dateTime: toLocal(endUtc, ctx.timezone), timeZone: ctx.timezone },
          attendees: a.attendees?.map((x) => ({ email: x.email, displayName: x.name })),
          conferenceData: a.add_meet ? { createRequest: { requestId: ctx.actionId, conferenceSolutionKey: { type: "hangoutsMeet" } } } : undefined,
          extendedProperties: { private: { relayActionId: ctx.actionId } },
        },
      }));
      if (a.add_meet && e.id) e = await waitForMeet(e.id, e);
      const links = eventLinks(e);
      const meetOk = !a.add_meet || links.some((l) => l.label.includes("Meet"));
      const verified = Boolean(e.id) && e.status !== "cancelled" && meetOk;
      const meetNote = a.add_meet ? (meetOk ? ` Meet: ${links.find((l) => l.label.includes("Meet"))?.url}.` : " The Meet link wasn't produced yet.") : "";
      return { verified, summary: e.id ? `Event “${e.summary}” created for ${fmt(startUtc, ctx.timezone)}.${meetNote}` : "Google didn't return an event id.", evidence: { id: e.id, links }, data: compactEvent(e, ctx.timezone) };
    },
  }),
  def({
    name: "calendar_update_event",
    integration: "calendar",
    description: "Change an existing event (reschedule, rename, add guests, or add a Google Meet with add_meet=true). Needs the event id from calendar_find_events.",
    input: z.object({
      event_id: z.string(), title: z.string().optional(), start: LocalDT.optional(), end: LocalDT.optional(),
      attendees: z.array(Attendee).optional().describe("Full new guest list"), add_meet: z.boolean().optional(), notify_attendees: z.boolean().optional(),
    }),
    risk: "high",
    label: () => "Updating calendar event",
    preview: (a, ctx) => ({ title: "Update this event?", verb: "Update event", rows: [
      ...(a.title ? [["Title", a.title] as [string, string]] : []),
      ...(a.start ? [["Start", fmt(toUtc(a.start, ctx.timezone), ctx.timezone)] as [string, string]] : []),
      ...(a.end ? [["End", fmt(toUtc(a.end, ctx.timezone), ctx.timezone)] as [string, string]] : []),
      ...(a.attendees ? [["Guests", a.attendees.map((x) => x.email).join(", ")] as [string, string]] : []),
      ...(a.add_meet ? [["Google Meet", "Add"] as [string, string]] : []),
    ] }),
    run: async (a, ctx) => {
      const body: J = {};
      if (a.title) body.summary = a.title;
      if (a.start) body.start = { dateTime: toLocal(toUtc(a.start, ctx.timezone), ctx.timezone), timeZone: ctx.timezone };
      if (a.end) body.end = { dateTime: toLocal(toUtc(a.end, ctx.timezone), ctx.timezone), timeZone: ctx.timezone };
      if (a.attendees) body.attendees = a.attendees.map((x) => ({ email: x.email, displayName: x.name }));
      if (a.add_meet) body.conferenceData = { createRequest: { requestId: ctx.actionId, conferenceSolutionKey: { type: "hangoutsMeet" } } };
      let e = obj(await exec("calendar.event.update", { params: { calendarId: "primary", eventId: a.event_id, conferenceDataVersion: a.add_meet ? 1 : 0, sendUpdates: a.notify_attendees ? "all" : "none" }, body }));
      if (a.add_meet && e.id) e = await waitForMeet(e.id, e);
      const links = eventLinks(e);
      const verified = Boolean(e.id) && (!a.add_meet || links.some((l) => l.label.includes("Meet")));
      return { verified, summary: e.id ? `Event “${e.summary}” updated (${fmt(e.start?.dateTime, ctx.timezone)}).` : "Google didn't confirm the update.", evidence: { id: e.id, links }, data: compactEvent(e, ctx.timezone) };
    },
  }),
  def({
    name: "calendar_cancel_event",
    integration: "calendar",
    description: "Cancel (delete) an event by id.",
    input: z.object({ event_id: z.string(), notify_attendees: z.boolean().optional() }),
    risk: "high",
    label: () => "Cancelling calendar event",
    preview: (a) => ({ title: "Cancel this event?", verb: "Cancel event", rows: [["Event id", a.event_id], ["Tell guests", a.notify_attendees ? "Yes" : "No"]] }),
    run: async (a) => {
      await exec("calendar.event.delete", { params: { calendarId: "primary", eventId: a.event_id, sendUpdates: a.notify_attendees ? "all" : "none" } });
      let status = "";
      try { status = obj(await exec("calendar.event.get1", { params: { calendarId: "primary", eventId: a.event_id } })).status; }
      catch (e) { if (e instanceof ToolError && e.category === "not_found") status = "cancelled"; else throw e; }
      return { verified: status === "cancelled", summary: status === "cancelled" ? "Event cancelled." : "I couldn't confirm the cancellation.", evidence: { id: a.event_id } };
    },
  }),
];

// ---------------------------------------------------------------- meet
const meetTools = [
  def({
    name: "meet_create_space",
    integration: "meet",
    description: "Create a standalone Google Meet meeting link (not tied to a calendar event).",
    input: z.object({}),
    risk: "low",
    label: () => "Creating Google Meet",
    run: async () => {
      const r = obj(await exec("google_meet.space.create", { body: {} }));
      return { verified: Boolean(r.meetingUri), summary: r.meetingUri ? `Meet link: ${r.meetingUri}` : "Google Meet didn't return a link.", evidence: { id: r.name, links: r.meetingUri ? [{ label: "Join Google Meet", url: r.meetingUri }] : [] } };
    },
  }),
];

// ---------------------------------------------------------------- gmail
const EmailList = z.array(z.string().describe("Exact email address — never guess")).min(1);

const gmailTools = [
  def({
    name: "gmail_search",
    integration: "gmail",
    description: "Search the user's Gmail with Gmail query syntax (e.g. 'from:rahul newer_than:7d'). Returns sender, subject, date, snippet. Also useful to find a person's email address (must then be confirmed by the user).",
    input: z.object({ query: z.string(), max: z.number().int().min(1).max(10).optional() }),
    risk: "read",
    label: () => "Searching Gmail",
    run: async (a) => {
      const list = obj(await exec("gmail.user.messages.get", { params: { userId: "me", q: a.query, maxResults: a.max ?? 5 } }));
      const ids: string[] = (list.messages ?? []).map((m: J) => m.id).slice(0, a.max ?? 5);
      const msgs = [];
      for (const id of ids) {
        const m = obj(await exec("gmail.user.messages.get1", { params: { userId: "me", id, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] } }));
        msgs.push({ id, threadId: m.threadId, from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), date: header(m, "Date"), snippet: clip(m.snippet, 200) });
      }
      return { verified: true, summary: msgs.length ? `${msgs.length} email(s) found.` : "No matching emails.", data: msgs };
    },
  }),
  def({
    name: "gmail_read_message",
    integration: "gmail",
    description: "Read one email's full text by message id (from gmail_search).",
    input: z.object({ id: z.string() }),
    risk: "read",
    label: () => "Reading email",
    run: async (a) => {
      const m = obj(await exec("gmail.user.messages.get1", { params: { userId: "me", id: a.id, format: "full" } }));
      return { verified: true, summary: `Email “${header(m, "Subject")}” from ${header(m, "From")}.`, data: { from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), date: header(m, "Date"), body: clip(decodeBody(m.payload), 3000) } };
    },
  }),
  def({
    name: "gmail_send",
    integration: "gmail",
    description: "Send a plain-text email from the user's Gmail. Recipients must come from the user, saved contacts, or a confirmed tool result.",
    input: z.object({ to: EmailList, cc: z.array(z.string()).optional(), subject: z.string(), body: z.string(), thread_id: z.string().optional() }),
    risk: "high",
    label: () => "Sending email",
    preview: (a) => ({ title: `Send this email to ${a.to.join(", ")}?`, verb: "Send email", rows: [
      ["To", a.to.join(", ")], ...(a.cc?.length ? [["Cc", a.cc.join(", ")] as [string, string]] : []), ["Subject", a.subject], ["Message", clip(a.body, 400)],
    ] }),
    run: async (a) => {
      const r = obj(await exec("gmail.user.send.create1", { params: { userId: "me" }, headers: { "Content-Type": "application/json" }, body: { raw: mime(a), ...(a.thread_id ? { threadId: a.thread_id } : {}) } }));
      const verified = Boolean(r.id) && (!Array.isArray(r.labelIds) || r.labelIds.includes("SENT"));
      return { verified, summary: verified ? `Email sent to ${a.to.join(", ")}.` : "Gmail didn't confirm the send.", evidence: { id: r.id, links: r.threadId ? [{ label: "View in Gmail", url: `https://mail.google.com/mail/u/0/#sent/${r.threadId}` }] : [] } };
    },
  }),
  def({
    name: "gmail_create_draft",
    integration: "gmail",
    description: "Save an email as a Gmail draft (not sent).",
    input: z.object({ to: z.array(z.string()), cc: z.array(z.string()).optional(), subject: z.string(), body: z.string() }),
    risk: "low",
    label: () => "Saving Gmail draft",
    run: async (a) => {
      const r = obj(await exec("gmail.user.drafts.create", { params: { userId: "me" }, headers: { "Content-Type": "application/json" }, body: { message: { raw: mime(a) } } }));
      return { verified: Boolean(r.id), summary: r.id ? "Draft saved in Gmail." : "Gmail didn't confirm the draft.", evidence: { id: r.id, links: [{ label: "Open drafts", url: "https://mail.google.com/mail/u/0/#drafts" }] } };
    },
  }),
];

// ---------------------------------------------------------------- slack
async function slackChannelId(channel: string): Promise<string> {
  const c = channel.trim();
  if (/^[CGD][A-Z0-9]{6,}$/.test(c)) return c;
  if (/^[UW][A-Z0-9]{6,}$/.test(c)) {
    const r = slackOk(await exec("slack.conversations.open.create", { body: { users: c } }));
    return r.channel?.id;
  }
  const name = c.replace(/^#/, "").toLowerCase();
  const r = slackOk(await exec("slack.conversations.list.list", { params: { types: "public_channel,private_channel", exclude_archived: true, limit: 200 } }));
  const hit = (r.channels ?? []).find((x: J) => String(x.name).toLowerCase() === name);
  if (!hit) throw new ToolError("not_found", `I couldn't find a Slack channel called #${name}.`);
  return hit.id;
}

const slackTools = [
  def({
    name: "slack_list_channels",
    integration: "slack",
    description: "List Slack channels (name, id, member count).",
    input: z.object({}),
    risk: "read",
    label: () => "Listing Slack channels",
    run: async () => {
      const r = slackOk(await exec("slack.conversations.list.list", { params: { types: "public_channel,private_channel", exclude_archived: true, limit: 200 } }));
      const ch = (r.channels ?? []).map((c: J) => ({ id: c.id, name: c.name, members: c.num_members, is_member: c.is_member }));
      return { verified: true, summary: `${ch.length} channel(s).`, data: ch.slice(0, 60) };
    },
  }),
  def({
    name: "slack_read_channel",
    integration: "slack",
    description: "Read recent messages in a Slack channel (by #name or id).",
    input: z.object({ channel: z.string(), limit: z.number().int().min(1).max(30).optional() }),
    risk: "read",
    label: () => "Reading Slack",
    run: async (a) => {
      const id = await slackChannelId(a.channel);
      const r = slackOk(await exec("slack.conversations.history.list", { params: { channel: id, limit: a.limit ?? 20 } }));
      const msgs = (r.messages ?? []).map((m: J) => ({ ts: m.ts, user: m.user ?? m.username, text: clip(m.text, 400) }));
      return { verified: true, summary: `${msgs.length} message(s) from ${a.channel}.`, data: { channel_id: id, messages: msgs } };
    },
  }),
  def({
    name: "slack_search",
    integration: "slack",
    description: "Search Slack messages across channels (requires a user-token connection; if it fails, read the channel instead).",
    input: z.object({ query: z.string() }),
    risk: "read",
    label: () => "Searching Slack",
    run: async (a) => {
      const r = slackOk(await exec("slack.search.message.list", { params: { query: a.query, count: 20, sort: "timestamp" } }));
      const hits = (r.messages?.matches ?? []).map((m: J) => ({ channel: m.channel?.name, user: m.username, text: clip(m.text, 300), ts: m.ts, permalink: m.permalink }));
      return { verified: true, summary: `${hits.length} matching message(s).`, data: hits };
    },
  }),
  def({
    name: "slack_find_user",
    integration: "slack",
    description: "Find a Slack user by exact email, or by name among workspace members. Returns their user id for DMs.",
    input: z.object({ email: z.string().optional(), name: z.string().optional() }),
    risk: "read",
    label: () => "Looking up Slack user",
    run: async (a) => {
      if (a.email) {
        const r = slackOk(await exec("slack.users.lookupbyemail.list", { params: { email: a.email } }));
        return { verified: true, summary: `Found ${r.user?.real_name ?? r.user?.name}.`, data: [{ id: r.user?.id, name: r.user?.real_name ?? r.user?.name }] };
      }
      const r = slackOk(await exec("slack.users.list.list", { params: { limit: 200 } }));
      const q = (a.name ?? "").toLowerCase();
      const hits = (r.members ?? []).filter((u: J) => !u.deleted && !u.is_bot && [u.name, u.real_name, u.profile?.display_name].some((n: string) => n?.toLowerCase().includes(q)))
        .map((u: J) => ({ id: u.id, name: u.real_name ?? u.name }));
      return { verified: true, summary: `${hits.length} matching user(s).`, data: hits.slice(0, 10) };
    },
  }),
  def({
    name: "slack_send_message",
    integration: "slack",
    description: "Post a message to a Slack channel (#name or id) or DM a user (user id from slack_find_user).",
    input: z.object({ channel: z.string(), text: z.string(), thread_ts: z.string().optional() }),
    risk: "high",
    label: () => "Sending Slack message",
    preview: (a) => ({ title: `Post to ${a.channel} on Slack?`, verb: "Send message", rows: [["To", a.channel], ["Message", clip(a.text, 500)]] }),
    run: async (a) => {
      const id = await slackChannelId(a.channel);
      const post = () => exec("slack.chat.postmessage.create", { body: { channel: id, text: a.text, ...(a.thread_ts ? { thread_ts: a.thread_ts } : {}) } });
      let r: J;
      try { r = slackOk(await post()); }
      catch (e) {
        if (!(e instanceof ToolError) || !/not_in_channel/.test(e.detail ?? "")) throw e;
        slackOk(await exec("slack.conversations.join.create", { body: { channel: id } }));
        r = slackOk(await post());
      }
      let permalink: string | undefined;
      try { permalink = slackOk(await exec("slack.chat.getpermalink.list", { params: { channel: r.channel ?? id, message_ts: r.ts } })).permalink; } catch { /* link is optional */ }
      const verified = r.ok === true && Boolean(r.ts);
      return { verified, summary: verified ? `Message posted to ${a.channel}.` : "Slack didn't confirm the message.", evidence: { id: r.ts, links: permalink ? [{ label: "Open in Slack", url: permalink }] : [] } };
    },
  }),
];

// ---------------------------------------------------------------- notion
const notionTools = [
  def({
    name: "notion_search",
    integration: "notion",
    description: "Search Notion pages shared with the integration by title/keywords.",
    input: z.object({ query: z.string() }),
    risk: "read",
    label: () => "Searching Notion",
    run: async (a) => {
      const r = obj(await exec("notion.search.create", { headers: NOTION, body: { query: a.query, page_size: 10, filter: { property: "object", value: "page" } } }));
      const pages = (r.results ?? []).map((p: J) => ({ id: p.id, title: notionTitle(p), url: p.url, edited: p.last_edited_time }));
      return { verified: true, summary: pages.length ? `${pages.length} page(s): ${pages.map((p: J) => p.title).join(", ")}` : "No pages found (Notion only shows pages shared with the integration).", data: pages };
    },
  }),
  def({
    name: "notion_read_page",
    integration: "notion",
    description: "Read a Notion page's content as markdown by page id.",
    input: z.object({ page_id: z.string() }),
    risk: "read",
    label: () => "Reading Notion page",
    run: async (a) => {
      const r = obj(await exec("notion.markdown.get", { params: { page_id: a.page_id }, headers: NOTION }));
      const md = r.markdown ?? r.content ?? JSON.stringify(r);
      return { verified: true, summary: "Page read.", data: { markdown: clip(md, 5000) } };
    },
  }),
  def({
    name: "notion_create_page",
    integration: "notion",
    description: "Create a Notion page (title + content lines; '# ', '## ', '- ' supported) under a parent page. Parent defaults to the user's default Notion page.",
    input: z.object({ title: z.string(), content: z.string(), parent_page_id: z.string().optional() }),
    risk: "low",
    label: () => "Creating Notion page",
    preview: (a) => ({ title: `Create Notion page “${a.title}”?`, verb: "Create page", rows: [["Title", a.title], ["Content", clip(a.content, 400)]] }),
    run: async (a, ctx) => {
      const parent = a.parent_page_id ?? ctx.prefs.default_notion_parent;
      if (!parent) throw new ToolError("validation", "Which Notion page should I save it under? (Set a default Notion page in Settings, or tell me a page to use.)");
      const r = obj(await exec("notion.page.create", { headers: NOTION, body: {
        parent: { page_id: parent }, properties: { title: { title: [{ text: { content: a.title } }] } }, children: notionBlocks(a.content),
      } }));
      const verified = r.object === "page" && Boolean(r.id);
      return { verified, summary: verified ? `Notion page “${a.title}” created.` : "Notion didn't confirm the page.", evidence: { id: r.id, links: r.url ? [{ label: "Open in Notion", url: r.url }] : [] } };
    },
  }),
];

// ---------------------------------------------------------------- drive
const MIME: Record<string, string> = {
  presentation: "application/vnd.google-apps.presentation", document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet", pdf: "application/pdf", folder: "application/vnd.google-apps.folder",
};

const driveTools = [
  def({
    name: "drive_search",
    integration: "drive",
    description: "Find Google Drive files by name, newest first. Returns name, type, modified time and link.",
    input: z.object({ name_contains: z.string().optional(), type: z.enum(["any", "presentation", "document", "spreadsheet", "pdf", "folder"]).optional(), max: z.number().int().min(1).max(10).optional() }),
    risk: "read",
    label: () => "Searching Google Drive",
    run: async (a) => {
      const q = (field: string) => [
        a.name_contains ? `${field} contains '${a.name_contains.replace(/'/g, "\\'")}'` : "",
        a.type && a.type !== "any" ? `mimeType = '${MIME[a.type]}'` : "", "trashed = false",
      ].filter(Boolean).join(" and ");
      let r: J;
      try { r = obj(await exec("drive.file.list", { params: { q: q("title"), orderBy: "modifiedDate desc", maxResults: a.max ?? 5 } })); } // bundle targets Drive v2
      catch (e) {
        if (!(e instanceof ToolError) || e.category !== "validation") throw e;
        r = obj(await exec("drive.file.list", { params: { q: q("name"), orderBy: "modifiedTime desc", pageSize: a.max ?? 5 } })); // v3 fallback
      }
      const files = (r.items ?? r.files ?? []).map((f: J) => ({ id: f.id, name: f.title ?? f.name, type: f.mimeType, modified: f.modifiedDate ?? f.modifiedTime, url: f.alternateLink ?? f.webViewLink }));
      return { verified: true, summary: files.length ? `${files.length} file(s): ${files.map((f: J) => f.name).join(", ")}` : "No matching files.", data: files, evidence: { links: files.filter((f: J) => f.url).slice(0, 3).map((f: J) => ({ label: f.name, url: f.url })) } };
    },
  }),
];

// ---------------------------------------------------------------- github
const Repo = z.string().describe("owner/name");

const githubTools = [
  def({
    name: "github_list_repos",
    integration: "github",
    description: "List the user's GitHub repositories, most recently updated first.",
    input: z.object({}),
    risk: "read",
    label: () => "Listing GitHub repositories",
    run: async () => {
      const r = await exec("github.repo.list", { params: { sort: "updated", per_page: 20 } });
      const repos = (Array.isArray(r) ? r : []).map((x: J) => ({ repo: x.full_name, open_issues: x.open_issues_count, updated: x.pushed_at, private: x.private }));
      return { verified: true, summary: `${repos.length} repositories.`, data: repos };
    },
  }),
  def({
    name: "github_list_issues",
    integration: "github",
    description: "List open (or closed) issues in a repository with labels, assignees, comment counts and age — use this to judge which need attention.",
    input: z.object({ repo: Repo, state: z.enum(["open", "closed", "all"]).optional(), labels: z.string().optional().describe("comma-separated") }),
    risk: "read",
    label: () => "Reading GitHub issues",
    run: async (a) => {
      const { owner, repo } = repoParts(a.repo);
      const r = await exec("github.issue.get1", { params: { owner, repo, state: a.state ?? "open", sort: "updated", direction: "desc", per_page: 15, ...(a.labels ? { labels: a.labels } : {}) } });
      const issues = (Array.isArray(r) ? r : []).filter((i: J) => !i.pull_request).map((i: J) => ({
        number: i.number, title: i.title, labels: (i.labels ?? []).map((l: J) => l.name), assignees: (i.assignees ?? []).map((u: J) => u.login),
        comments: i.comments, created: i.created_at, updated: i.updated_at, url: i.html_url, body: clip(i.body, 200),
      }));
      return { verified: true, summary: `${issues.length} ${a.state ?? "open"} issue(s) in ${a.repo}.`, data: issues };
    },
  }),
  def({
    name: "github_create_issue",
    integration: "github",
    description: "Create a GitHub issue.",
    input: z.object({ repo: Repo, title: z.string(), body: z.string().optional(), labels: z.array(z.string()).optional() }),
    risk: "high",
    label: () => "Creating GitHub issue",
    preview: (a) => ({ title: `Open an issue in ${a.repo}?`, verb: "Create issue", rows: [["Repository", a.repo], ["Title", a.title], ...(a.body ? [["Details", clip(a.body, 400)] as [string, string]] : []), ...(a.labels?.length ? [["Labels", a.labels.join(", ")] as [string, string]] : [])] }),
    run: async (a) => {
      const { owner, repo } = repoParts(a.repo);
      const r = obj(await exec("github.issue.create", { params: { owner, repo }, body: { title: a.title, body: a.body, labels: a.labels } }));
      const verified = Boolean(r.number && r.html_url);
      return { verified, summary: verified ? `Issue #${r.number} created in ${a.repo}.` : "GitHub didn't confirm the issue.", evidence: { id: String(r.number ?? ""), links: r.html_url ? [{ label: `Issue #${r.number}`, url: r.html_url }] : [] } };
    },
  }),
  def({
    name: "github_comment_issue",
    integration: "github",
    description: "Comment on a GitHub issue.",
    input: z.object({ repo: Repo, number: z.number().int(), body: z.string() }),
    risk: "high",
    label: () => "Commenting on GitHub issue",
    preview: (a) => ({ title: `Comment on ${a.repo}#${a.number}?`, verb: "Post comment", rows: [["Issue", `${a.repo}#${a.number}`], ["Comment", clip(a.body, 400)]] }),
    run: async (a) => {
      const { owner, repo } = repoParts(a.repo);
      const r = obj(await exec("github.issue.comments.create", { params: { owner, repo, issue_number: a.number }, body: { body: a.body } }));
      const verified = Boolean(r.id && r.html_url);
      return { verified, summary: verified ? `Comment posted on #${a.number}.` : "GitHub didn't confirm the comment.", evidence: { id: String(r.id ?? ""), links: r.html_url ? [{ label: "View comment", url: r.html_url }] : [] } };
    },
  }),
];

// ---------------------------------------------------------------- zoom
const zoomTools = [
  def({
    name: "zoom_list_meetings",
    integration: "zoom",
    description: "List the user's scheduled Zoom meetings (topic, start, join link).",
    input: z.object({}),
    risk: "read",
    label: () => "Checking Zoom",
    run: async (_a, ctx) => {
      const r = obj(await exec("zoom.meeting.get3", { params: { userId: "me" } }));
      const ms = (r.meetings ?? []).slice(0, 20).map((m: J) => ({ id: m.id, topic: m.topic, start: fmt(m.start_time, ctx.timezone), duration: m.duration, join_url: m.join_url }));
      return { verified: true, summary: ms.length ? `${ms.length} Zoom meeting(s).` : "No scheduled Zoom meetings.", data: ms };
    },
  }),
  def({
    name: "zoom_create_meeting",
    integration: "zoom",
    description: "Schedule a Zoom meeting on the user's account and get its join link. Duration defaults to the user's default meeting length.",
    input: z.object({ topic: z.string(), start: LocalDT, duration_minutes: z.number().int().min(5).max(600).optional(), agenda: z.string().optional() }),
    risk: "low",
    label: () => "Creating Zoom meeting",
    preview: (a, ctx) => ({ title: `Create Zoom meeting “${a.topic}”?`, verb: "Create meeting", rows: [["When", fmt(toUtc(a.start, ctx.timezone), ctx.timezone)], ["Length", `${a.duration_minutes ?? ctx.prefs.default_meeting_minutes} min`]] }),
    run: async (a, ctx) => {
      const m = obj(await exec("zoom.meeting.create", { params: { userId: "me" }, body: {
        topic: a.topic, type: 2, start_time: toLocal(toUtc(a.start, ctx.timezone), ctx.timezone), timezone: ctx.timezone,
        duration: a.duration_minutes ?? ctx.prefs.default_meeting_minutes, ...(a.agenda ? { agenda: a.agenda } : {}),
      } }));
      // start_url carries a host token — never surfaced.
      const verified = Boolean(m.id && m.join_url);
      return { verified, summary: verified ? `Zoom meeting “${m.topic}” scheduled for ${fmt(toUtc(a.start, ctx.timezone), ctx.timezone)}. Join: ${m.join_url}` : "Zoom didn't return a meeting link.", evidence: { id: String(m.id ?? ""), links: m.join_url ? [{ label: "Join Zoom", url: m.join_url }] : [] } };
    },
  }),
];

// ---------------------------------------------------------------- discord
const discordTools = [
  def({
    name: "discord_list_servers",
    integration: "discord",
    description: "List the Discord servers the connected bot is in (id, name).",
    input: z.object({}),
    risk: "read",
    label: () => "Listing Discord servers",
    run: async () => {
      const r = await exec("discord.me.guilds.list", { params: { limit: 50 } });
      const gs = (Array.isArray(r) ? r : []).map((x: J) => ({ id: x.id, name: x.name }));
      return { verified: true, summary: `${gs.length} server(s): ${gs.map((x: J) => x.name).join(", ")}`, data: gs };
    },
  }),
  def({
    name: "discord_list_channels",
    integration: "discord",
    description: "List text channels in a Discord server (server id from discord_list_servers).",
    input: z.object({ server_id: z.string() }),
    risk: "read",
    label: () => "Listing Discord channels",
    run: async (a) => {
      const r = await exec("discord.channel.get1", { params: { guild_id: a.server_id } });
      const cs = (Array.isArray(r) ? r : []).filter((c: J) => c.type === 0 || c.type === 5).map((c: J) => ({ id: c.id, name: c.name }));
      return { verified: true, summary: `${cs.length} text channel(s).`, data: cs };
    },
  }),
  def({
    name: "discord_read_channel",
    integration: "discord",
    description: "Read recent messages in a Discord channel (channel id from discord_list_channels).",
    input: z.object({ channel_id: z.string(), limit: z.number().int().min(1).max(50).optional() }),
    risk: "read",
    label: () => "Reading Discord",
    run: async (a) => {
      const r = await exec("discord.message.get", { params: { channel_id: a.channel_id, limit: a.limit ?? 20 } });
      const ms = (Array.isArray(r) ? r : []).map((m: J) => ({ id: m.id, author: m.author?.username, text: clip(m.content, 400), at: m.timestamp }));
      return { verified: true, summary: `${ms.length} message(s).`, data: ms };
    },
  }),
  def({
    name: "discord_send_message",
    integration: "discord",
    description: "Post a message to a Discord channel as the connected bot.",
    input: z.object({ channel_id: z.string(), text: z.string().max(2000) }),
    risk: "high",
    label: () => "Sending Discord message",
    preview: (a) => ({ title: "Post this on Discord?", verb: "Send message", rows: [["Channel id", a.channel_id], ["Message", clip(a.text, 500)]] }),
    run: async (a) => {
      const m = obj(await exec("discord.message.create", { params: { channel_id: a.channel_id }, body: { content: a.text } }));
      const verified = Boolean(m.id) && m.channel_id === a.channel_id;
      const url = m.id && m.guild_id ? `https://discord.com/channels/${m.guild_id}/${m.channel_id}/${m.id}` : undefined;
      return { verified, summary: verified ? "Message posted on Discord." : "Discord didn't confirm the message.", evidence: { id: m.id, links: url ? [{ label: "Open in Discord", url }] : [] } };
    },
  }),
];

// ---------------------------------------------------------------- google docs / sheets / slides
const docText = (d: J) => (d.body?.content ?? []).flatMap((c: J) => c.paragraph?.elements ?? []).map((e: J) => e.textRun?.content ?? "").join("");
const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;
const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
const slidesUrl = (id: string) => `https://docs.google.com/presentation/d/${id}/edit`;

const docsTools = [
  def({
    name: "docs_create",
    integration: "docs",
    description: "Create a Google Doc with a title and optional text content.",
    input: z.object({ title: z.string(), content: z.string().optional() }),
    risk: "low",
    label: () => "Creating Google Doc",
    run: async (a) => {
      const d = obj(await exec("google_docs.document.create", { body: { title: a.title } }));
      if (!d.documentId) return { verified: false, summary: "Google Docs didn't return a document id." };
      if (a.content) await exec("google_docs.documentidbatchupdate.create", { params: { documentId: d.documentId }, body: { requests: [{ insertText: { location: { index: 1 }, text: a.content } }] } });
      return { verified: true, summary: `Google Doc “${a.title}” created.`, evidence: { id: d.documentId, links: [{ label: "Open doc", url: docUrl(d.documentId) }] } };
    },
  }),
  def({
    name: "docs_read",
    integration: "docs",
    description: "Read a Google Doc's text by document id (find ids with drive_search).",
    input: z.object({ document_id: z.string() }),
    risk: "read",
    label: () => "Reading Google Doc",
    run: async (a) => {
      const d = obj(await exec("google_docs.document.get", { params: { documentId: a.document_id } }));
      return { verified: true, summary: `Read “${d.title}”.`, data: { title: d.title, text: clip(docText(d), 5000) }, evidence: { links: [{ label: "Open doc", url: docUrl(a.document_id) }] } };
    },
  }),
  def({
    name: "docs_append",
    integration: "docs",
    description: "Append text to the end of a Google Doc.",
    input: z.object({ document_id: z.string(), text: z.string() }),
    risk: "low",
    label: () => "Updating Google Doc",
    run: async (a) => {
      const r = obj(await exec("google_docs.documentidbatchupdate.create", { params: { documentId: a.document_id }, body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: `\n${a.text}` } }] } }));
      const verified = r.documentId === a.document_id;
      return { verified, summary: verified ? "Text added to the doc." : "Google Docs didn't confirm the update.", evidence: { id: a.document_id, links: [{ label: "Open doc", url: docUrl(a.document_id) }] } };
    },
  }),
];

const sheetsTools = [
  def({
    name: "sheets_create",
    integration: "sheets",
    description: "Create a Google Sheet, optionally with a header row.",
    input: z.object({ title: z.string(), header: z.array(z.string()).optional() }),
    risk: "low",
    label: () => "Creating Google Sheet",
    run: async (a) => {
      const s = obj(await exec("google_sheets.spreadsheet.create", { body: { properties: { title: a.title } } }));
      if (!s.spreadsheetId) return { verified: false, summary: "Google Sheets didn't return a spreadsheet id." };
      if (a.header?.length) await exec("google_sheets.value.rangeappend.create", { params: { spreadsheetId: s.spreadsheetId, range: "A1", valueInputOption: "USER_ENTERED" }, body: { values: [a.header] } });
      return { verified: true, summary: `Google Sheet “${a.title}” created.`, evidence: { id: s.spreadsheetId, links: [{ label: "Open sheet", url: s.spreadsheetUrl ?? sheetUrl(s.spreadsheetId) }] } };
    },
  }),
  def({
    name: "sheets_read",
    integration: "sheets",
    description: "Read cells from a Google Sheet (A1 range such as 'Sheet1!A1:E30').",
    input: z.object({ spreadsheet_id: z.string(), range: z.string() }),
    risk: "read",
    label: () => "Reading Google Sheet",
    run: async (a) => {
      const r = obj(await exec("google_sheets.value.get", { params: { spreadsheetId: a.spreadsheet_id, range: a.range } }));
      const rows: unknown[][] = (r.values ?? []).slice(0, 60);
      return { verified: true, summary: `${rows.length} row(s) read.`, data: rows, evidence: { links: [{ label: "Open sheet", url: sheetUrl(a.spreadsheet_id) }] } };
    },
  }),
  def({
    name: "sheets_append",
    integration: "sheets",
    description: "Append rows to a Google Sheet (after the last row of the range, default 'A1').",
    input: z.object({ spreadsheet_id: z.string(), rows: z.array(z.array(z.string())).min(1).max(200), range: z.string().optional() }),
    risk: "low",
    label: () => "Adding rows to Google Sheet",
    run: async (a) => {
      const r = obj(await exec("google_sheets.value.rangeappend.create", { params: { spreadsheetId: a.spreadsheet_id, range: a.range ?? "A1", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" }, body: { values: a.rows } }));
      const n = Number(r.updates?.updatedRows ?? 0);
      return { verified: n === a.rows.length, summary: n ? `${n} row(s) added.` : "Google Sheets didn't confirm the rows.", evidence: { id: a.spreadsheet_id, links: [{ label: "Open sheet", url: sheetUrl(a.spreadsheet_id) }] } };
    },
  }),
];

const slideText = (s: J) => (s.pageElements ?? []).flatMap((e: J) => e.shape?.text?.textElements ?? []).map((t: J) => t.textRun?.content ?? "").join("").trim();

const slidesTools = [
  def({
    name: "slides_create",
    integration: "slides",
    description: "Create a Google Slides presentation. Add slides with slides_add_slide.",
    input: z.object({ title: z.string() }),
    risk: "low",
    label: () => "Creating Google Slides deck",
    run: async (a) => {
      const p = obj(await exec("google_slides.presentation.create", { body: { title: a.title } }));
      return { verified: Boolean(p.presentationId), summary: p.presentationId ? `Deck “${a.title}” created.` : "Google Slides didn't return a presentation id.", evidence: { id: p.presentationId, links: p.presentationId ? [{ label: "Open deck", url: slidesUrl(p.presentationId) }] : [] } };
    },
  }),
  def({
    name: "slides_read",
    integration: "slides",
    description: "Read a Google Slides deck: slide count and the text on each slide.",
    input: z.object({ presentation_id: z.string() }),
    risk: "read",
    label: () => "Reading Google Slides",
    run: async (a) => {
      const p = obj(await exec("google_slides.presentation.get", { params: { presentationId: a.presentation_id } }));
      const slides = (p.slides ?? []).map((s: J, i: number) => ({ n: i + 1, text: clip(slideText(s), 400) }));
      return { verified: true, summary: `“${p.title}” has ${slides.length} slide(s).`, data: slides, evidence: { links: [{ label: "Open deck", url: slidesUrl(a.presentation_id) }] } };
    },
  }),
  def({
    name: "slides_add_slide",
    integration: "slides",
    description: "Add a title-and-body slide to a Google Slides deck.",
    input: z.object({ presentation_id: z.string(), title: z.string(), body: z.string().optional() }),
    risk: "low",
    label: () => "Adding a slide",
    run: async (a, ctx) => {
      const id = (p: string) => `relay_${p}_${ctx.actionId.slice(0, 12)}`;
      const requests: J[] = [
        { createSlide: { objectId: id("s"), slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" }, placeholderIdMappings: [
          { layoutPlaceholder: { type: "TITLE" }, objectId: id("t") }, { layoutPlaceholder: { type: "BODY" }, objectId: id("b") },
        ] } },
        { insertText: { objectId: id("t"), text: a.title } },
        ...(a.body ? [{ insertText: { objectId: id("b"), text: a.body } }] : []),
      ];
      const r = obj(await exec("google_slides.presentationidbatchupdate.create", { params: { presentationId: a.presentation_id }, body: { requests } }));
      const verified = r.presentationId === a.presentation_id && Boolean(r.replies?.[0]?.createSlide?.objectId);
      return { verified, summary: verified ? `Slide “${a.title}” added.` : "Google Slides didn't confirm the slide.", evidence: { id: a.presentation_id, links: [{ label: "Open deck", url: slidesUrl(a.presentation_id) }] } };
    },
  }),
];

// ---------------------------------------------------------------- x.com
const xTools = [
  def({
    name: "x_search_recent",
    integration: "x",
    description: "Search posts on X from the last 7 days (X search query syntax). Requires an X API plan that includes search.",
    input: z.object({ query: z.string(), max: z.number().int().min(10).max(50).optional() }),
    risk: "read",
    label: () => "Searching X",
    run: async (a) => {
      const r = obj(await exec("x_v2.tweet.recent.list1", { params: { query: a.query, max_results: a.max ?? 10, "post.fields": "created_at,public_metrics" } }));
      const posts = (r.data ?? []).map((p: J) => ({ id: p.id, text: clip(p.text, 280), at: p.created_at, likes: p.public_metrics?.like_count }));
      return { verified: true, summary: `${posts.length} post(s) found.`, data: posts };
    },
  }),
  def({
    name: "x_post",
    integration: "x",
    description: "Publish a post on X from the user's account (max 280 characters).",
    input: z.object({ text: z.string().min(1).max(280) }),
    risk: "high",
    label: () => "Posting on X",
    preview: (a) => ({ title: "Post this on X?", verb: "Post", rows: [["Post", a.text], ["Length", `${a.text.length}/280`]] }),
    run: async (a) => {
      const r = obj(await exec("x_v2.tweet.create", { body: { text: a.text } }));
      const id = r.data?.id;
      return { verified: Boolean(id), summary: id ? "Posted on X." : "X didn't confirm the post.", evidence: { id, links: id ? [{ label: "View post", url: `https://x.com/i/web/status/${id}` }] : [] } };
    },
  }),
];

// ---------------------------------------------------------------- openweather
const Coords = {
  lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  place: z.string().describe("The place the user named; its well-known coordinates go in lat/lon"),
  units: z.enum(["metric", "imperial"]).optional(),
};
const deg = (u?: string) => (u === "imperial" ? "°F" : "°C");

const weatherTools = [
  def({
    name: "weather_now",
    integration: "weather",
    description: "Current weather at a place (pass its latitude/longitude). The reply names the location OpenWeather resolved, so check it matches.",
    input: z.object(Coords),
    risk: "read",
    label: (a) => `Checking weather in ${a.place}`,
    run: async (a) => {
      const w = obj(await exec("openweather.2.5.weather.list", { params: { lat: a.lat, lon: a.lon, units: a.units ?? "metric" } }));
      const u = deg(a.units);
      return { verified: true, summary: `${w.name || a.place}: ${w.weather?.[0]?.description ?? "?"}, ${Math.round(w.main?.temp)}${u} (feels ${Math.round(w.main?.feels_like)}${u}), humidity ${w.main?.humidity}%.`, data: { resolved_place: w.name, asked_for: a.place, temp: w.main?.temp, feels_like: w.main?.feels_like, humidity: w.main?.humidity, wind: w.wind?.speed, conditions: w.weather?.[0]?.description } };
    },
  }),
  def({
    name: "weather_forecast",
    integration: "weather",
    description: "Forecast for the next ~2 days in 3-hour steps at a place (pass its latitude/longitude).",
    input: z.object(Coords),
    risk: "read",
    label: (a) => `Getting the forecast for ${a.place}`,
    run: async (a, ctx) => {
      const f = obj(await exec("openweather.2.5.forecast.list", { params: { lat: a.lat, lon: a.lon, units: a.units ?? "metric", cnt: 16 } }));
      const steps = (f.list ?? []).map((s: J) => ({ at: fmt(new Date(s.dt * 1000).toISOString(), ctx.timezone), temp: Math.round(s.main?.temp), conditions: s.weather?.[0]?.description, rain_chance: s.pop }));
      return { verified: true, summary: `Forecast for ${f.city?.name || a.place}: ${steps.slice(0, 3).map((s: J) => `${s.at} ${s.temp}${deg(a.units)} ${s.conditions}`).join("; ")}.`, data: { resolved_place: f.city?.name, steps } };
    },
  }),
];

export const TOOLS: ToolDef[] = [...calendarTools, ...meetTools, ...gmailTools, ...slackTools, ...notionTools, ...driveTools, ...githubTools, ...zoomTools, ...discordTools, ...docsTools, ...sheetsTools, ...slidesTools, ...xTools, ...weatherTools];
export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);
export const riskOf = (t: ToolDef, args: unknown): Risk => (typeof t.risk === "function" ? t.risk(args) : t.risk);
