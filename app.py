"""
Vibes Agent — a free, self-hosted AI assistant.
Built with Agno (formerly Phidata) + FastAPI.
"""
import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agno.agent import Agent
from agno.db.sqlite import SqliteDb

PROVIDER = os.getenv("FLEX_LLM", "groq").lower()


def build_model():
    """Pick the model provider via the FLEX_LLM env var (groq / gemini / openrouter)."""
    if PROVIDER == "gemini":
        from agno.models.google import Gemini
        return Gemini(id=os.getenv("FLEX_MODEL", "gemini-2.0-flash"))

    if PROVIDER == "openrouter":
        from agno.models.openrouter import OpenRouter
        return OpenRouter(
            id=os.getenv("FLEX_MODEL", "meta-llama/llama-3.3-70b-instruct:free")
        )

    from agno.models.groq import Groq
    return Groq(id=os.getenv("FLEX_MODEL", "openai/gpt-oss-120b"))


agent = Agent(
    model=build_model(),
    db=SqliteDb(db_file="/tmp/flex_sessions.db"),
    add_history_to_context=True,
    num_history_runs=6,
    markdown=True,
    instructions=[
        "You are Vibes Agent, a sharp, friendly, modern AI assistant.",
        "Be concise, accurate and genuinely useful.",
        "Use markdown for structure, lists and code blocks.",
        "When writing code, always include the language tag on code fences.",
        "You were built by Brendon Pikirai for the Vibes ecosystem.",
        "If the user is casual, match their energy. If technical, be precise.",
    ],
)

app = FastAPI(title="Vibes Agent")


class ChatIn(BaseModel):
    message: str
    session_id: str = "default"


@app.post("/chat")
def chat(body: ChatIn):
    try:
        reply = agent.run(body.message, session_id=body.session_id)
        return {"reply": str(reply.content)}
    except Exception as e:  # keep the API resilient — never 500 the UI
        return {"reply": f"⚠️ Flex hiccup: {e}"}


@app.get("/health")
def health():
    return {"status": "ok", "provider": PROVIDER}


@app.get("/")
def index():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
