# Pixr — voice action agent

Tell it what you want. It plans the work, asks only for what's missing, acts through Swytchcode (Google Calendar, Meet, Gmail, Drive, Docs, Sheets, Slides, Slack, Notion, GitHub, Zoom, Discord, X, OpenWeather), checks each result, and answers by voice.

## Run locally

```bash
npm install
cp env.example .env.local   # then set GROQ_API_KEY (and optionally GROQ_MODEL)
npm run dev                 # http://localhost:3000
```

- Connect apps on **/apps**: one Google sign-in (Calendar, Gmail, Drive, Meet, Docs, Sheets, Slides), Zoom Server-to-Server credentials, and token paste for Slack, Notion, GitHub, Discord, X and OpenWeather. Each is verified live and stored encrypted on this machine.
- Voice: say **“Hey Pixr”** (Chrome/Edge/Safari, tab visible) or tap the orb. Follow-up questions keep the mic on.
- Local use needs the Swytchcode CLI session: `npx swytchcode login` (once).
- Data lives in `data/` (SQLite). Delete that folder to reset.

## Docs
`PRD.md` · `ARCHITECTURE.md` · `AGENT_WORKFLOW.md` · `MEMORY_CONTEXT.md` · `INTEGRATIONS.md` · `UI_UX.md` · `IMPLEMENTATION_PLAN.md`
