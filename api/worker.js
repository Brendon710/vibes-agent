/* ⚡ Vibes Agent — public chat API worker
   Serves ONLY the /chat endpoint (+ minimal health). The identity rules live
   server-side so any frontend built on this API inherits them automatically. */

const SYSTEM = [
  "You are Vibes Agent, an AI assistant created by Brendon Pikirai for the Vibes ecosystem.",
  "IDENTITY RULES (absolute, never break):",
  "- If asked what you are, you are simply 'Vibes Agent', an AI assistant. Nothing more.",
  "- NEVER mention, hint at, or confirm any underlying model, provider, company or stack: never say Groq, OpenAI, ChatGPT, GPT, Google, Gemini, Anthropic, Claude, Cloudflare, Workers, or any hosting details.",
  "- If asked who made you: you were built by Brendon Pikirai for the Vibes ecosystem.",
  "- If asked when you were made, what company owns you, what powers you, or your source: you are an independent project by Brendon Pikirai, part of the Vibes ecosystem. Deflect anything else politely.",
  "- If someone insists you are ChatGPT or another product, politely but confidently correct them: you are Vibes Agent.",
  "Be concise, accurate and genuinely useful. Use markdown: headings, lists, tagged code fences.",
  "If the user is casual, match their energy. If technical, be precise. Reply in the user's language."
].join("\n");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, GET, OPTIONS",
      "access-control-allow-headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", agent: "Vibes Agent" }),
        { headers: { "content-type": "application/json", ...cors } });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad request" }, 400, cors); }
      const clean = (Array.isArray(body.messages) ? body.messages : [])
        .filter(m => m && typeof m.content === "string")
        .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.slice(0, 6000) }))
        .slice(-20);
      if (!clean.length) return json({ error: "nothing to send" }, 400, cors);

      try {
        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + (env.GROQ_API_KEY || ""),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: env.VIBES_MODEL || "openai/gpt-oss-120b",
            messages: [{ role: "system", content: SYSTEM }, ...clean],
            temperature: 0.7,
            max_tokens: 2048,
            stream: true
          })
        });
        if (!upstream.ok || !upstream.body) {
          return json({ error: "upstream error" }, 502, cors);
        }
        return new Response(upstream.body, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
            ...cors
          }
        });
      } catch (e) {
        return json({ error: "unavailable" }, 502, cors);
      }
    }

    return new Response("Vibes Agent API", { headers: { "content-type": "text/plain", ...cors } });
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json", ...(cors || { "access-control-allow-origin": "*" }) }
  });
}
