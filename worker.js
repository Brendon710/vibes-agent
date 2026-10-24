/* ⚡ Vibes Agent — free AI assistant on Cloudflare Workers
   Chat backend proxies Groq (OpenAI-compatible API). No card, no sleep. */

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vibes Agent</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#9889;</text></svg>">
<style>
  :root {
    --bg: #0b0d14; --panel: #12151f; --panel2: #181c29;
    --border: #232840; --text: #e8eaf2; --dim: #8a90a6;
    --grad: linear-gradient(135deg, #7c3aed, #06b6d4);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
  header { display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; background: rgba(18,21,31,.85); backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 34px; height: 34px; border-radius: 10px; background: var(--grad);
    display: flex; align-items: center; justify-content: center; font-size: 18px;
    box-shadow: 0 0 18px rgba(124,58,237,.45); }
  .brand h1 { font-size: 17px; font-weight: 700; letter-spacing: .3px; }
  .brand h1 span { background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .brand small { display: block; color: var(--dim); font-size: 10px; font-weight: 400; }
  #newChat { background: var(--panel2); color: var(--text); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; transition: .2s; }
  #newChat:hover { border-color: #7c3aed; }
  #chat { flex: 1; overflow-y: auto; padding: 24px 16px 8px;
    display: flex; flex-direction: column; gap: 14px; scroll-behavior: smooth; }
  .msg { max-width: 78%; padding: 12px 16px; border-radius: 16px; line-height: 1.55;
    font-size: 14.5px; animation: pop .25s ease; word-wrap: break-word; }
  @keyframes pop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; } }
  .user { align-self: flex-end; background: var(--grad); border-bottom-right-radius: 4px; }
  .bot { align-self: flex-start; background: var(--panel2); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
  .msg pre { background: #0d1017; border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; margin: 10px 0; overflow-x: auto; font-size: 13px; }
  .msg code { font-family: 'Cascadia Code', Consolas, monospace; }
  .msg p { margin: 6px 0; } .msg ul, .msg ol { margin: 6px 0 6px 20px; }
  .msg a { color: #38bdf8; }
  .welcome { text-align: center; margin: auto; color: var(--dim); }
  .welcome .big { font-size: 42px; margin-bottom: 12px; font-weight: 800;
    background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 18px; }
  .chips button { background: var(--panel2); border: 1px solid var(--border); color: var(--dim);
    border-radius: 20px; padding: 8px 14px; font-size: 12.5px; cursor: pointer; transition: .2s; }
  .chips button:hover { color: var(--text); border-color: #06b6d4; }
  #typing { align-self: flex-start; display: none; padding: 0 16px; }
  .dots { display: flex; gap: 5px; padding: 14px 18px; background: var(--panel2);
    border: 1px solid var(--border); border-radius: 16px; border-bottom-left-radius: 4px; }
  .dots i { width: 7px; height: 7px; border-radius: 50%; background: #8a90a6; animation: bounce 1.2s infinite; }
  .dots i:nth-child(2) { animation-delay: .2s; } .dots i:nth-child(3) { animation-delay: .4s; }
  @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
  footer { padding: 14px 16px 18px; border-top: 1px solid var(--border); background: var(--panel); }
  .inputrow { display: flex; gap: 10px; max-width: 860px; margin: 0 auto; }
  #input { flex: 1; background: var(--panel2); border: 1px solid var(--border); border-radius: 12px;
    padding: 13px 16px; color: var(--text); font-size: 14.5px; outline: none; resize: none;
    font-family: inherit; min-height: 48px; max-height: 140px; }
  #input:focus { border-color: #7c3aed; }
  #send { width: 48px; height: 48px; border: none; border-radius: 12px; background: var(--grad);
    color: #fff; font-size: 18px; cursor: pointer; transition: .2s; flex-shrink: 0; }
  #send:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(124,58,237,.5); }
  #send:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }
  .foot { text-align: center; color: var(--dim); font-size: 11px; margin-top: 10px; }
  @media (max-width: 600px) { .msg { max-width: 90%; } }
</style>
</head>
<body>
<header>
  <div class="brand">
    <div class="logo">&#9889;</div>
    <h1><span>Vibes Agent</span><small>your personal AI &middot; always on &middot; free</small></h1>
  </div>
  <button id="newChat" onclick="newChat()">＋ New chat</button>
</header>
<div id="chat">
  <div class="welcome" id="welcome">
    <div class="big">&#9889; Vibes Agent</div>
    <div>Ask me anything — code, ideas, plans, vibes.</div>
    <div class="chips">
      <button onclick="chip(this)">Write a Python script to rename files</button>
      <button onclick="chip(this)">Explain quantum computing simply</button>
      <button onclick="chip(this)">Give me 5 startup ideas for Zimbabwe</button>
      <button onclick="chip(this)">Help me plan my week</button>
    </div>
  </div>
</div>
<div id="typing"><div class="dots"><i></i><i></i><i></i></div></div>
<footer>
  <div class="inputrow">
    <textarea id="input" rows="1" placeholder="Message Vibes Agent&hellip;" autofocus></textarea>
    <button id="send" onclick="send()">&#10148;</button>
  </div>
  <div class="foot">Vibes Agent &middot; built by Brendon Pikirai &middot; Vibes ecosystem</div>
</footer>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script>
marked.setOptions({ breaks: true, gfm: true });
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const typing = document.getElementById('typing');
const welcome = document.getElementById('welcome');
const SID = 'vibes-session';
let history = JSON.parse(localStorage.getItem(SID) || '[]');

function addMsg(text, who) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.innerHTML = who === 'bot' ? marked.parse(text) : text.replace(/</g,'&lt;');
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function restore() {
  for (const m of history) addMsg(m.role === 'user' ? m.content : m.reply, m.role === 'user' ? 'user' : 'bot');
  if (history.length) { const w = document.getElementById('welcome'); if (w) w.remove(); }
}
restore();

async function send() {
  const text = input.value.trim();
  if (!text || sendBtn.disabled) return;
  if (welcome) welcome.remove();
  input.value = ''; input.style.height = 'auto';
  addMsg(text, 'user');
  history.push({ role: 'user', content: text });
  sendBtn.disabled = true; typing.style.display = 'block'; chat.scrollTop = chat.scrollHeight;
  try {
    const res = await fetch('/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-20) })
    });
    const data = await res.json();
    const reply = data.reply || '\u2026';
    typing.style.display = 'none';
    addMsg(reply, 'bot');
    history.push({ role: 'assistant', reply: reply });
  } catch (e) {
    typing.style.display = 'none';
    addMsg('\u26a0\ufe0f Connection problem — try again in a second.', 'bot');
  }
  localStorage.setItem(SID, JSON.stringify(history.slice(-40)));
  sendBtn.disabled = false; input.focus();
}
function chip(btn) { input.value = btn.textContent; send(); }
function newChat() { history = []; localStorage.removeItem(SID); location.reload(); }
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; });
<\/script>
</body>
</html>`;

const SYSTEM = [
  "You are Vibes Agent, a sharp, friendly, modern AI assistant.",
  "Be concise, accurate and genuinely useful.",
  "Use markdown for structure, lists and code blocks. Always tag code fences with the language.",
  "You were built by Brendon Pikirai for the Vibes ecosystem.",
  "If the user is casual, match their energy. If technical, be precise."
].join("\n");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ status: "ok", agent: "Vibes Agent", model: env.VIBES_MODEL || "openai/gpt-oss-120b" });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML, { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ reply: "⚠️ Bad request." }); }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const clean = messages
        .filter(m => m && typeof (m.content || m.reply) === "string")
        .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || m.reply).slice(0, 6000) }))
        .slice(-20);

      if (!clean.length) return json({ reply: "⚠️ Nothing to send." });

      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + (env.GROQ_API_KEY || ""),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: env.VIBES_MODEL || "openai/gpt-oss-120b",
            messages: [{ role: "system", content: SYSTEM }, ...clean],
            temperature: 0.7,
            max_tokens: 2048
          })
        });
        const data = await r.json();
        const reply = data.choices?.[0]?.message?.content;
        if (!reply) return json({ reply: "⚠️ Vibes hiccup: " + (data.error?.message || "empty reply — try again.") });
        return json({ reply });
      } catch (e) {
        return json({ reply: "⚠️ Vibes hiccup: " + e });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
}
