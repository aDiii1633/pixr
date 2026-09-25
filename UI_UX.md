# UI_UX — Pixr interface specification

> Primary visual source: the supplied reference (the "nunito — bring a team together" landing page). Synced with PRD F1/F6/F9–F13, ARCHITECTURE §4–5 (SSE events), AGENT_WORKFLOW §7 (input hints) — 2026-09-25.
> Supporting guidance: `ui-ux-pro-max` design-system query ("AI voice assistant productivity playful vibrant soft 3D"). It returned the **Claymorphism / soft-3D** style (double shadows, 16–24 px radii, chunky and playful) and the rules: SVG icons not emoji, 4.5:1 contrast, visible focus, reduced motion, 44 px targets. Its suggested orange palette was **rejected** because the reference's palette is authoritative.

## ⚡ Update (2026-09-25)
- **Visual system (2026-09-25):** white only, black ink, reference orange (`#ff4f14` fills, `#cc3a0c` text/links). Home hero = stacked orange capsules whose widgets are the real controls (mic, hands-free, type, apps), plus a live status bubble, logo row of connected apps and a stats bar with the LIVE wake-word badge. It fits one screen.
- **Wake word chip:** under the dock: "Say “Hey Pixr”" (green pulse while armed), "Turn on “Hey Pixr”" (one tap when mic permission hasn't been granted yet), or a denied notice. Hidden where the browser has no speech recognition (Settings explains).
- **No-speech notice:** after 10 s of silence on a follow-up, a soft line plus voice: "I didn't hear anything. You can speak whenever you're ready." → IDLE, with the question card still answerable.

## 1. Reference analysis → what we keep

| Reference element | Observed | Pixr translation (functional, not decorative copy) |
|---|---|---|
| Canvas | Lavender/periwinkle full-bleed background; a large off-white rounded "sheet" (≈28–32 px radius) inset ~60 px holds the entire page | Same **AppFrame** on desktop/tablet. Mobile: sheet goes full-bleed, lavender only in the status-bar area and behind bottom sheets. |
| Nav | Blue speech-bubble logo + bold lowercase wordmark, thin vertical divider, 13–14 px semibold nav items with chevrons, count badge in yellow pill; right: text "Login", outlined pill "Sign up" | Logo "relay" (blue speech-bubble + waveform glyph), same divider/items: **Home · History · Apps · Settings**. The yellow count badge = **pending confirmations / needs-attention count**. The right side has an app-health dot + an outlined pill "New conversation". |
| Hero headline | Huge (~110 px), heavy, tight-tracked, lowercase, ink colour; three staggered lines; **inline UI "widgets" set at type size** between words | IDLE-state hero: **"tell me — what you want · i'll do it"** in three staggered lines, with the inline widgets as the *real controls* (below). Collapses when a task starts. |
| Blue→pink gradient pill with white glossy knob + circular dial | Toggle-like, with a thin blue progress arc | **VoiceOrb** = primary mic control. The knob position and arc encode state (§6). |
| Green circle with → | Action / go | **Send / Run** (submit typed text; "Try again"). Becomes ✓ on SUCCESS. |
| Yellow circle with frosted "—" pill | Soft, secondary | **ASKING** accent (the agent needs something) and the hands-free "minimize" chip. |
| Outline pill with green knob | Toggle | **Hands-free** switch (auto re-open mic after questions). |
| Purple→pink + sky-blue overlapping circles with frosted "⌘" keycap | Keyboard hint | **Shortcut hint** "⌘K / Ctrl K" that opens the command window. Also appears on the History "re-run" action. |
| Black dashed connectors with blue nodes, ending in a blue cursor arrow | Flow between elements | **ExecutionTimeline**: a dashed path connecting step nodes, drawn as steps complete; the cursor arrow marks the current step. |
| 4-point sparkles (green, yellow, royal blue, sky) | Decoration | Decorative only (`aria-hidden`), max 4 per screen, static under reduced motion. |
| Centered 17–18 px subtext, dark CTA pill "Try it for free", underlined small link | Primary/secondary CTA hierarchy | Primary = **dark ink pill** (Confirm, Connect, Save). Secondary = outlined pill. Tertiary = underlined text link ("Type instead", "See details"). |
| Grayscale partner-logo row | Social proof | **Connected apps row**: brand-coloured when connected, grayscale at 45% when not. Tap → Apps page. |
| Glossy 3D emoji | Personality | **Not used as UI** (no emoji icons). Personality comes from the orb and motion. The emoji in body copy may be dropped entirely. |

## 2. Design tokens

### Colour (light theme; sampled from the reference, adjusted for contrast)
```css
:root{
  --canvas:#BBB9FC;        /* lavender page background */
  --surface:#F8F8FB;       /* main sheet */
  --surface-raised:#FFFFFF;/* cards, sheets */
  --glass:rgba(255,255,255,.72); /* frosted pills (backdrop-filter: blur(12px)) */
  --ink:#1C1B22;           /* headlines, primary text, dark CTA */
  --ink-2:#3E3D48;         /* body / nav */
  --ink-3:#6B6A77;         /* secondary text (≥4.5:1 on --surface) */
  --line:#DCDBE4;          /* borders, outline pills */
  --blue:#3563F0;          /* brand, links, nodes, focus (4.9:1 on white) */
  --blue-soft:#9DCBFA;     /* sky circle */
  --green:#5BC476;         /* success fill (ink text on it) */
  --yellow:#FFC83D;        /* asking / badge fill (ink text on it) */
  --violet:#9B6BF2; --pink:#F27BAA;
  --coral:#F2766B;         /* error fill (ink text); never pure red except destructive */
  --danger:#C8322B;        /* destructive confirm text/border only */
  --orb-gradient:linear-gradient(100deg,#3563F0 0%,#6C5CF2 45%,#C77BE0 75%,#F27BAA 100%);
  --pair-gradient:linear-gradient(135deg,#9B6BF2,#F27BAA);
}
```
- Status colours are **always paired with an icon + label** (never colour alone).
- Dark theme: out of MVP scope (the reference is light-only). Tokens are structured so a `[data-theme=dark]` block can be added later.

### Typography
| Role | Font | Size / line-height / tracking | Weight |
|---|---|---|---|
| Display (hero) | **Outfit** (geometric, matches the reference headline's round `g`, `a`) | `clamp(52px, 9vw, 112px)` / 0.95 / -0.035em, lowercase | 700 |
| H1 (page) | Outfit | 40 / 1.1 / -0.02em | 700 |
| H2 | Outfit | 28 / 1.2 / -0.01em | 600 |
| H3 / card title | Outfit | 20 / 1.3 | 600 |
| Body | **Nunito Sans** | 16 / 1.55 | 400 |
| Body-lg (agent reply, subtext) | Nunito Sans | 18 / 1.5 | 400 |
| Label / nav / button | Nunito Sans | 14 / 1.2 | 700 |
| Caption | Nunito Sans | 12 / 1.4 (minimum size anywhere) | 600 |
Loaded with `next/font/google` (self-hosted, `display: swap`).

### Space, radius, elevation
- Spacing scale (4 px base): 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Radius: sheet 32 · card 24 · bottom sheet 28 (top corners) · input 14 · pill/button 999 · orb knob 50%.
- Elevation:
  - `--shadow-1: 0 1px 2px rgba(28,27,34,.06), 0 6px 18px rgba(28,27,34,.06)` (cards)
  - `--shadow-glass: inset 0 1px 0 rgba(255,255,255,.9), 0 14px 34px rgba(53,99,240,.18)` (knobs, frosted pills: the reference's soft 3D look)
  - `--shadow-sheet: 0 -8px 40px rgba(28,27,34,.14)`
- Dashed connector: `stroke: var(--ink); stroke-width: 4; stroke-dasharray: 10 10; stroke-linecap: round`. Nodes are 14 px blue circles with a 3 px white ring.

### Icons
`lucide-react`, 20 px (24 px in nav), stroke 2. Integration marks are the official brand SVGs (monochrome when disconnected). No emoji as icons.

## 3. Screens

### 3.1 Home — "Talk to your agent" (`/`)
**Desktop (≥1024)**, inside AppFrame:
```
┌ nav ─────────────────────────────────────────────────────────────┐
│ ◖relay │ Home  History  Apps  Settings ②        ● all good  (New conversation) │
├──────────────────────────────────────────────────────────────────┤
│   IDLE:   tell me ( → )(═══gradient orb═══◯)                       ✦             │
│           ( — )what you want ( ○━● hands-free )  ┄┄┄┄┄┄┄┄➤                        │
│              ( ⌘K )  i'll do it                                                  │
│      "Speak or type a goal. I'll plan it, ask what's missing, and do it."       │
│      [ Check my 5–7 PM ] [ Schedule a meeting ] [ Schedule a Zoom call ] [ Triage GitHub ] │
│      Calendar ◉  Gmail ◉  Slack ◉  Notion ◉  Drive ◉  GitHub ○  Zoom ○  Meet ◉  │
└──────────────────────────────────────────────────────────────────┘
ACTIVE (after first utterance): hero collapses into a 56 px orb bar at top-center;
  left/center column (max 720): conversation stage (user transcript + agent lines + Ask/Outcome cards)
  right rail (320, ≥1280; below the stage otherwise): ExecutionTimeline for the current task
  input dock at bottom: [⌨ type field ……] (● orb) (→ send)
```
**Mobile (<768)**: full-bleed surface; header (logo, status dot, "new" icon button). The stage fills the screen. A **bottom dock** holds a 72 px VoiceOrb centered, a keyboard toggle (48 px) on the left and the timeline toggle on the right. Bottom nav (Home, History, Apps, Settings) sits below the dock with safe-area padding. The hero on mobile is 2 lines ("tell me what / you want") at 52 px, with the inline orb moved into the dock. The timeline opens as a **bottom sheet** (peek height 96 px showing the current step).

### 3.2 Floating command window (desktop, every page)
- Trigger: floating orb button (64 px, bottom-right, 24 px inset) or **Ctrl/⌘ K**. Space held inside the window = push-to-talk.
- Panel: 420 × up-to-640 px, radius 24, `--surface-raised`, `--shadow-sheet`, anchored bottom-right. It doesn't block the page and is closed with Esc. It shows the same stage (compact), timeline (collapsed to the current step) and confirm/ask cards.
- The same session as Home (shared `sessionId`), so a task started on Home can be confirmed from History.

### 3.3 Apps (`/apps`)
Grid of **IntegrationTile** (desktop 3 columns, tablet 2, mobile 1): brand mark, name, transport tag (`via Swytchcode` / `Direct` / `via Calendar`), status pill, account label (e.g. `you@gmail.com`), last checked time, permission summary (e.g. "Read events · Create events"), and actions:
- `not_connected` → dark pill **Connect** (local host: runs `swy auth connect` → the browser opens; the tile polls every 3 s for up to 2 min). On a hosted server, show the exact CLI instruction (see D-02).
- `connected` → outlined **Disconnect** (confirm dialog) + **Test** (re-runs the probe).
- `expired`/`error` → coral pill + **Reconnect**, with the human message.
- `unavailable` (e.g. a provider whose sign-in is down) → grey pill + reason + "What's needed" link. **Never** a fake "Connected".

### 3.4 History (`/history`)
Reverse-chronological list; each **HistoryRow**: request text (first line), relative time, tool chips (brand marks with ✓/✕), status pill (Completed / Failed / Cancelled / Waiting for you), result link(s). Tapping opens the **HistoryDetail** drawer (desktop right drawer 480 px / mobile full sheet): full timeline with evidence links, errors in plain language, "Run again" (prefills the request), "Resume" if `asking`/`awaiting_confirmation`. Filters: All · Needs you · Failed. Empty state: sparkle illustration + "Your finished tasks will show up here."

### 3.5 Settings (`/settings`)
Sections (single column, max 640):
1. **Profile**: name, email, timezone (searchable select, default from the browser).
2. **Scheduling**: default meeting duration (15/30/45/60/custom), work hours (two `<input type=time>`).
3. **Communication**: preferred channel (Email/Slack segmented control), default Slack channel, default GitHub repo, default Notion parent page.
4. **Safety**: "Confirm low-risk actions too" toggle. High-risk confirmation is shown as *always on* (disabled toggle with an explanation).
5. **Voice**: hands-free follow-ups, speech rate, voice (from `speechSynthesis.getVoices()`), "Speak responses" toggle.
6. **Memory**: contacts and facts list with source/date, edit/delete, "Delete all memory", "Delete conversation history" (MEMORY_CONTEXT §8).

### 3.6 Login (`/login`)
Hero-style: the sheet shows "hey, it's you?" at display size, a passcode field, and a dark "Unlock" pill. Rate-limited; generic error text.

## 4. Components

| Component | Notes |
|---|---|
| `AppFrame` | Lavender canvas + surface sheet (desktop/tablet); full-bleed on mobile. |
| `TopNav` / `BottomNav` | Per §1. BottomNav 64 px + safe area; active item = ink pill background with white icon+label. |
| `VoiceOrb` | Gradient pill (desktop hero 220×110; dock 72 px circle variant) + glossy knob + `LevelRing` (SVG arc) + `Waveform` (5 bars). `role="button"`, `aria-pressed`, dynamic `aria-label`. |
| `HeroHeadline` | Staggered 3-line headline with inline widgets as real controls; `h1` text is readable by screen readers as one sentence ("Tell me what you want, I'll do it"). Widgets are separate focusable controls placed after the heading in DOM order. |
| `TranscriptLine` | User utterance (right-aligned ink text on white card, mic/keyboard glyph), with a live interim transcript in `--ink-3` italic while LISTENING. |
| `AgentLine` | Body-lg text with a small orb avatar; matches the spoken text exactly. |
| `AskCard` | Yellow left accent. Question (H3) + input by `inputHint`: `email` → text input `type=email` + parsed echo "rahul@acme.com ✓"; `choice` → chip group (radio semantics); `date`/`time` → native inputs; always "Answer by voice" orb button. |
| `ConfirmSheet` | Mobile bottom sheet / desktop centered card 520 px. Title ("Send this email to Rahul?"), preview rows (To, Subject, first 3 lines of body; or When, Who, Meet), source flags ("Email found in your Gmail"), buttons: **dark "Send" / "Create"** (verb-specific), outlined **Edit**, text **Cancel**. Destructive (cancel event) uses a `--danger` outline + label "Cancel event". |
| `ExecutionTimeline` | Vertical on the rail/sheet: node + label + status icon (pending ○, running spinner arc, done ✓ green, failed ✕ coral, needs input ? yellow, skipped –). A dashed connector between nodes draws in as steps finish; the cursor arrow is on the running node. The evidence link opens in a new tab. |
| `OutcomeCard` | On `final`: headline sentence, list of outcomes with evidence (Open event, Join Meet, View email, Open issue) and a memory proposal chip ("Save Rahul's email"). |
| `QuickActionChip` | Outlined pills with an icon; inserts and runs the phrase. |
| `IntegrationTile`, `StatusPill`, `HistoryRow`, `Toast`, `Sparkle` | As described in §3. |

## 5. Interaction states (global)

| State | Orb | Stage | Live region text |
|---|---|---|---|
| **IDLE** | Knob right, slow 4 s "breathing" glow | Hero (first run) or last outcome | – |
| **LISTENING** | Knob slides left (220 ms); blue LevelRing follows mic RMS; gradient shimmer | Interim transcript (if Web Speech available), elapsed timer, "Release to send / tap to stop" | "Listening" |
| **THINKING** (transcribing + planning) | Knob centre, indeterminate arc spinner | Final transcript shown; "Understanding…" line | "Working on it" |
| **EXECUTING** | Arc spinner + small tool glyph of the current integration in the knob | Timeline steps update ("Checking Google Calendar…") | Step labels (polite) |
| **ASKING** | Knob yellow ring; auto-listen after TTS if hands-free | AskCard | The question (assertive) |
| **CONFIRMATION** | Knob paused (static) | ConfirmSheet; background dimmed 40% on mobile | "Confirmation needed: …" (assertive) |
| **SPEAKING** | 5-bar Waveform inside the knob (animated by `speechSynthesis` boundary events; fallback: gentle loop) | AgentLine highlights | – (text already visible) |
| **SUCCESS** | Green ✓ knob for 1.5 s → IDLE | OutcomeCard | Final sentence |
| **ERROR** | Coral knob with "!" (no shaking) | Error line in plain language + next action button (Reconnect / Try again / Type instead) | Error text (assertive) |

Barge-in: tapping the orb while SPEAKING stops TTS and starts LISTENING.

## 6. Motion

- Durations: micro 150 ms, standard 220 ms, sheet enter 320 ms (spring, damping 28), exit = 70% of enter. Easing `cubic-bezier(.2,.8,.2,1)`.
- Only `transform`/`opacity` are animated (no width/height). The LevelRing uses the SVG `stroke-dashoffset` updated from `requestAnimationFrame`, sampling analyser RMS at most every 50 ms.
- Timeline connector: each segment draws over 400 ms when its step completes.
- Hero → active collapse: headline translates up + scales to 0.4 and fades out (320 ms); the stage fades in with a 40 ms stagger per element.
- `prefers-reduced-motion: reduce`: no breathing/shimmer/draw-in; state changes are instant cross-fades (≤100 ms); the LevelRing becomes a stepped 3-level indicator.

## 7. Responsive rules

| Breakpoint | Layout |
|---|---|
| < 480 (phones) | Full-bleed, bottom dock + bottom nav, sheets for ask(choice)/confirm/timeline, hero 2 lines 52 px |
| 480–767 | Same, stage max 560 centred |
| 768–1023 (tablet) | AppFrame with 16 px canvas inset; top nav; timeline below stage; confirm as centred card |
| 1024–1279 | AppFrame 24 px inset; floating command window available |
| ≥ 1280 | AppFrame 40–60 px inset; timeline right rail |
No horizontal scroll at any width. Tested at 375, 768, 1024, 1440. The viewport meta allows zoom.

## 8. Mobile UX specifics

- The mic target is 72 px, placed within thumb reach (bottom centre); every other target is ≥ 44 px with ≥ 8 px spacing.
- **Hold-to-talk and tap-to-toggle** are both supported. A short tap (<250 ms) toggles, a long press is push-to-talk.
- Bottom sheets: drag handle, swipe-down to dismiss (except the ConfirmSheet, which needs an explicit button, so there are no accidental cancels or sends).
- Keyboard-first answers for emails: AskCard `inputHint:'email'` focuses a text field with `inputmode="email"`, `autocomplete="email"`.
- PWA: `display: standalone`, theme colour `#BBB9FC`, maskable icon (orb). A wake lock is held while LISTENING/SPEAKING (Screen Wake Lock API, where supported).
- Haptics (`navigator.vibrate(10)`) on listen start/stop and confirm, where supported.

## 9. Desktop UX specifics

- Global shortcuts: **Ctrl/⌘ K** toggle command window · **Space** (when the orb or window is focused) push-to-talk · **Esc** close window / cancel listening · **Enter** submit typed text · **Alt+↑** re-run the last request into the input.
- The underlying page is never lost: the command window is non-modal (except when a ConfirmSheet is shown inside it, which is modal to the window only).

## 10. Accessibility

- Contrast: all text ≥ 4.5:1 (large display text ≥ 3:1). Green/yellow/coral are fills with ink text only.
- Focus: 3 px `--blue` outline with 2 px offset on every interactive element; never removed.
- Screen readers: one `aria-live="polite"` status region (state + step labels), one `aria-live="assertive"` region (questions, confirmations, errors). The orb has a dynamic `aria-label`: "Start listening" / "Stop listening" / "Stop speaking".
- ConfirmSheet: `role="dialog"`, `aria-modal`, focus trapped, **initial focus on the dialog title** (not on "Send", to prevent accidental Enter), Esc = Cancel, and focus is restored on close.
- Timeline: an ordered list; each item's status is announced in text ("done", "failed").
- Captions: everything spoken is also shown as text. TTS can be turned off.
- Mic permission: a pre-prompt card explains why before the browser prompt. Denied → a card with browser-specific re-enable steps + "Type instead". Unsupported (no `MediaRecorder`) → typing mode only, with a notice.

## 11. Loading / error / success / empty patterns

| Situation | Pattern |
|---|---|
| Page load | Skeletons for tiles/rows (shimmer disabled under reduced motion); the orb renders immediately |
| STT in flight | THINKING orb + "Transcribing…" (≤ 1.5 s typical) |
| Empty speech / no speech detected | Gentle line: "I didn't catch that. Try again or type it." Orb returns to IDLE |
| Integration not connected (mid-task) | Inline card: "{App} isn't connected" + Connect button; the task waits in `failed/resumable` |
| Tool failure | Timeline step ✕ + plain message + action; the final line honestly lists what succeeded and what didn't |
| Network offline | Top banner "You're offline. I'll be back when you are." Orb disabled |
| Success | OutcomeCard with evidence links + green ✓ orb |
| Empty history / memory | Friendly one-liner + sparkle; memory empty state explains how to save things by voice |

## 12. UI pre-delivery checklist
- [ ] No emoji icons; lucide + brand SVGs only
- [ ] `cursor: pointer` + hover/pressed states (150–220 ms) on all clickables
- [ ] Contrast ≥ 4.5:1 checked for `--ink-3`, `--blue` links, status pills
- [ ] Visible focus everywhere; keyboard-only run of Demo 1 works
- [ ] `prefers-reduced-motion` honoured
- [ ] 375 / 768 / 1024 / 1440 screenshots, no horizontal scroll
- [ ] All 9 orb states reachable and announced
