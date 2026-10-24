# ⚡ Vibes Agent

Free, always-on AI assistant by Brendon Pikirai. Two runtimes, same agent:

- **`worker.js`** — Cloudflare Workers version (currently live, free tier, no card, no sleeping)
  Live at: https://vibes-agent.vibes-host.workers.dev
- **`app.py` + `static/`** — Python version (Agno + FastAPI) for Render or your own VPS later

## How it works
Worker serves the UI and proxies chat to Groq (`openai/gpt-oss-120b`, free tier).
Groq key is a Worker secret. Conversation history lives in the visitor's browser (localStorage), sent with each request — no server storage, no KV needed.

## Deploy / update the Worker
Needs Cloudflare API key + account. See `deploy.py` (upload script with secret binding).

## Add to your website
```html
<iframe src="https://vibes-agent.vibes-host.workers.dev"
        style="width:100%;height:640px;border:none;border-radius:16px"></iframe>
```

## Get a Groq key
https://console.groq.com/keys (free, no card)

Built for the Vibes ecosystem ⚡
