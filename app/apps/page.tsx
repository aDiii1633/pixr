"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Copy, ExternalLink, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import Shell from "@/components/Shell";
import type { IntegrationStatus } from "@/lib/types";

const COLORS: Record<string, string> = {
  calendar: "#3563f0", meet: "#5bc476", gmail: "#f2766b", drive: "#e0a800", docs: "#4f7df5", sheets: "#2f9e62", slides: "#e8a33b",
  slack: "#9b6bf2", notion: "#3e3d48", github: "#24232d", zoom: "#2d8cff", discord: "#5865f2", x: "#111111", weather: "#f27baa",
};
const GOOGLE = ["calendar", "gmail", "drive", "meet", "docs", "sheets", "slides"];

type TokenGuide = { placeholder: string; steps: React.ReactNode[]; fields?: { key: string; label: string; secret?: boolean }[] };
const L = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-bold text-blue underline-offset-2 hover:underline">{children}<ExternalLink size={12} /></a>;

const GUIDES: Record<string, TokenGuide> = {
  github: { placeholder: "ghp_… or github_pat_…", steps: [
    <>Open <L href="https://github.com/settings/tokens/new?scopes=repo&description=Pixr%20agent">GitHub → new token</L> (scope <b>repo</b> is pre-selected).</>,
    <>Press <b>Generate token</b> and paste it below.</>,
  ] },
  slack: { placeholder: "xoxb-…", steps: [
    <>Open <L href="https://api.slack.com/apps?new_app=1">Slack → Create app</L> → <b>From scratch</b>, pick your workspace.</>,
    <><b>OAuth &amp; Permissions</b> → Bot Token Scopes: <code>channels:read channels:history groups:read chat:write chat:write.public users:read users:read.email im:write</code>.</>,
    <><b>Install to Workspace</b>, copy the <b>Bot User OAuth Token</b> and paste it below.</>,
  ] },
  notion: { placeholder: "ntn_…", steps: [
    <>Open <L href="https://www.notion.so/profile/integrations">Notion → Integrations</L> → <b>New integration</b> (Internal).</>,
    <>Copy the <b>Internal Integration Secret</b> and paste it below.</>,
    <>In Notion, open the pages Pixr may use → <b>•••</b> → <b>Connections</b> → add your integration.</>,
  ] },
  zoom: { placeholder: "", fields: [{ key: "accountId", label: "Account ID" }, { key: "clientId", label: "Client ID" }, { key: "clientSecret", label: "Client secret", secret: true }], steps: [
    <>Open <L href="https://marketplace.zoom.us/develop/create">Zoom Marketplace → Develop → Build App</L> → <b>Server-to-Server OAuth</b>.</>,
    <>Scopes: <code>meeting:write:meeting:admin meeting:read:list_meetings:admin user:read:user:admin</code> → <b>Activate</b>.</>,
    <>Copy the <b>Account ID</b>, <b>Client ID</b> and <b>Client secret</b> into the fields below.</>,
  ] },
  discord: { placeholder: "Bot token", steps: [
    <>Open <L href="https://discord.com/developers/applications">Discord Developer Portal</L> → <b>New Application</b> → <b>Bot</b> → <b>Reset Token</b> and copy it.</>,
    <>Invite the bot: <b>OAuth2 → URL Generator</b> → scope <code>bot</code>, permissions <b>View Channels, Send Messages, Read Message History</b> → open the URL and pick your server.</>,
    <>Paste the bot token below.</>,
  ] },
  x: { placeholder: "OAuth 2.0 user access token", steps: [
    <>Open the <L href="https://developer.x.com/en/portal/dashboard">X Developer Portal</L> → your app → <b>User authentication settings</b> (read + write).</>,
    <>Generate an <b>OAuth 2.0 user access token</b> with <code>tweet.read tweet.write users.read</code> and paste it below. Search needs an X API plan that includes it.</>,
  ] },
  weather: { placeholder: "32-character API key", steps: [
    <>Open <L href="https://home.openweathermap.org/api_keys">OpenWeather → API keys</L> (free account).</>,
    <>Copy a key and paste it below (new keys can take a few minutes to activate).</>,
  ] },
};

function StatusPill({ a }: { a?: IntegrationStatus }) {
  if (!a) return null;
  if (a.status === "connected") return <span className="inline-flex items-center gap-1 rounded-full bg-green px-3 py-1 text-xs font-bold text-onfill"><Check size={13} strokeWidth={3} /> Connected</span>;
  if (a.status === "connecting") return <span className="inline-flex items-center gap-1 rounded-full bg-yellow px-3 py-1 text-xs font-bold text-onfill"><LoaderCircle size={13} className="spin" /> Waiting</span>;
  if (a.status === "error") return <span className="inline-flex items-center gap-1 rounded-full bg-coral px-3 py-1 text-xs font-bold text-onfill"><CircleAlert size={13} /> Needs attention</span>;
  return <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-ink-3">Not connected</span>;
}

const Mark = ({ id, name }: { id: string; name: string }) => (
  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl font-display text-lg font-bold text-white ring-1 ring-line" style={{ background: COLORS[id] }} aria-hidden>{name.replace("Google ", "")[0]}</span>
);

function Note({ n }: { n: { ok: boolean; text: string } | null }) {
  return n ? <p role="status" className={`rounded-xl p-3 text-sm ${n.ok ? "bg-green/20" : "bg-coral/20"}`}>{n.text}</p> : null;
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
  return { ok: r.ok && j.ok !== false, text: j.detail ?? j.error ?? (r.ok ? "Done." : "That didn't work.") };
}

// ---------------------------------------------------------------- Google (one sign-in → 4 apps)
function GoogleCard({ apps, setup, reload }: { apps: IntegrationStatus[]; setup: { googleClientConfigured: boolean; redirectUri: string } | null; reload: () => void }) {
  const [cid, setCid] = useState(""), [secret, setSecret] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const g = apps.filter((a) => GOOGLE.includes(a.id));
  const anyPixr = g.some((a) => a.status === "connected" && a.via === "relay");
  const allConnected = g.length > 0 && g.every((a) => a.status === "connected");
  const account = g.find((a) => a.account)?.account;
  const configured = setup?.googleClientConfigured && !edit;

  const saveClient = async () => { setBusy("save"); const n = await post("/api/connect", { clientId: cid, clientSecret: secret }); setNote(n); setBusy(null); if (n.ok) { setEdit(false); setCid(""); setSecret(""); reload(); } };
  const test = async (id: string) => { setBusy(id); setNote(await post("/api/integrations", { id, action: "test" })); setBusy(null); };
  const disconnect = async () => { if (!confirm("Disconnect all Google apps (Calendar, Gmail, Drive, Meet, Docs, Sheets, Slides)?")) return; await fetch("/api/connect?id=google", { method: "DELETE" }); reload(); };

  return (
    <li className="card flex flex-col gap-5 p-6 md:col-span-2 xl:col-span-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex -space-x-2">{g.map((a) => <Mark key={a.id} id={a.id} name={a.name} />)}</div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-semibold">Google</h2>
          <p className="text-sm text-ink-3">One sign-in connects Calendar, Gmail, Drive, Meet, Docs, Sheets and Slides.{account && <> Signed in as <b className="text-ink-2">{account}</b>.</>}</p>
        </div>
        {allConnected ? <span className="inline-flex items-center gap-1 rounded-full bg-green px-3 py-1 text-xs font-bold text-onfill"><Check size={13} strokeWidth={3} /> All connected</span> : null}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {g.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-2xl border border-line p-3">
            <span className="font-bold">{a.name}</span>
            <span className="flex items-center gap-2">
              {a.status === "connected" && ["calendar", "gmail", "drive"].includes(a.id) && <button type="button" onClick={() => test(a.id)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-surface" aria-label={`Test ${a.name}`}>{busy === a.id ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}</button>}
              <StatusPill a={a} />
            </span>
          </li>
        ))}
      </ul>

      {!configured ? (
        <div className="rounded-2xl bg-surface p-5">
          <p className="font-bold">One-time setup (≈3 minutes) — your own Google sign-in for Pixr</p>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-ink-2">
            <li>Enable the APIs: <L href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">Calendar</L>, <L href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail</L>, <L href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Drive</L>, <L href="https://console.cloud.google.com/apis/library/meet.googleapis.com">Meet</L>, <L href="https://console.cloud.google.com/apis/library/docs.googleapis.com">Docs</L>, <L href="https://console.cloud.google.com/apis/library/sheets.googleapis.com">Sheets</L>, <L href="https://console.cloud.google.com/apis/library/slides.googleapis.com">Slides</L>.</li>
            <li><L href="https://console.cloud.google.com/auth/audience">OAuth consent screen</L> → External → add your own Google account under <b>Test users</b>.</li>
            <li><L href="https://console.cloud.google.com/apis/credentials/oauthclient">Create OAuth client ID</L> → type <b>Web application</b> → Authorized redirect URI:
              <span className="mt-1 flex items-center gap-2">
                <code className="rounded-lg bg-raised px-2 py-1 text-xs">{setup?.redirectUri ?? "…"}</code>
                <button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-raised" onClick={() => navigator.clipboard.writeText(setup?.redirectUri ?? "")} aria-label="Copy redirect URI"><Copy size={14} /></button>
              </span>
            </li>
            <li>Paste the Client ID and Client secret:</li>
          </ol>
          <form className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); saveClient(); }}>
            <label className="sr-only" htmlFor="gcid">Client ID</label>
            <input id="gcid" className="field" placeholder="…apps.googleusercontent.com" value={cid} onChange={(e) => setCid(e.target.value)} autoComplete="off" />
            <label className="sr-only" htmlFor="gsec">Client secret</label>
            <input id="gsec" className="field" type="password" placeholder="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
            <button className="btn btn-primary" disabled={!cid || !secret || Boolean(busy)}>{busy === "save" ? <LoaderCircle size={16} className="spin" /> : null} Save</button>
          </form>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/oauth/google/start" className="btn btn-primary">{anyPixr ? "Sign in again" : "Sign in with Google"}</a>
          {anyPixr && <button type="button" className="btn btn-outline" onClick={disconnect}><Unplug size={16} /> Disconnect Google</button>}
          <button type="button" className="link" onClick={() => setEdit(true)}>Change OAuth client</button>
        </div>
      )}
      <Note n={note} />
    </li>
  );
}

// ---------------------------------------------------------------- token apps
function TokenCard({ a, reload }: { a: IntegrationStatus; reload: () => void }) {
  const guide = GUIDES[a.id];
  const fields = guide.fields ?? [{ key: "token", label: guide.placeholder, secret: true }];
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const filled = fields.every((f) => vals[f.key]?.trim());
  const connect = async () => { setBusy("connect"); setNote(null); const n = await post("/api/connect", { id: a.id, ...vals }); setNote(n); setBusy(null); if (n.ok) { setVals({}); reload(); } };
  const test = async () => { setBusy("test"); setNote(await post("/api/integrations", { id: a.id, action: "test" })); setBusy(null); };
  const disconnect = async () => {
    if (!confirm(`Disconnect ${a.name}?`)) return;
    if (a.via === "swytchcode") await post("/api/integrations", { id: a.id, action: "disconnect" });
    else await fetch(`/api/connect?id=${a.id}`, { method: "DELETE" });
    reload();
  };
  const viaSwytchcode = async () => { setBusy("swy"); setNote(await post("/api/integrations", { id: a.id, action: "connect" })); setBusy(null); reload(); };

  return (
    <li className="card flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <Mark id={a.id} name={a.name} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold">{a.name}</h2>
          <p className="text-sm text-ink-3">{a.blurb}</p>
        </div>
        <StatusPill a={a} />
      </div>
      {a.status === "connected" ? (
        <>
          <p className="text-sm text-ink-2">{a.account && <>Account: <b>{a.account}</b> · </>}{a.via === "swytchcode" ? "via Swytchcode" : "connected in Pixr"}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline" onClick={test} disabled={Boolean(busy)}>{busy === "test" ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />} Test</button>
            <button type="button" className="btn btn-outline" onClick={disconnect}><Unplug size={16} /> Disconnect</button>
          </div>
        </>
      ) : (
        <>
          {a.detail && a.status === "error" && <p className="text-sm text-danger">{a.detail}</p>}
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); connect(); }}>
            {fields.map((f) => (
              <span key={f.key}>
                <label className="sr-only" htmlFor={`${a.id}-${f.key}`}>{a.name} {f.label}</label>
                <input id={`${a.id}-${f.key}`} type={f.secret ? "password" : "text"} className="field" placeholder={f.label} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} autoComplete="off" />
              </span>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" disabled={!filled || Boolean(busy)}>{busy === "connect" ? <><LoaderCircle size={16} className="spin" /> Checking…</> : "Connect"}</button>
              <button type="button" className="link px-2" onClick={viaSwytchcode} disabled={Boolean(busy)}>or via Swytchcode sign-in</button>
            </div>
          </form>
        </>
      )}
      <Note n={note} />
    </li>
  );
}

export default function AppsPage() {
  const [apps, setApps] = useState<IntegrationStatus[] | null>(null);
  const [setup, setSetup] = useState<{ googleClientConfigured: boolean; redirectUri: string } | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    fetch("/api/integrations?fresh").then((r) => r.json()).then(setApps).catch(() => setApps([]));
    fetch("/api/connect").then((r) => r.json()).then(setSetup).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const q = new URLSearchParams(location.search);
    if (q.get("connected") !== null) setBanner({ ok: true, text: q.get("partial") ? `Connected: ${q.get("connected") || "none"}. Some permissions weren't granted — sign in again and allow all.` : "Google connected: Calendar, Gmail, Drive, Meet, Docs, Sheets and Slides." });
    if (q.get("error")) setBanner({ ok: false, text: q.get("error")! });
    if (q.size) history.replaceState(null, "", "/apps");
  }, [load]);

  useEffect(() => {
    if (!apps?.some((a) => a.status === "connecting")) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [apps, load]);

  const connected = apps?.filter((a) => a.status === "connected").length ?? 0;

  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <h1 className="display text-[clamp(40px,6vw,64px)] lowercase">connect your apps</h1>
        <p className="mt-3 max-w-2xl text-ink-2">Every connection is checked live with a real read-only call. Tokens are encrypted on this machine and never sent to your browser. {apps && <b>{connected} of {apps.length} connected.</b>}</p>
        {banner && <div className="mt-4"><Note n={banner} /></div>}
        {apps === null ? (
          <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 5 }).map((_, i) => <li key={i} className="card h-48 animate-pulse" />)}</ul>
        ) : (
          <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <GoogleCard apps={apps} setup={setup} reload={load} />
            {apps.filter((a) => !GOOGLE.includes(a.id)).map((a) => <TokenCard key={a.id} a={a} reload={load} />)}
          </ul>
        )}
      </div>
    </Shell>
  );
}
