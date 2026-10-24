# ⚡ Vibes Agent

Free, always-on AI assistant by Brendon Pikirai. Two parts:

- **Website** — `worker.js` (Cloudflare Worker, streaming chat over Groq `openai/gpt-oss-120b`)
  Live: https://vibes-agent.vibes-host.workers.dev
- **Telegram bot** — `telegram/bot.js` (new bot config: Gemini `gemini-2.5-flash` with Groq fallback, KV memory)
  Live on the `freetools-bot` worker slot; webhook at `/telegram`. The old VPN ops bot it replaced is backed up as worker `freetools-bot-legacy` (dormant).

## Website embed
```html
<iframe src="https://vibes-agent.vibes-host.workers.dev"
        style="width:100%;height:640px;border:none;border-radius:16px"></iframe>
```

## Python version (backup for a future VPS)
`app.py` + `static/` — Agno + FastAPI. Deploy with `requirements.txt` + `Dockerfile`/`render.yaml`.

Built for the Vibes ecosystem ⚡
