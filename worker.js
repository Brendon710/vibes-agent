/* ⚡ Vibes Agent — free AI assistant on Cloudflare Workers
   Website (this file) + streaming chat over Groq. Design: liquid glass, restrained. */

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#08090c">
<title>Vibes Agent</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%237c6cf0'/><path d='M17.5 5 8 18h6l-1.5 9L23 13h-6z' fill='%23fff'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #08090c;
    --text: #eceef2;
    --muted: #a6adba;
    --dim: #6e7580;
    --accent: #7c6cf0;
    --accent-2: #5ca8f5;
    --glass: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.022));
    --glass-border: rgba(255,255,255,.085);
    --radius: 14px;
    --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  html, body { height: 100%; }
  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    letter-spacing: -0.006em;
  }
  ::selection { background: rgba(124,108,240,.35); }

  /* ambient light that the glass refracts */
  .amb { position: fixed; inset: 0; pointer-events: none; z-index: 0; }
  .amb::before, .amb::after { content: ''; position: absolute; border-radius: 50%; filter: blur(110px); }
  .amb::before { width: 480px; height: 480px; left: -140px; top: -180px;
    background: radial-gradient(circle, rgba(124,108,240,.22), transparent 65%); }
  .amb::after { width: 520px; height: 520px; right: -180px; bottom: -160px;
    background: radial-gradient(circle, rgba(92,168,245,.13), transparent 65%); }
  .grain { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .5;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.028 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E"); }

  /* ---------- top bar ---------- */
  header {
    position: relative; z-index: 10;
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px clamp(14px, 4vw, 28px);
    background: rgba(10,11,14,.6);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border-bottom: 1px solid rgba(255,255,255,.055);
    flex-shrink: 0;
  }
  .wordmark { display: flex; align-items: center; gap: 9px; }
  .mark {
    width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
    background: linear-gradient(135deg, #8b7bf8, #5ca8f5);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 10px rgba(124,108,240,.35), inset 0 1px 0 rgba(255,255,255,.35);
  }
  .mark svg { width: 14px; height: 14px; }
  .wordmark b { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .wordmark span { font-size: 12px; color: var(--dim); font-weight: 400; margin-left: 2px; }
  .ghost {
    font-family: var(--font); font-size: 13px; font-weight: 500;
    color: var(--muted); background: rgba(255,255,255,.045);
    border: 1px solid var(--glass-border); border-radius: 9px;
    padding: 7px 13px; cursor: pointer;
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    transition: background .15s, color .15s, border-color .15s, transform .15s;
  }
  .ghost:hover { background: rgba(255,255,255,.085); color: var(--text); border-color: rgba(255,255,255,.16); }
  .ghost:active { transform: scale(.97); }

  /* ---------- chat column ---------- */
  main { position: relative; z-index: 1; flex: 1; overflow-y: auto; overscroll-behavior: contain; }
  .col { max-width: 748px; margin: 0 auto; padding: 28px clamp(16px, 4vw, 24px) 28px; }
  #chat { display: flex; flex-direction: column; gap: 26px; }
  main::-webkit-scrollbar { width: 8px; }
  main::-webkit-scrollbar-thumb { background: rgba(255,255,255,.09); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }

  /* welcome */
  .welcome { min-height: 52vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px 0; }
  .welcome .mark { width: 44px; height: 44px; border-radius: 12px; margin-bottom: 20px; }
  .welcome .mark svg { width: 24px; height: 24px; }
  .welcome h2 { font-size: clamp(24px, 5vw, 30px); font-weight: 700; letter-spacing: -0.03em; }
  .welcome p { color: var(--dim); font-size: 15px; margin-top: 8px; }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 30px; width: 100%; max-width: 560px; }
  .card {
    text-align: left; font-family: var(--font);
    background: var(--glass); border: 1px solid var(--glass-border); border-radius: var(--radius);
    color: var(--muted); font-size: 13.5px; line-height: 1.45;
    padding: 13px 15px; cursor: pointer; position: relative;
    backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3);
    transition: border-color .18s, background .18s, transform .18s, color .18s;
    overflow: hidden;
  }
  .card::before { content: ''; position: absolute; top: 0; left: 10%; right: 10%; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent); }
  .card:hover { border-color: rgba(255,255,255,.18); background: rgba(255,255,255,.07); color: var(--text); transform: translateY(-1px); }
  .card i { font-style: normal; margin-right: 7px; opacity: .85; }

  /* messages */
  .turn { display: flex; flex-direction: column; gap: 26px; }
  .user { align-self: flex-end; max-width: 78%;
    background: var(--glass); border: 1px solid var(--glass-border); border-radius: 18px;
    border-bottom-right-radius: 6px; padding: 11px 16px; font-size: 15px; line-height: 1.55;
    white-space: pre-wrap; word-wrap: break-word;
    backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3);
    box-shadow: 0 4px 18px rgba(0,0,0,.25); }
  .assistant { display: flex; gap: 12px; animation: rise .22s ease; }
  @keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }
  .a-mark {
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; margin-top: 1px;
    background: linear-gradient(135deg, #8b7bf8, #5ca8f5);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(124,108,240,.3), inset 0 1px 0 rgba(255,255,255,.3); }
  .a-mark svg { width: 13px; height: 13px; }
  .a-body { flex: 1; min-width: 0; font-size: 15px; line-height: 1.65; }
  .a-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .a-head b { font-size: 12.5px; font-weight: 600; color: var(--muted); letter-spacing: 0; }

  /* markdown */
  .a-body > *:first-child { margin-top: 0; } .a-body > *:last-child { margin-bottom: 0; }
  .a-body p { margin: 10px 0; }
  .a-body h1, .a-body h2, .a-body h3, .a-body h4 { margin: 18px 0 8px; letter-spacing: -0.02em; line-height: 1.3; }
  .a-body h1 { font-size: 20px; } .a-body h2 { font-size: 17px; } .a-body h3 { font-size: 15.5px; }
  .a-body ul, .a-body ol { margin: 10px 0 10px 22px; }
  .a-body li { margin: 4px 0; }
  .a-body a { color: var(--accent-2); text-decoration: none; border-bottom: 1px solid rgba(92,168,245,.3); }
  .a-body a:hover { border-bottom-color: rgba(92,168,245,.7); }
  .a-body blockquote { border-left: 2px solid rgba(124,108,240,.5); padding: 2px 0 2px 14px; color: var(--muted); margin: 12px 0; }
  .a-body hr { border: none; border-top: 1px solid rgba(255,255,255,.09); margin: 18px 0; }
  .a-body table { border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 13.5px; display: block; overflow-x: auto; }
  .a-body th, .a-body td { border: 1px solid rgba(255,255,255,.1); padding: 7px 11px; text-align: left; }
  .a-body th { background: rgba(255,255,255,.05); font-weight: 600; }
  .a-body code { font-family: var(--mono); font-size: .86em;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.07);
    padding: 2px 5px; border-radius: 5px; }
  .a-body pre { margin: 12px 0; border-radius: 10px; background: #0c0e13 !important;
    border: 1px solid rgba(255,255,255,.08); overflow: hidden; }
  .a-body pre code { background: none; border: none; padding: 0; font-size: 13px; line-height: 1.6; display: block; }
  .codewrap { position: relative; }
  .codehead { display: flex; justify-content: space-between; align-items: center;
    padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,.06);
    font-size: 11px; color: var(--dim); font-family: var(--mono); }
  .codehead button { font-family: var(--font); font-size: 11px; color: var(--dim); background: none;
    border: none; cursor: pointer; padding: 2px 4px; border-radius: 4px; transition: color .15s; }
  .codehead button:hover { color: var(--text); }
  .a-body pre code { padding: 12px 14px; overflow-x: auto; }

  .msgtools { display: flex; gap: 2px; margin-top: 10px; opacity: 0; transition: opacity .18s; }
  .assistant:hover .msgtools { opacity: 1; }
  .msgtools button { background: none; border: none; color: var(--dim); font-size: 11.5px;
    font-family: var(--font); cursor: pointer; padding: 4px 7px; border-radius: 6px;
    display: flex; align-items: center; gap: 5px; transition: background .15s, color .15s; }
  .msgtools button:hover { background: rgba(255,255,255,.06); color: var(--muted); }

  .caret { display: inline-block; width: 7px; height: 15px; margin-left: 2px; vertical-align: text-bottom;
    background: var(--accent); border-radius: 1.5px; animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  .thinking .a-head b::after { content: ''; display: inline-block; width: 30px; height: 8px; margin-left: 8px;
    border-radius: 4px; background: linear-gradient(90deg, rgba(255,255,255,.08) 25%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.08) 75%);
    background-size: 200% 100%; animation: shimmer 1.1s linear infinite; }
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

  /* ---------- composer ---------- */
  footer { position: relative; z-index: 10; padding: 0 clamp(14px, 4vw, 24px) 14px;
    padding-bottom: max(14px, env(safe-area-inset-bottom)); flex-shrink: 0; }
  .composer {
    max-width: 748px; margin: 0 auto; position: relative;
    background: var(--glass); border: 1px solid var(--glass-border); border-radius: 22px;
    backdrop-filter: blur(24px) saturate(1.5); -webkit-backdrop-filter: blur(24px) saturate(1.5);
    box-shadow: 0 12px 40px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
    display: flex; align-items: flex-end; gap: 8px;
    padding: 8px 8px 8px 16px;
    transition: border-color .2s, box-shadow .2s;
  }
  .composer:focus-within { border-color: rgba(139,123,248,.45);
    box-shadow: 0 12px 44px rgba(0,0,0,.5), 0 0 0 3px rgba(124,108,240,.12), inset 0 1px 0 rgba(255,255,255,.08); }
  #input { flex: 1; background: none; border: none; outline: none; resize: none;
    color: var(--text); font-family: var(--font); font-size: 15px; line-height: 1.5;
    max-height: 176px; padding: 8px 0; }
  #input::placeholder { color: var(--dim); }
  #send {
    width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,.06); color: var(--dim);
    transition: background .18s, color .18s, transform .12s; }
  #send svg { width: 15px; height: 15px; }
  #send.ready { background: linear-gradient(135deg, #8b7bf8, #5ca8f5); color: #fff;
    box-shadow: 0 3px 14px rgba(124,108,240,.45); }
  #send.ready:hover { transform: translateY(-1px); }
  #send:disabled { cursor: default; }
  .disclaimer { max-width: 748px; margin: 9px auto 0; text-align: center;
    font-size: 11px; color: var(--dim); }
  .disclaimer a { color: var(--dim); }

  @media (max-width: 640px) {
    .cards { grid-template-columns: 1fr; }
    .user { max-width: 88%; }
    .welcome { min-height: 40vh; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
<div class="amb"></div><div class="grain"></div>

<header>
  <div class="wordmark">
    <div class="mark"><svg viewBox="0 0 32 32" fill="none"><path d="M17.5 5 8 18h6l-1.5 9L23 13h-6z" fill="#fff"/></svg></div>
    <b>Vibes Agent</b><span>beta</span>
  </div>
  <button class="ghost" id="newChat">New chat</button>
</header>

<main id="main">
  <div class="col">
    <div id="chat"></div>
    <div class="welcome" id="welcome">
      <div class="mark"><svg viewBox="0 0 32 32" fill="none"><path d="M17.5 5 8 18h6l-1.5 9L23 13h-6z" fill="#fff"/></svg></div>
      <h2>How can I help you today?</h2>
      <p>Vibes Agent — fast, private, always on.</p>
      <div class="cards">
        <button class="card" data-q="Write a Python script that renames all files in a folder to lowercase"><i>◆</i>Write a Python script that renames files in a folder</button>
        <button class="card" data-q="Explain how large language models work, in simple terms"><i>◇</i>Explain how large language models work</button>
        <button class="card" data-q="Draft a short, professional email requesting a meeting with a client"><i>◈</i>Draft a professional meeting request email</button>
        <button class="card" data-q="Give me a 7-day beginner workout plan I can do at home"><i>◉</i>Give me a 7-day beginner workout plan</button>
      </div>
    </div>
  </div>
</main>

<footer>
  <div class="composer">
    <textarea id="input" rows="1" placeholder="Message Vibes Agent" autofocus></textarea>
    <button id="send" title="Send"><svg viewBox="0 0 16 16" fill="none"><path d="M8 2.5 8 12M8 12l-4-4M8 12l4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
  </div>
  <div class="disclaimer">Vibes Agent can make mistakes. Double-check important information.</div>
</footer>

<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"><\/script>
<script>
(function () {
  marked.setOptions({ breaks: true, gfm: true });
  var main = document.getElementById('main');
  var chat = document.getElementById('chat');
  var input = document.getElementById('input');
  var sendBtn = document.getElementById('send');
  var welcome = document.getElementById('welcome');
  var SID = 'vibes-agent-sessions';
  var history = [];
  var streaming = false, aborter = null, stick = true;

  try { history = JSON.parse(localStorage.getItem(SID) || '[]'); } catch (e) { history = []; }

  var ARROW = '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2.5 8 12M8 12l-4-4M8 12l4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var STOP = '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
  var BOLT = '<svg viewBox="0 0 32 32" fill="none"><path d="M17.5 5 8 18h6l-1.5 9L23 13h-6z" fill="#fff"/></svg>';

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function render(text) {
    return DOMPurify.sanitize(marked.parse(text));
  }

  // wrap code blocks with a header (language + copy)
  function decorate(root) {
    root.querySelectorAll('pre').forEach(function (pre) {
      if (pre.parentElement.classList.contains('codewrap')) return;
      var m = (pre.querySelector('code') ? pre.querySelector('code').className : '').match(/language-([\\w-]+)/);
      var lang = m ? m[1] : 'code';
      var wrap = document.createElement('div'); wrap.className = 'codewrap';
      var head = document.createElement('div'); head.className = 'codehead';
      var label = document.createElement('span'); label.textContent = lang;
      var btn = document.createElement('button'); btn.textContent = 'Copy';
      btn.onclick = function () {
        navigator.clipboard.writeText(pre.innerText).then(function () {
          btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1400);
        });
      };
      head.appendChild(label); head.appendChild(btn);
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(head); wrap.appendChild(pre);
    });
  }

  function nearBottom() { return main.scrollHeight - main.scrollTop - main.clientHeight < 90; }
  function scrollDown(force) { if (force || stick) main.scrollTop = main.scrollHeight; }
  main.addEventListener('scroll', function () { stick = nearBottom(); });

  function addUser(text) {
    var el = document.createElement('div');
    el.className = 'user'; el.textContent = text;
    chat.appendChild(el);
    stick = true; scrollDown(true);
  }

  function addAssistant() {
    var turn = document.createElement('div');
    turn.className = 'assistant thinking';
    turn.innerHTML = '<div class="a-mark">' + BOLT + '</div><div class="a-body-wrap" style="min-width:0;flex:1"><div class="a-head"><b>Vibes Agent</b></div><div class="a-body"><span class="shimmertext"></span></div></div>';
    chat.appendChild(turn);
    return turn;
  }

  function finishAssistant(turn, text) {
    var body = turn.querySelector('.a-body');
    body.innerHTML = render(text);
    decorate(body);
    var tools = document.createElement('div');
    tools.className = 'msgtools';
    var copyBtn = document.createElement('button');
    copyBtn.textContent = '⧉ Copy';
    copyBtn.onclick = function () {
      navigator.clipboard.writeText(text).then(function () {
        copyBtn.textContent = '✓ Copied'; setTimeout(function () { copyBtn.textContent = '⧉ Copy'; }, 1400);
      });
    };
    tools.appendChild(copyBtn);
    turn.querySelector('.a-body-wrap').appendChild(tools);
    scrollDown();
  }

  function restore() {
    if (!history.length) return;
    welcome.remove();
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      if (m.role === 'user') addUser(m.content);
      else { var t = addAssistant(); finishAssistant(t, m.content); }
    }
  }
  restore();

  function save() { localStorage.setItem(SID, JSON.stringify(history.slice(-40))); }

  async function send() {
    var text = input.value.trim();
    if (!text || streaming) return;
    if (welcome && welcome.parentNode) welcome.remove();
    input.value = ''; input.style.height = 'auto'; updateSend();
    addUser(text);
    history.push({ role: 'user', content: text });

    streaming = true;
    stick = true; scrollDown(true);
    var turn = addAssistant();
    setBusy(true);

    var full = '';
    aborter = new AbortController();
    try {
      var res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-20) }),
        signal: aborter.signal
      });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '', lastPaint = 0;
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var lines = buf.split('\\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.indexOf('data:') !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            var j = JSON.parse(payload);
            var delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (delta) full += delta;
          } catch (e) {}
        }
        var now = Date.now();
        if (now - lastPaint > 90) {
          lastPaint = now;
          var body = turn.querySelector('.a-body');
          turn.classList.remove('thinking');
          if (full) { body.innerHTML = render(full) + '<span class="caret"></span>'; }
          scrollDown();
        }
      }
      if (!full) throw new Error('empty response');
      finishAssistant(turn, full);
      history.push({ role: 'assistant', content: full });
      save();
    } catch (e) {
      if (e.name === 'AbortError') {
        if (full) { finishAssistant(turn, full); history.push({ role: 'assistant', content: full }); save(); }
        else turn.remove();
      } else {
        turn.classList.remove('thinking');
        turn.querySelector('.a-body').innerHTML = '<span style="color:#e0836d">⚠ ' + esc(String(e.message || e)) + '</span>';
      }
    }
    streaming = false; setBusy(false); input.focus();
  }

  function setBusy(on) {
    sendBtn.innerHTML = on ? STOP : ARROW;
    sendBtn.classList.toggle('ready', on ? true : input.value.trim().length > 0);
  }
  function updateSend() {
    if (streaming) return;
    sendBtn.classList.toggle('ready', input.value.trim().length > 0);
  }
  sendBtn.addEventListener('click', function () {
    if (streaming) aborter.abort(); else send();
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 176) + 'px';
    updateSend();
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  document.getElementById('newChat').addEventListener('click', function () {
    if (streaming) aborter.abort();
    history = []; localStorage.removeItem(SID); location.reload();
  });
  document.querySelectorAll('.card').forEach(function (c) {
    c.addEventListener('click', function () { input.value = c.getAttribute('data-q'); updateSend(); send(); });
  });
})();
<\/script>
</body>
</html>`;

const SYSTEM = [
  "You are Vibes Agent, a sharp, friendly, modern AI assistant.",
  "Be concise, accurate and genuinely useful. Match the depth of your answer to the question.",
  "Use markdown for structure: headings, lists, and tagged code fences.",
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
      return new Response(HTML, {
        headers: { "content-type": "text/html;charset=UTF-8", "cache-control": "public, max-age=300" }
      });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ reply: "bad request" }, 400); }
      const clean = (Array.isArray(body.messages) ? body.messages : [])
        .filter(m => m && typeof (m.content || m.reply) === "string")
        .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || m.reply).slice(0, 6000) }))
        .slice(-20);
      if (!clean.length) return json({ reply: "nothing to send" }, 400);

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
          const err = await upstream.text();
          return json({ error: "upstream: " + err.slice(0, 200) }, 502);
        }
        return new Response(upstream.body, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
            "access-control-allow-origin": "*"
          }
        });
      } catch (e) {
        return json({ error: String(e).slice(0, 200) }, 502);
      }
    }

    return new Response("Not found", { status: 404 });
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
}
