# ⚡ Flex AiPliz

A free, self-hosted AI assistant built with **Agno** (formerly Phidata) + FastAPI.
Sleek dark chat UI, markdown replies, per-session memory. Runs 100% on free tiers.

## Live in 5 minutes

1. **Groq API key** (free, no card): https://console.groq.com/keys
2. **Deploy on Render**: click the button below, paste your Groq key when asked.

   [![Deploy to Render](https://render.com/images/deploy-button.svg)](https://render.com/deploy?repo=https://github.com/Brendon710/flex-aipliz)

   *(No card needed — free plan. First load after idle takes ~1 min, that's Render waking it up.)*

3. **Add to your website**:

```html
<iframe src="https://flex-aipliz.onrender.com"
        style="width:100%;height:640px;border:none;border-radius:16px"></iframe>
```

## Switch model providers (all have free tiers)

Set the `FLEX_LLM` env var:

| Provider | `FLEX_LLM` | Key needed | Default model |
|---|---|---|---|
| Groq (default, fastest) | `groq` | `GROQ_API_KEY` | `openai/gpt-oss-120b` |
| Google Gemini | `gemini` | `GOOGLE_API_KEY` | `gemini-2.0-flash` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `meta-llama/llama-3.3-70b-instruct:free` |

Override the model with `FLEX_MODEL`.

## Run locally

```bash
pip install -r requirements.txt
export GROQ_API_KEY=gsk_...
uvicorn app:app --port 7860
# open http://localhost:7860
```

## Files

- `app.py` — FastAPI server + Agno agent (chat history, markdown, provider switching)
- `static/index.html` — the Flex AiPliz UI
- `Dockerfile` — container used by Render
- `render.yaml` — Render blueprint (auto-configures the service)

Built by Brendon Pikirai · Vibes ecosystem ⚡
