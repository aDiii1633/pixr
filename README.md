# Pixr — voice action agent

Tell it what you want. It plans the work, asks only for what's missing, acts through Swytchcode (Google Calendar, Meet, Gmail, Drive, Docs, Sheets, Slides, Slack, Notion, GitHub, Zoom, Discord, X, OpenWeather), checks each result, and answers by voice.

## Run locally

Requires Node 20+ (tested on 24) and Windows/macOS/Linux.

```bash
npm install
npm run setup      # asks for your Groq key once → saves it to .env.local (git-ignored)
npm run dev        # http://localhost:3000
```

- **Groq**: the key goes in `GROQ_API_KEY`; the model is `GROQ_MODEL` (default `openai/gpt-oss-120b`). See `env.example`.
- **Connect apps** on **/apps**: one Google sign-in (Calendar, Gmail, Drive, Meet, Docs, Sheets, Slides), Zoom Server-to-Server credentials, and token paste for Slack, Notion, GitHub, Discord, X and OpenWeather. Each is verified live and stored encrypted on this machine (`data/`).
- **Voice**: say **“Hey Pixr”** (Chrome/Edge/Safari, tab visible, mic allowed) or tap the mic. Follow-up questions keep the mic on.
- **Swytchcode CLI** is optional locally (`npx swytchcode login`); Pixr falls back to the same Swytchcode method definitions with your own connections.
- **Reset**: delete the `data/` folder (connections, memory, history).
- **Production build**: `npm run build && npm start`.

## Docs
`PRD.md` · `ARCHITECTURE.md` · `AGENT_WORKFLOW.md` · `MEMORY_CONTEXT.md` · `INTEGRATIONS.md` · `UI_UX.md` · `IMPLEMENTATION_PLAN.md`
