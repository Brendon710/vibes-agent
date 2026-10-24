/* ⚡ Vibes Agent — free AI assistant with accounts, chat history & settings.
   Single Cloudflare Worker: serves UI + auth (D1) + sessions (KV) + streaming chat (Groq). */

const ITER = 30000;

/* ---------------- helpers ---------------- */
const j2 = obj => JSON.stringify(obj);
function json(obj, status, extra) {
  return new Response(j2(obj), { status: status || 200, headers: { "content-type": "application/json", ...(extra || {}) } });
}
function hexBuf(hex) { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < hex.length; i += 2) a[i / 2] = parseInt(hex.slice(i, i + 2), 16); return a; }
function bufHex(b) { return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return bufHex(a.buffer); }

async function hashPass(pw, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexBuf(saltHex), iterations: ITER }, key, 256);
  return bufHex(bits);
}

const COOKIE = "vibes_session";
function setCookie(token, maxAge) {
  return COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}
async function getUser(req, env) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(COOKIE + "=([a-f0-9]{32,})"));
  if (!m) return null;
  const sess = await env.SESSIONS.get("sess:" + m[1], "json");
  if (!sess || !sess.uid) return null;
  const u = await env.DB.prepare("SELECT id, username, name, settings FROM users WHERE id=?").bind(sess.uid).first();
  return u || null;
}

const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RX_USER = /^[a-z0-9_]{3,20}$/;
const normPhone = p => (p || "").replace(/[\s\-()]/g, "").replace(/^\+/, "");

/* ---------------- API ---------------- */
async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const body = (method === "POST" || method === "PATCH" || method === "DELETE") ? await request.json().catch(() => ({})) : {};

  /* ---- auth ---- */
  if (path === "/api/signup" && method === "POST") {
    const { mode, contact, username, name, password } = body;
    const uname = String(username || "").toLowerCase();
    const unameOk = RX_USER.test(uname);
    const email = mode === "email" ? String(contact || "").trim().toLowerCase() : null;
    const phone = mode === "phone" ? normPhone(String(contact || "")) : null;
    if (!unameOk) return json({ error: "Username: 3-20 chars, letters/numbers/_" }, 400);
    if (mode === "email" && !RX_EMAIL.test(email || "")) return json({ error: "Enter a valid email address" }, 400);
    if (mode === "phone" && !/^\d{7,15}$/.test(phone || "")) return json({ error: "Enter a valid phone number" }, 400);
    if (!name || String(name).trim().length < 1) return json({ error: "Enter your name" }, 400);
    if (!password || String(password).length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

    const clash = await env.DB.prepare("SELECT id FROM users WHERE username=? OR email=? OR phone=?")
      .bind(uname, email, phone).first();
    if (clash) return json({ error: "That username or contact is already registered" }, 409);

    const salt = randHex(16);
    const hash = await hashPass(String(password), salt);
    try {
      await env.DB.prepare("INSERT INTO users (username,email,phone,name,pass_hash,salt,settings,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(uname, email, phone, String(name).trim().slice(0, 40), hash, salt, "{}", Date.now()).run();
    } catch (e) { return json({ error: "Could not create account (name taken?)" }, 409); }
    const u = await env.DB.prepare("SELECT id, username, name, settings FROM users WHERE username=?").bind(uname).first();
    const token = randHex(24);
    await env.SESSIONS.put("sess:" + token, j2({ uid: u.id }), { expirationTtl: 2592000 });
    return json({ user: { username: u.username, name: u.name, settings: JSON.parse(u.settings || "{}") } },
      200, { "Set-Cookie": setCookie(token, 2592000) });
  }

  if (path === "/api/login" && method === "POST") {
    const id = String(body.identifier || "").trim();
    const pw = String(body.password || "");
    if (!id || !pw) return json({ error: "Enter your login and password" }, 400);
    const u = await env.DB.prepare("SELECT * FROM users WHERE username=? OR email=? OR phone=?")
      .bind(id.toLowerCase(), id.toLowerCase(), normPhone(id)).first();
    if (!u) return json({ error: "No account found with those details" }, 401);
    const hash = await hashPass(pw, u.salt);
    if (hash !== u.pass_hash) return json({ error: "Wrong password" }, 401);
    const token = randHex(24);
    await env.SESSIONS.put("sess:" + token, j2({ uid: u.id }), { expirationTtl: 2592000 });
    return json({ user: { username: u.username, name: u.name, settings: JSON.parse(u.settings || "{}") } },
      200, { "Set-Cookie": setCookie(token, 2592000) });
  }

  if (path === "/api/logout" && method === "POST") {
    const m = (request.headers.get("Cookie") || "").match(new RegExp(COOKIE + "=([a-f0-9]{32,})"));
    if (m) await env.SESSIONS.delete("sess:" + m[1]);
    return json({ ok: true }, 200, { "Set-Cookie": setCookie("", 0) });
  }

  if (path === "/api/me" && method === "GET") {
    const u = await getUser(request, env);
    if (!u) return json({ user: null });
    return json({ user: { username: u.username, name: u.name, settings: JSON.parse(u.settings || "{}") } });
  }

  if (path === "/api/profile" && method === "POST") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401);
    const name = String(body.name || "").trim().slice(0, 40);
    if (!name) return json({ error: "Name can't be empty" }, 400);
    await env.DB.prepare("UPDATE users SET name=? WHERE id=?").bind(name, u.id).run();
    return json({ ok: true, name });
  }

  if (path === "/api/settings" && method === "POST") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401);
    const s = body.settings || {};
    const clean = {
      tone: ["friendly", "balanced", "professional"].includes(s.tone) ? s.tone : "balanced",
      length: ["concise", "balanced", "detailed"].includes(s.length) ? s.length : "balanced",
      greeting: s.greeting !== false,
      custom: typeof s.custom === "string" ? s.custom.slice(0, 600) : ""
    };
    await env.DB.prepare("UPDATE users SET settings=? WHERE id=?").bind(j2(clean), u.id).run();
    return json({ ok: true, settings: clean });
  }

  if (path === "/api/password" && method === "POST") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401);
    const row = await env.DB.prepare("SELECT pass_hash, salt FROM users WHERE id=?").bind(u.id).first();
    if (await hashPass(String(body.current || ""), row.salt) !== row.pass_hash) return json({ error: "Current password is wrong" }, 401);
    if (!body.next || String(body.next).length < 6) return json({ error: "New password must be at least 6 characters" }, 400);
    const salt = randHex(16);
    await env.DB.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(await hashPass(String(body.next), salt), salt, u.id).run();
    return json({ ok: true });
  }

  if (path === "/api/account" && method === "DELETE") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401);
    await env.DB.prepare("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id=?)").bind(u.id).run();
    await env.DB.prepare("DELETE FROM chats WHERE user_id=?").bind(u.id).run();
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(u.id).run();
    const m = (request.headers.get("Cookie") || "").match(new RegExp(COOKIE + "=([a-f0-9]{32,})"));
    if (m) await env.SESSIONS.delete("sess:" + m[1]);
    return json({ ok: true }, 200, { "Set-Cookie": setCookie("", 0) });
  }

  /* ---- chats ---- */
  if (path === "/api/chats" && method === "GET") {
    const u = await getUser(request, env);
    if (!u) return json({ chats: [] });
    const { results } = await env.DB.prepare(
      "SELECT id, title, created_at, updated_at FROM chats WHERE user_id=? ORDER BY updated_at DESC LIMIT 200").bind(u.id).all();
    return json({ chats: results });
  }
  if (path === "/api/chats" && method === "POST") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401);
    const chats = Array.isArray(body.import) ? body.import.slice(0, 50) : null;
    if (chats) {
      for (const c of chats) {
        const id = /^[a-f0-9-]{8,36}$/.test(c.id || "") ? c.id : crypto.randomUUID();
        await env.DB.prepare("INSERT OR IGNORE INTO chats (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)")
          .bind(id, u.id, String(c.title || "Imported chat").slice(0, 80), c.created_at || Date.now(), c.updated_at || Date.now()).run();
        for (const m of (c.messages || []).slice(-40)) {
          if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
            await env.DB.prepare("INSERT INTO messages (chat_id,role,content,created_at) VALUES (?,?,?,?)")
              .bind(id, m.role, m.content.slice(0, 8000), Date.now()).run();
        }
      }
      return json({ ok: true });
    }
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO chats (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)")
      .bind(id, u.id, "New chat", Date.now(), Date.now()).run();
    return json({ id });
  }
  const cm = path.match(/^\/api\/chats\/([a-f0-9-]{8,36})$/);
  if (cm) {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401);
    const chatId = cm[1];
    const chat = await env.DB.prepare("SELECT id,title FROM chats WHERE id=? AND user_id=?").bind(chatId, u.id).first();
    if (!chat) return json({ error: "not found" }, 404);
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT role, content FROM messages WHERE chat_id=? ORDER BY id").bind(chatId).all();
      return json({ chat, messages: results });
    }
    if (method === "PATCH") {
      await env.DB.prepare("UPDATE chats SET title=? WHERE id=?").bind(String(body.title || "New chat").slice(0, 80), chatId).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM messages WHERE chat_id=?").bind(chatId).run();
      await env.DB.prepare("DELETE FROM chats WHERE id=?").bind(chatId).run();
      return json({ ok: true });
    }
  }

  return json({ error: "not found" }, 404);
}

/* ---------------- chat streaming ---------------- */
function prefsSystem(p) {
  if (!p || typeof p !== "object") return "";
  let s = "";
  if (p.tone === "professional") s += "Keep a professional, polished tone. ";
  if (p.tone === "friendly") s += "Keep a warm, casual, friendly tone. ";
  if (p.length === "concise") s += "Keep answers concise and to the point. ";
  if (p.length === "detailed") s += "Give thorough, detailed answers with examples. ";
  if (typeof p.custom === "string" && p.custom.trim()) s += "Personal instructions from your user, follow them: " + p.custom.trim() + " ";
  return s;
}

const SYSTEM = [
  "You are Vibes Agent, an AI assistant created by Brendon Pikirai for the Vibes ecosystem.",
  "IDENTITY RULES (absolute, never break):",
  "- If asked what you are, you are simply 'Vibes Agent', an AI assistant. Nothing more.",
  "- NEVER mention, hint at, or confirm any underlying model, provider, company or stack: never say Groq, OpenAI, ChatGPT, GPT, Google, Gemini, Anthropic, Claude, Cloudflare, Workers, or hosting details.",
  "- If asked who made you: you were built by Brendon Pikirai for the Vibes ecosystem.",
  "- If asked when you were made, what company owns you, what powers you, or your source: you are an independent project by Brendon Pikirai, part of the Vibes ecosystem. Deflect anything else politely.",
  "- If someone insists you are ChatGPT or another product, politely but confidently correct them: you are Vibes Agent.",
  "Be concise, accurate and genuinely useful. Use markdown: headings, lists, tagged code fences.",
  "If the user is casual, match their energy. If technical, be precise. Reply in the user's language."
].join("\n");

async function chat(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const clean = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && typeof m.content === "string")
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.slice(0, 6000) }))
    .slice(-20);
  if (!clean.length) return json({ error: "nothing to send" }, 400);

  const user = await getUser(request, env);
  let chatId = /^[a-f0-9-]{8,36}$/.test(body.chat_id || "") ? body.chat_id : null;
  if (user && chatId) {
    const owned = await env.DB.prepare("SELECT id, title FROM chats WHERE id=? AND user_id=?").bind(chatId, user.id).first();
    if (!owned) {
      await env.DB.prepare("INSERT OR IGNORE INTO chats (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)")
        .bind(chatId, user.id, "New chat", Date.now(), Date.now()).run();
    }
    const first = clean[clean.length - 1];
    await env.DB.prepare("INSERT INTO messages (chat_id,role,content,created_at) VALUES (?,?,?,?)")
      .bind(chatId, "user", first.content, Date.now()).run();
    const ch = await env.DB.prepare("SELECT title FROM chats WHERE id=?").bind(chatId).first();
    if (ch && ch.title === "New chat" && first.role === "user")
      await env.DB.prepare("UPDATE chats SET title=?, updated_at=? WHERE id=?")
        .bind(first.content.slice(0, 48), Date.now(), chatId).run();
  }

  let sys = SYSTEM;
  const extra = prefsSystem(body.prefs);
  const settings = user ? JSON.parse(user.settings || "{}") : {};
  const prefs = (body.prefs && typeof body.prefs === "object" && Object.keys(body.prefs).length) ? body.prefs : settings;
  if (prefs) sys = SYSTEM + "\n" + prefsSystem(prefs);
  void extra;

  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + (env.GROQ_API_KEY || ""), "Content-Type": "application/json" },
      body: j2({
        model: env.VIBES_MODEL || "openai/gpt-oss-120b",
        messages: [{ role: "system", content: sys }, ...clean],
        temperature: 0.7, max_tokens: 2048, stream: true
      })
    });
    if (!upstream.ok || !upstream.body) return json({ error: "upstream error" }, 502);

    if (user && chatId) {
      const [out, tap] = upstream.body.tee();
      ctx.waitUntil((async () => {
        const rd = tap.getReader(); const dec = new TextDecoder();
        let buf = "", full = "";
        while (true) {
          const r = await rd.read();
          if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop();
          for (const line of lines) {
            const t = line.trim();
            if (t.indexOf("data:") !== 0) continue;
            const payload = t.slice(5).trim();
            if (payload === "[DONE]") continue;
            try { const c = JSON.parse(payload).choices?.[0]?.delta?.content; if (c) full += c; } catch (e) {}
          }
        }
        if (full) {
          await env.DB.prepare("INSERT INTO messages (chat_id,role,content,created_at) VALUES (?,?,?,?)")
            .bind(chatId, "assistant", full.slice(0, 8000), Date.now()).run();
          await env.DB.prepare("UPDATE chats SET updated_at=? WHERE id=?").bind(Date.now(), chatId).run();
        }
      })());
      return new Response(out, { headers: {
        "content-type": "text/event-stream", "cache-control": "no-cache",
        "x-accel-buffering": "no", "access-control-allow-origin": "*" } });
    }
    return new Response(upstream.body, { headers: {
      "content-type": "text/event-stream", "cache-control": "no-cache",
      "x-accel-buffering": "no", "access-control-allow-origin": "*" } });
  } catch (e) { return json({ error: "unavailable" }, 502); }
}

/* ---------------- UI ---------------- */
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
  --bg:#08090c; --bg2:#0c0e13; --text:#eceef2; --muted:#a6adba; --dim:#6e7580;
  --accent:#7c6cf0; --acc2:#5ca8f5;
  --glass:linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.022));
  --glass-border:rgba(255,255,255,.085);
  --glass-strong:rgba(255,255,255,.045);
  --code-bg:#0c0e13;
  --font:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'SF Mono','Cascadia Code',Consolas,monospace;
}
html[data-accent="blue"]{--accent:#3b82f6;--acc2:#22d3ee}
html[data-accent="teal"]{--accent:#14b8a6;--acc2:#84cc16}
html[data-accent="amber"]{--accent:#f59e0b;--acc2:#fb7185}
html[data-accent="pink"]{--accent:#ec4899;--acc2:#a855f7}
html[data-theme="light"]{
  --bg:#f4f5f8; --bg2:#eceef2; --text:#17181c; --muted:#565c66; --dim:#8a8f99;
  --glass:linear-gradient(180deg, rgba(255,255,255,.75), rgba(255,255,255,.45));
  --glass-border:rgba(0,0,0,.09);
  --glass-strong:rgba(255,255,255,.65);
  --code-bg:#171923;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:var(--font);background:var(--bg);color:var(--text);display:flex;overflow:hidden;letter-spacing:-.006em}
::selection{background:color-mix(in srgb, var(--accent) 35%, transparent)}
.amb{position:fixed;inset:0;pointer-events:none;z-index:0}
.amb::before,.amb::after{content:'';position:absolute;border-radius:50%;filter:blur(110px)}
.amb::before{width:480px;height:480px;left:-140px;top:-180px;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 22%,transparent),transparent 65%)}
.amb::after{width:520px;height:520px;right:-180px;bottom:-160px;background:radial-gradient(circle,color-mix(in srgb,var(--acc2) 13%,transparent),transparent 65%)}

/* ---------- sidebar ---------- */
#side{position:relative;z-index:30;width:264px;flex-shrink:0;display:flex;flex-direction:column;
  background:var(--glass-strong);backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);
  border-right:1px solid var(--glass-border);transition:margin .22s ease}
#side.hide{margin-left:-264px}
.side-top{padding:12px 14px 8px;display:flex;align-items:center;justify-content:space-between}
.side-top .wordmark{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600}
.mark{width:24px;height:24px;border-radius:7px;flex-shrink:0;background:linear-gradient(135deg,var(--accent),var(--acc2));
  display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px color-mix(in srgb,var(--accent) 35%,transparent),inset 0 1px 0 rgba(255,255,255,.35)}
.mark svg{width:13px;height:13px}
#closeSide{background:none;border:none;color:var(--dim);font-size:16px;cursor:pointer;padding:2px 4px;border-radius:6px}
#closeSide:hover{color:var(--text);background:var(--glass-border)}
.newchat{margin:4px 14px 10px;display:flex;align-items:center;justify-content:center;gap:7px;
  font-family:var(--font);font-size:13px;font-weight:500;color:#fff;cursor:pointer;
  background:linear-gradient(135deg,var(--accent),var(--acc2));border:none;border-radius:10px;padding:9px 12px;
  transition:filter .15s, transform .12s;box-shadow:0 4px 14px color-mix(in srgb,var(--accent) 35%,transparent)}
.newchat:hover{filter:brightness(1.1)} .newchat:active{transform:scale(.98)}
.ssearch{margin:0 14px 8px;display:flex;align-items:center;gap:7px;background:var(--glass);border:1px solid var(--glass-border);
  border-radius:9px;padding:7px 10px}
.ssearch input{flex:1;background:none;border:none;outline:none;color:var(--text);font-family:var(--font);font-size:12.5px}
.ssearch input::placeholder{color:var(--dim)} .ssearch span{color:var(--dim);font-size:12px}
#chats{flex:1;overflow-y:auto;padding:2px 8px 8px}
#chats::-webkit-scrollbar{width:6px} #chats::-webkit-scrollbar-thumb{background:var(--glass-border);border-radius:3px}
.chip{position:relative;display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:9px;cursor:pointer;
  color:var(--muted);font-size:13px;transition:background .13s,color .13s;white-space:nowrap}
.chip:hover{background:var(--glass-border);color:var(--text)}
.chip.on{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--text)}
.chip .t{flex:1;overflow:hidden;text-overflow:ellipsis}
.chip .tools{display:none;gap:2px}
.chip:hover .tools{display:flex}
.chip .tools button{background:none;border:none;color:var(--dim);cursor:pointer;font-size:12px;padding:2px 4px;border-radius:5px}
.chip .tools button:hover{color:var(--text);background:rgba(255,255,255,.08)}
.chip .tools button.del.arm{color:#f87171}
.chip input{flex:1;background:none;border:none;outline:none;color:var(--text);font-family:var(--font);font-size:13px;min-width:0}
.side-bottom{padding:10px 14px;border-top:1px solid var(--glass-border)}
.userchip{display:flex;align-items:center;gap:9px;cursor:pointer;padding:7px;border-radius:10px;transition:background .14s}
.userchip:hover{background:var(--glass-border)}
.avatar{width:30px;height:30px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,var(--accent),var(--acc2));
  display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#fff}
.umeta{min-width:0} .umeta b{display:block;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.umeta span{font-size:11px;color:var(--dim)}
.loginbtn{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;font-family:var(--font);
  font-size:13px;font-weight:500;color:var(--text);background:var(--glass);border:1px solid var(--glass-border);
  border-radius:10px;padding:9px;cursor:pointer;transition:background .15s,border-color .15s}
.loginbtn:hover{background:var(--glass-border);border-color:rgba(255,255,255,.16)}

/* ---------- main ---------- */
#app{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;min-width:0;height:100%}
header{display:flex;align-items:center;gap:10px;padding:10px clamp(12px,3vw,22px);
  background:color-mix(in srgb,var(--bg) 55%,transparent);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);
  border-bottom:1px solid var(--glass-border);flex-shrink:0;z-index:5}
#menuBtn{display:none;background:none;border:none;color:var(--muted);font-size:17px;cursor:pointer;padding:4px 6px;border-radius:8px}
#menuBtn:hover{background:var(--glass-border)}
.hspacer{flex:1}
.hbtn{background:none;border:none;color:var(--muted);font-family:var(--font);font-size:12.5px;cursor:pointer;
  padding:6px 10px;border-radius:8px;transition:background .14s,color .14s}
.hbtn:hover{background:var(--glass-border);color:var(--text)}
main{flex:1;overflow-y:auto;overscroll-behavior:contain}
main::-webkit-scrollbar{width:8px} main::-webkit-scrollbar-thumb{background:var(--glass-border);border-radius:4px;border:2px solid transparent;background-clip:content-box}
.col{max-width:748px;margin:0 auto;padding:26px clamp(16px,4vw,24px) 26px}
#chat{display:flex;flex-direction:column;gap:26px}
.user{align-self:flex-end;max-width:78%;background:var(--glass);border:1px solid var(--glass-border);border-radius:18px;
  border-bottom-right-radius:6px;padding:11px 16px;font-size:15px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word;
  backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);box-shadow:0 4px 18px rgba(0,0,0,.25)}
.assistant{display:flex;gap:12px;animation:rise .22s ease}
@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1}}
.a-mark{width:26px;height:26px;border-radius:50%;flex-shrink:0;margin-top:1px;background:linear-gradient(135deg,var(--accent),var(--acc2));
  display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px color-mix(in srgb,var(--accent) 30%,transparent),inset 0 1px 0 rgba(255,255,255,.3)}
.a-mark svg{width:13px;height:13px}
.a-wrap{flex:1;min-width:0}
.a-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.a-head b{font-size:12.5px;font-weight:600;color:var(--muted)}
.a-body{font-size:15px;line-height:1.65;color:var(--text)}
.a-body>*:first-child{margin-top:0}.a-body>*:last-child{margin-bottom:0}
.a-body p{margin:10px 0}.a-body h1,.a-body h2,.a-body h3,.a-body h4{margin:18px 0 8px;letter-spacing:-.02em;line-height:1.3}
.a-body h1{font-size:20px}.a-body h2{font-size:17px}.a-body h3{font-size:15.5px}
.a-body ul,.a-body ol{margin:10px 0 10px 22px}.a-body li{margin:4px 0}
.a-body a{color:var(--acc2);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--acc2) 30%,transparent)}
.a-body blockquote{border-left:2px solid color-mix(in srgb,var(--accent) 50%,transparent);padding:2px 0 2px 14px;color:var(--muted);margin:12px 0}
.a-body hr{border:none;border-top:1px solid var(--glass-border);margin:18px 0}
.a-body table{border-collapse:collapse;margin:12px 0;width:100%;font-size:13.5px;display:block;overflow-x:auto}
.a-body th,.a-body td{border:1px solid var(--glass-border);padding:7px 11px;text-align:left}
.a-body th{background:var(--glass-border);font-weight:600}
.a-body code{font-family:var(--mono);font-size:.86em;background:var(--glass-border);border:1px solid var(--glass-border);padding:2px 5px;border-radius:5px}
.a-body pre{margin:12px 0;border-radius:10px;background:var(--code-bg)!important;border:1px solid var(--glass-border);overflow:hidden}
.a-body pre code{background:none;border:none;padding:0;font-size:13px;line-height:1.6;display:block;padding:12px 14px;overflow-x:auto}
.codewrap{position:relative}
.codehead{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-bottom:1px solid rgba(255,255,255,.06);
  font-size:11px;color:#8a8f9c;font-family:var(--mono)}
.codehead .acts{display:flex;gap:2px}
.codehead button{font-family:var(--font);font-size:11px;color:#8a8f9c;background:none;border:none;cursor:pointer;padding:3px 8px;border-radius:5px;
  display:flex;align-items:center;gap:5px;transition:background .14s,color .14s}
.codehead button:hover{background:rgba(255,255,255,.07);color:#fff}
.msgtools{display:flex;gap:2px;margin-top:10px;opacity:0;transition:opacity .18s}
.assistant:hover .msgtools{opacity:1}
.msgtools button,.regen{background:none;border:none;color:var(--dim);font-size:11.5px;font-family:var(--font);cursor:pointer;
  padding:4px 8px;border-radius:6px;display:flex;align-items:center;gap:5px;transition:background .14s,color .14s}
.msgtools button:hover,.regen:hover{background:var(--glass-border);color:var(--muted)}
.caret{display:inline-block;width:7px;height:15px;margin-left:2px;vertical-align:text-bottom;background:var(--accent);border-radius:1.5px;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.thinking .a-head b::after{content:'';display:inline-block;width:30px;height:8px;margin-left:8px;border-radius:4px;
  background:linear-gradient(90deg,rgba(255,255,255,.08) 25%,rgba(255,255,255,.22) 50%,rgba(255,255,255,.08) 75%);background-size:200% 100%;animation:shimmer 1.1s linear infinite}
@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}

.welcome{min-height:52vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px 0}
.welcome .mark{width:44px;height:44px;border-radius:12px;margin-bottom:20px}
.welcome .mark svg{width:24px;height:24px}
.welcome h2{font-size:clamp(23px,5vw,29px);font-weight:700;letter-spacing:-.03em}
.welcome p{color:var(--dim);font-size:15px;margin-top:8px}
.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:30px;width:100%;max-width:560px}
.card{text-align:left;font-family:var(--font);background:var(--glass);border:1px solid var(--glass-border);border-radius:14px;
  color:var(--muted);font-size:13.5px;line-height:1.45;padding:13px 15px;cursor:pointer;position:relative;overflow:hidden;
  backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);
  transition:border-color .18s,background .18s,transform .18s,color .18s}
.card::before{content:'';position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent)}
.card:hover{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:var(--text);transform:translateY(-1px)}
.card i{font-style:normal;margin-right:7px;opacity:.85}

footer{position:relative;z-index:10;padding:0 clamp(14px,4vw,24px);padding-bottom:max(14px,env(safe-area-inset-bottom));flex-shrink:0}
.composer{max-width:748px;margin:0 auto;position:relative;background:var(--glass);border:1px solid var(--glass-border);border-radius:22px;
  backdrop-filter:blur(24px) saturate(1.5);-webkit-backdrop-filter:blur(24px) saturate(1.5);
  box-shadow:0 12px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06);
  display:flex;align-items:flex-end;gap:8px;padding:8px 8px 8px 16px;transition:border-color .2s,box-shadow .2s}
.composer:focus-within{border-color:color-mix(in srgb,var(--accent) 45%,transparent);
  box-shadow:0 12px 44px rgba(0,0,0,.5),0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent),inset 0 1px 0 rgba(255,255,255,.08)}
#input{flex:1;background:none;border:none;outline:none;resize:none;color:var(--text);font-family:var(--font);font-size:15px;line-height:1.5;max-height:176px;padding:8px 0}
#input::placeholder{color:var(--dim)}
#send{width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  background:var(--glass-border);color:var(--dim);transition:background .18s,color .18s,transform .12s}
#send svg{width:15px;height:15px}
#send.ready{background:linear-gradient(135deg,var(--accent),var(--acc2));color:#fff;box-shadow:0 3px 14px color-mix(in srgb,var(--accent) 45%,transparent)}
#send.ready:hover{transform:translateY(-1px)}
.disclaimer{max-width:748px;margin:9px auto 0;text-align:center;font-size:11px;color:var(--dim)}
.sync-note{max-width:748px;margin:8px auto 0;text-align:center;font-size:12px;color:var(--dim)}
.sync-note button{background:none;border:none;color:var(--acc2);font-family:var(--font);font-size:12px;cursor:pointer;padding:0;text-decoration:underline}

/* ---------- modals ---------- */
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:50;
  display:flex;align-items:center;justify-content:center;padding:18px;opacity:0;pointer-events:none;transition:opacity .18s}
.scrim.open{opacity:1;pointer-events:auto}
.modal{width:100%;max-width:420px;max-height:88vh;overflow-y:auto;background:var(--bg2);border:1px solid var(--glass-border);border-radius:20px;
  box-shadow:0 30px 80px rgba(0,0,0,.55);padding:24px;transform:translateY(8px);transition:transform .18s}
.scrim.open .modal{transform:none}
.modal.wide{max-width:520px}
.modal::-webkit-scrollbar{width:6px}.modal::-webkit-scrollbar-thumb{background:var(--glass-border);border-radius:3px}
.mhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.mhead h3{font-size:17px;font-weight:700;letter-spacing:-.02em}
.mclose{background:none;border:none;color:var(--dim);font-size:18px;cursor:pointer;padding:2px 6px;border-radius:8px}
.mclose:hover{color:var(--text);background:var(--glass-border)}
.tabs{display:flex;gap:4px;background:var(--glass-border);border-radius:10px;padding:4px;margin-bottom:16px}
.tabs button{flex:1;font-family:var(--font);font-size:13px;font-weight:500;color:var(--muted);background:none;border:none;
  border-radius:8px;padding:7px;cursor:pointer;transition:background .15s,color .15s}
.tabs button.on{background:var(--bg2);color:var(--text)}
.field{margin-bottom:12px}
.field label{display:block;font-size:12px;font-weight:500;color:var(--muted);margin-bottom:6px}
.field input,.field textarea,.field select{width:100%;background:var(--glass);border:1px solid var(--glass-border);border-radius:10px;
  color:var(--text);font-family:var(--font);font-size:14px;padding:10px 12px;outline:none;transition:border-color .15s}
.field input:focus,.field textarea:focus{border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
.field textarea{resize:vertical;min-height:74px;line-height:1.5}
.field select{cursor:pointer;appearance:none;background-image:none}
.ferr{font-size:12.5px;color:#f87171;min-height:16px;margin:2px 0 6px}
.btn{width:100%;font-family:var(--font);font-size:14px;font-weight:600;color:#fff;border:none;border-radius:11px;padding:11px;cursor:pointer;
  background:linear-gradient(135deg,var(--accent),var(--acc2));transition:filter .15s,transform .12s;box-shadow:0 4px 14px color-mix(in srgb,var(--accent) 30%,transparent)}
.btn:hover{filter:brightness(1.08)} .btn:active{transform:scale(.98)}
.btn.ghost{background:var(--glass);color:var(--text);border:1px solid var(--glass-border);box-shadow:none}
.btn.danger{background:none;border:1px solid rgba(248,113,113,.4);color:#f87171;box-shadow:none}
.btn.danger:hover{background:rgba(248,113,113,.1)}
.seg{display:flex;gap:8px;margin-bottom:4px}
.seg label{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;font-size:12.5px;color:var(--muted);cursor:pointer;
  border:1px solid var(--glass-border);border-radius:9px;padding:8px;transition:border-color .15s,color .15s}
.seg input{display:none}
.seg input:checked+span{color:var(--text)}
.seg label:has(input:checked){border-color:color-mix(in srgb,var(--accent) 50%,transparent);color:var(--text);background:color-mix(in srgb,var(--accent) 10%,transparent)}
.mut{font-size:12px;color:var(--dim);line-height:1.5}
.setsect{margin-bottom:20px}
.setsect h4{font-size:12px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
.swatches{display:flex;gap:10px}
.swatch{width:30px;height:30px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:transform .15s}
.swatch:hover{transform:scale(1.12)}
.swatch.on{border-color:#fff;box-shadow:0 0 0 2px var(--bg2),0 0 0 4px var(--accent)}
.toggle{display:flex;align-items:center;justify-content:space-between;padding:10px 0}
.toggle span{font-size:13.5px}
.tgl{position:relative;width:40px;height:22px;flex-shrink:0}
.tgl input{opacity:0;width:0;height:0}
.tgl i{position:absolute;inset:0;background:var(--glass-border);border-radius:12px;cursor:pointer;transition:background .18s}
.tgl i::after{content:'';position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;top:3px;left:3px;transition:left .18s}
.tgl input:checked+i{background:var(--accent)} .tgl input:checked+i::after{left:21px}
.kv{display:flex;align-items:center;justify-content:space-between;font-size:13.5px;padding:8px 0}
.kv span:first-child{color:var(--muted)} .kv span:last-child{font-weight:500}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(60px);background:var(--bg2);border:1px solid var(--glass-border);
  color:var(--text);font-size:13px;padding:10px 18px;border-radius:12px;z-index:99;transition:transform .22s;box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:80vw}
#toast.show{transform:translateX(-50%) translateY(0)}
.scrim-side{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:25;display:none}

@media(max-width:900px){
  #side{position:fixed;top:0;bottom:0;left:0;margin-left:-264px!important;box-shadow:14px 0 40px rgba(0,0,0,.35)}
  #side.openm{margin-left:0!important}
  .scrim-side.on{display:block}
  #menuBtn{display:block}
  .cards{grid-template-columns:1fr}
  .user{max-width:88%}
  .welcome{min-height:40vh}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="amb"></div>

<aside id="side" class="hide">
  <div class="side-top">
    <div class="wordmark"><div class="mark"><svg viewBox="0 0 32 32"><path d="M17.5 5 8 18h6l-1.5 9L23 13h-6z" fill="#fff"/></svg></div>Vibes Agent</div>
    <button id="closeSide" title="Hide sidebar">✕</button>
  </div>
  <button class="newchat" id="newChat">＋ New chat</button>
  <div class="ssearch"><span>⌕</span><input id="chatSearch" placeholder="Search chats"></div>
  <div id="chats"></div>
  <div class="side-bottom" id="sideBottom"></div>
</aside>
<div class="scrim-side" id="scrimSide"></div>

<div id="app">
  <header>
    <button id="menuBtn">☰</button>
    <div class="wordmark" style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600">
      <div class="mark" style="width:22px;height:22px;border-radius:6px"><svg viewBox="0 0 32 32"><path d="M17.5 5 8 18h6l-1.5 9L23 13h-6z" fill="#fff"/></svg></div>
      Vibes Agent
    </div>
    <div class="hspacer"></div>
    <button class="hbtn" id="exportMd">⤓ Export .md</button>
    <button class="hbtn" id="exportJson">⤓ .json</button>
    <button class="hbtn" id="themeBtn">☾</button>
  </header>

  <main id="main">
    <div class="col">
      <div id="chat"></div>
      <div class="welcome" id="welcome">
        <div class="mark"><svg viewBox="0 0 32 32"><path d="M17.5 5 8 18h6l-1.5 9L23 13h-6z" fill="#fff"/></svg></div>
        <h2 id="greetTitle">How can I help you today?</h2>
        <p id="greetSub">Vibes Agent — fast, private, always on.</p>
        <div class="cards">
          <button class="card" data-q="Write a Python script that renames all files in a folder to lowercase"><i>◆</i>Write a Python script that renames files in a folder</button>
          <button class="card" data-q="Explain how large language models work, in simple terms"><i>◇</i>Explain how large language models work</button>
          <button class="card" data-q="Draft a short, professional email requesting a meeting with a client"><i>◈</i>Draft a professional meeting request email</button>
          <button class="card" data-q="Give me a 7-day beginner workout plan I can do at home"><i>◉</i>Give me a 7-day beginner workout plan</button>
        </div>
        <div id="guestNote" style="margin-top:26px;display:none">
          <p style="font-size:13px">You're chatting as a guest — chats live only in this browser.</p>
          <button class="loginbtn" style="margin-top:10px;max-width:280px" onclick="UI.auth.open()">Create a free account to sync everything →</button>
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
    <div class="sync-note" id="syncNote" style="display:none">Chats are saved to your account. <button id="importBtn">Import my guest chats</button></div>
  </footer>
</div>

<div class="scrim" id="authScrim">
  <div class="modal">
    <div class="mhead"><h3 id="authTitle">Welcome to Vibes Agent</h3><button class="mclose" onclick="UI.auth.close()">✕</button></div>
    <div class="tabs">
      <button id="tabLogin" class="on">Sign in</button>
      <button id="tabSignup">Create account</button>
    </div>
    <div class="ferr" id="authErr"></div>
    <div id="loginForm">
      <div class="field"><label>Email, phone or username</label><input id="liId" autocomplete="username"></div>
      <div class="field"><label>Password</label><input id="liPass" type="password" autocomplete="current-password"></div>
      <button class="btn" id="liGo">Sign in</button>
    </div>
    <div id="signupForm" style="display:none">
      <div class="field">
        <label>Sign up with</label>
        <div class="seg">
          <label><input type="radio" name="sumode" value="email" checked><span>Email</span></label>
          <label><input type="radio" name="sumode" value="phone"><span>Phone number</span></label>
        </div>
      </div>
      <div class="field" id="suContactF"><label id="suContactL">Email</label><input id="suContact" placeholder="you@example.com"></div>
      <div class="field"><label>Your name</label><input id="suName" placeholder="e.g. Brendon"></div>
      <div class="field"><label>Username</label><input id="suUser" placeholder="lowercase, 3-20 chars" autocomplete="username"></div>
      <div class="field"><label>Password</label><input id="suPass" type="password" placeholder="at least 6 characters" autocomplete="new-password"></div>
      <button class="btn" id="suGo">Create account</button>
    </div>
  </div>
</div>

<div class="scrim" id="setScrim">
  <div class="modal wide">
    <div class="mhead"><h3>Settings</h3><button class="mclose" onclick="UI.settings.close()">✕</button></div>
    <div id="setBody"></div>
  </div>
</div>

<div id="toast"></div>

<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"><\/script>
<script>
var UI = {};
(function () {
  marked.setOptions({ breaks: true, gfm: true });
  var S = { user: null, chats: [], current: null, msgs: [], streaming: false, aborter: null, stick: true };
  var $ = function (id) { return document.getElementById(id); };
  var main = $('main'), chatEl = $('chat'), input = $('input'), sendBtn = $('send');
  var BOLT = '<svg viewBox="0 0 32 32"><path d="M17.5 5 8 18h6l-1.5 9L23 13h-6z" fill="#fff"/></svg>';
  var ARROW = '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2.5 8 12M8 12l-4-4M8 12l4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var STOP = '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
  var EXT = { python:'py', py:'py', javascript:'js', js:'js', typescript:'ts', ts:'ts', json:'json', html:'html', css:'css',
    java:'java', c:'c', cpp:'cpp', 'c++':'cpp', cs:'cs', csharp:'cs', php:'php', ruby:'rb', rb:'rb', go:'go', rust:'rs', rs:'rs',
    sql:'sql', bash:'sh', sh:'sh', shell:'sh', yaml:'yml', yml:'yml', xml:'xml', markdown:'md', md:'md', csv:'csv',
    text:'txt', txt:'txt', swift:'swift', kotlin:'kt', kt:'kt', dart:'dart', r:'r', toml:'toml', ini:'ini' };

  /* ---------- appearance ---------- */
  var LS = { theme: 'vibes-theme', accent: 'vibes-accent', guest: 'vibes-guest-chats', greet: 'vibes-guest-greeting' };
  function applyLook() {
    var t = localStorage.getItem(LS.theme) || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    var a = localStorage.getItem(LS.accent) || 'violet';
    if (a !== 'violet') document.documentElement.setAttribute('data-accent', a);
    else document.documentElement.removeAttribute('data-accent');
    $('themeBtn').textContent = t === 'dark' ? '☀' : '☾';
  }
  applyLook();
  $('themeBtn').onclick = function () {
    localStorage.setItem(LS.theme, localStorage.getItem(LS.theme) === 'light' ? 'dark' : 'light');
    applyLook();
  };

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- chats model ---------- */
  var logged = function () { return !!S.user; };
  function loadGuest() {
    try { S.chats = JSON.parse(localStorage.getItem(LS.guest) || '[]'); } catch (e) { S.chats = []; }
  }
  function saveGuest() { localStorage.setItem(LS.guest, JSON.stringify(S.chats.slice(0, 60))); }
  async function api(method, path, body) {
    var res = await fetch(path, { method: method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    var d = await res.json();
    if (!res.ok) throw new Error(d.error || ('error ' + res.status));
    return d;
  }
  function guestChat(id) {
    var c = S.chats.find(function (x) { return x.id === id; });
    if (!c) { c = { id: id, title: 'New chat', created_at: Date.now(), updated_at: Date.now(), messages: [] }; S.chats.unshift(c); }
    return c;
  }

  /* ---------- sidebar ---------- */
  function renderSide(filter) {
    var box = $('chats'); box.innerHTML = '';
    var q = (filter || '').toLowerCase();
    S.chats.filter(function (c) { return !q || (c.title || '').toLowerCase().indexOf(q) >= 0; }).forEach(function (c) {
      var chip = document.createElement('div');
      chip.className = 'chip' + (S.current === c.id ? ' on' : '');
      var t = document.createElement('span'); t.className = 't'; t.textContent = c.title || 'New chat';
      var tools = document.createElement('span'); tools.className = 'tools';
      var edit = document.createElement('button'); edit.textContent = '✎'; edit.title = 'Rename';
      var del = document.createElement('button'); del.className = 'del'; del.textContent = '✕'; del.title = 'Delete';
      var arm = null;
      edit.onclick = function (ev) { ev.stopPropagation(); renameChat(c, chip); };
      del.onclick = function (ev) {
        ev.stopPropagation();
        if (!arm) { arm = true; del.classList.add('arm'); del.textContent = '✕ sure?';
          setTimeout(function () { arm = null; del.classList.remove('arm'); del.textContent = '✕'; }, 2600); return; }
        deleteChat(c.id);
      };
      tools.appendChild(edit); tools.appendChild(del);
      chip.appendChild(t); chip.appendChild(tools);
      chip.onclick = function () { openChat(c.id); if (innerWidth <= 900) toggleSide(false); };
      box.appendChild(chip);
    });
    renderBottom();
  }
  function renderBottom() {
    var b = $('sideBottom');
    if (S.user) {
      b.innerHTML = '';
      var chip = document.createElement('div'); chip.className = 'userchip';
      chip.innerHTML = '<div class="avatar">' + esc(S.user.name.charAt(0).toUpperCase()) + '</div><div class="umeta"><b>' + esc(S.user.name) + '</b><span>@' + esc(S.user.username) + '</span></div>';
      chip.onclick = function () { UI.settings.open(); };
      b.appendChild(chip);
    } else {
      b.innerHTML = '';
      var btn = document.createElement('button'); btn.className = 'loginbtn';
      btn.innerHTML = '👤 Sign in / Create account';
      btn.onclick = function () { UI.auth.open(); };
      b.appendChild(btn);
    }
  }
  function renameChat(c, chip) {
    var span = chip.querySelector('.t');
    var inp = document.createElement('input'); inp.value = c.title || '';
    span.replaceWith(inp); inp.focus(); inp.select();
    var done = false;
    var commit = async function () {
      if (done) return; done = true;
      var v = inp.value.trim().slice(0, 80) || 'New chat';
      c.title = v;
      if (logged()) { try { await api('PATCH', '/api/chats/' + c.id, { title: v }); } catch (e) {} }
      else saveGuest();
      renderSide($('chatSearch').value);
    };
    inp.onblur = commit;
    inp.onkeydown = function (e) {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { done = true; renderSide($('chatSearch').value); }
    };
    inp.onclick = function (e) { e.stopPropagation(); };
  }
  async function deleteChat(id) {
    if (logged()) { try { await api('DELETE', '/api/chats/' + id); } catch (e) {} }
    else { S.chats = S.chats.filter(function (x) { return x.id !== id; }); saveGuest(); }
    S.chats = S.chats.filter(function (x) { return x.id !== id; });
    if (S.current === id) newChat();
    renderSide($('chatSearch').value);
    toast('Chat deleted');
  }
  $('chatSearch').oninput = function () { renderSide(this.value); };

  function toggleSide(open) {
    var side = $('side'), scrim = $('scrimSide');
    var isMobile = innerWidth <= 900;
    if (isMobile) {
      var willOpen = open === undefined ? !side.classList.contains('openm') : open;
      side.classList.toggle('openm', willOpen); scrim.classList.toggle('on', willOpen);
    } else {
      var w = open === undefined ? side.classList.contains('hide') : open;
      side.classList.toggle('hide', !w);
    }
  }
  $('menuBtn').onclick = function () { toggleSide(); };
  $('closeSide').onclick = function () { toggleSide(false); };
  $('scrimSide').onclick = function () { toggleSide(false); };

  /* ---------- rendering ---------- */
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function render(text) { return DOMPurify.sanitize(marked.parse(text)); }
  function decorate(root) {
    root.querySelectorAll('pre').forEach(function (pre) {
      if (pre.parentElement.classList.contains('codewrap')) return;
      var codeEl = pre.querySelector('code');
      var m = (codeEl ? codeEl.className : '').match(/language-([\\w+#-]+)/);
      var lang = m ? m[1].toLowerCase() : 'text';
      var ext = EXT[lang] || 'txt';
      var wrap = document.createElement('div'); wrap.className = 'codewrap';
      var head = document.createElement('div'); head.className = 'codehead';
      var label = document.createElement('span'); label.textContent = lang;
      var acts = document.createElement('span'); acts.className = 'acts';
      var cp = document.createElement('button'); cp.textContent = '⧉ Copy';
      cp.onclick = function () {
        navigator.clipboard.writeText(codeEl ? codeEl.innerText : pre.innerText).then(function () {
          cp.textContent = '✓ Copied'; setTimeout(function () { cp.textContent = '⧉ Copy'; }, 1400);
        });
      };
      var dl = document.createElement('button'); dl.textContent = '⤓ Download .' + ext;
      dl.onclick = function () {
        var code = codeEl ? codeEl.innerText : pre.innerText;
        dlFile('vibes-agent-snippet.' + ext, code, 'text/plain;charset=utf-8');
        dl.textContent = '✓ Saved'; setTimeout(function () { dl.textContent = '⤓ Download .' + ext; }, 1400);
      };
      acts.appendChild(cp); acts.appendChild(dl);
      head.appendChild(label); head.appendChild(acts);
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(head); wrap.appendChild(pre);
    });
  }
  function dlFile(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function nearBottom() { return main.scrollHeight - main.scrollTop - main.clientHeight < 90; }
  main.onscroll = function () { S.stick = nearBottom(); };
  function scrollDown(force) { if (force || S.stick) main.scrollTop = main.scrollHeight; }

  function addUser(text) {
    var el = document.createElement('div'); el.className = 'user'; el.textContent = text;
    chatEl.appendChild(el); S.stick = true; scrollDown(true);
  }
  function addAssistant() {
    var turn = document.createElement('div'); turn.className = 'assistant thinking';
    turn.innerHTML = '<div class="a-mark">' + BOLT + '</div><div class="a-wrap"><div class="a-head"><b>Vibes Agent</b></div><div class="a-body"></div></div>';
    chatEl.appendChild(turn); return turn;
  }
  function finishAssistant(turn, text, last) {
    var body = turn.querySelector('.a-body');
    body.innerHTML = render(text); decorate(body);
    var wrap = turn.querySelector('.a-wrap');
    var tools = document.createElement('div'); tools.className = 'msgtools';
    var cp = document.createElement('button'); cp.textContent = '⧉ Copy';
    cp.onclick = function () {
      navigator.clipboard.writeText(text).then(function () { cp.textContent = '✓ Copied'; setTimeout(function () { cp.textContent = '⧉ Copy'; }, 1400); });
    };
    tools.appendChild(cp);
    if (last) {
      var rg = document.createElement('button'); rg.className = 'regen'; rg.textContent = '↻ Regenerate';
      rg.onclick = function () { regenerate(); };
      tools.appendChild(rg);
    }
    wrap.appendChild(tools);
    scrollDown();
  }

  function welcomeGreeting() {
    var name = S.user ? (S.user.name || '').split(' ')[0] : '';
    var greetOn = S.user ? (S.user.settings || {}).greeting !== false : localStorage.getItem(LS.greet) !== 'off';
    $('greetTitle').textContent = (name && greetOn) ? ('How can I help you, ' + name + '?') : 'How can I help you today?';
    $('greetSub').textContent = S.user
      ? 'Welcome back, ' + S.user.name + ' · your chats are synced'
      : 'Vibes Agent — fast, private, always on.';
    $('guestNote').style.display = S.user ? 'none' : 'block';
  }

  /* ---------- chat lifecycle ---------- */
  function newChat() {
    S.current = S.user ? null : crypto.randomUUID();
    S.msgs = [];
    chatEl.innerHTML = '';
    $('welcome').style.display = '';
    renderSide($('chatSearch').value);
    input.focus();
  }
  async function openChat(id) {
    if (logged()) {
      try {
        var d = await api('GET', '/api/chats/' + id);
        S.current = id; S.msgs = d.messages.map(function (m) { return { role: m.role, content: m.content }; });
        paintFromMsgs();
        renderSide($('chatSearch').value);
      } catch (e) { toast(e.message); }
    } else {
      var c = guestChat(id);
      S.current = id; S.msgs = (c.messages || []).slice();
      paintFromMsgs();
      renderSide($('chatSearch').value);
    }
  }
  function paintFromMsgs() {
    chatEl.innerHTML = '';
    $('welcome').style.display = 'none';
    for (var i = 0; i < S.msgs.length; i++) {
      var m = S.msgs[i];
      if (m.role === 'user') addUser(m.content);
      else finishAssistant(addAssistant(), m.content, i === S.msgs.length - 1);
    }
    S.stick = true; scrollDown(true);
  }

  function persistUserMsg(text) {
    var cid = S.current;
    if (logged()) { if (!cid) { cid = crypto.randomUUID(); S.current = cid; } }
    else {
      if (!cid) { cid = crypto.randomUUID(); S.current = cid; }
      var c = guestChat(cid);
      c.messages.push({ role: 'user', content: text });
      c.updated_at = Date.now();
      if (c.title === 'New chat') c.title = text.slice(0, 48);
      saveGuest();
      renderSide($('chatSearch').value);
    }
    return cid;
  }

  function currentPrefs() {
    if (S.user) return S.user.settings || {};
    return { custom: '', tone: 'balanced', length: 'balanced' };
  }

  async function send(text) {
    if (!text) text = input.value.trim();
    if (!text || S.streaming) return;
    $('welcome').style.display = 'none';
    input.value = ''; input.style.height = 'auto'; updateSend();
    addUser(text);
    S.msgs.push({ role: 'user', content: text });
    var cid = persistUserMsg(text);

    S.streaming = true; S.stick = true; scrollDown(true);
    var turn = addAssistant(); setBusy(true);
    var full = '';
    S.aborter = new AbortController();
    try {
      var res = await fetch('/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: S.msgs.slice(-20), chat_id: cid, prefs: currentPrefs() }),
        signal: S.aborter.signal
      });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', lastPaint = 0;
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var lines = buf.split('\\n'); buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.indexOf('data:') !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            var delta = JSON.parse(payload).choices[0].delta.content;
            if (delta) full += delta;
          } catch (e) {}
        }
        var now = Date.now();
        if (now - lastPaint > 90 && full) {
          lastPaint = now;
          turn.classList.remove('thinking');
          turn.querySelector('.a-body').innerHTML = render(full) + '<span class="caret"></span>';
          scrollDown();
        }
      }
      if (!full) throw new Error('empty response');
      finishAssistant(turn, full, true);
      S.msgs.push({ role: 'assistant', content: full });
      if (!logged()) {
        var c = guestChat(cid);
        c.messages.push({ role: 'assistant', content: full }); c.updated_at = Date.now(); saveGuest();
        renderSide($('chatSearch').value);
      } else {
        try { var dl2 = await api('GET', '/api/chats'); S.chats = dl2.chats; } catch (e) {}
        renderSide($('chatSearch').value);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        if (full) { finishAssistant(turn, full, true); S.msgs.push({ role: 'assistant', content: full }); }
        else turn.remove();
      } else {
        turn.classList.remove('thinking');
        turn.querySelector('.a-body').innerHTML = '<span style="color:#e0836d">⚠ ' + esc(String(e.message || e)) + '</span>';
      }
    }
    S.streaming = false; setBusy(false); input.focus();
  }

  async function regenerate() {
    if (S.streaming) return;
    var lastUser = null;
    for (var i = S.msgs.length - 1; i >= 0; i--) if (S.msgs[i].role === 'user') { lastUser = S.msgs[i].content; break; }
    if (!lastUser) return;
    while (S.msgs.length && S.msgs[S.msgs.length - 1].role === 'assistant') S.msgs.pop();
    chatEl.removeChild(chatEl.lastElementChild);
    if (!logged() && S.current) {
      var c = guestChat(S.current);
      while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop();
      saveGuest();
    }
    await send(lastUser);
  }

  function setBusy(on) { sendBtn.innerHTML = on ? STOP : ARROW; sendBtn.classList.toggle('ready', on ? true : input.value.trim().length > 0); }
  function updateSend() { if (!S.streaming) sendBtn.classList.toggle('ready', input.value.trim().length > 0); }
  sendBtn.onclick = function () { if (S.streaming) S.aborter.abort(); else send(); };
  input.oninput = function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 176) + 'px'; updateSend(); };
  input.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  $('newChat').onclick = function () { newChat(); if (innerWidth <= 900) toggleSide(false); };
  document.querySelectorAll('.card').forEach(function (c) {
    c.onclick = function () { send(c.getAttribute('data-q')); };
  });

  /* ---------- export ---------- */
  function exportChat(asJson) {
    if (!S.msgs.length) { toast('Nothing to export yet'); return; }
    if (asJson) {
      dlFile('vibes-chat.json', JSON.stringify({ agent: 'Vibes Agent', exported: new Date().toISOString(), messages: S.msgs }, null, 2), 'application/json');
    } else {
      var md = '# Vibes Agent chat\\n\\n';
      S.msgs.forEach(function (m) { md += (m.role === 'user' ? '**You:** ' : '**Vibes Agent:** ') + m.content + '\\n\\n---\\n\\n'; });
      dlFile('vibes-chat.md', md, 'text/markdown;charset=utf-8');
    }
    toast('Downloaded');
  }
  $('exportMd').onclick = function () { exportChat(false); };
  $('exportJson').onclick = function () { exportChat(true); };

  /* ---------- auth ---------- */
  UI.auth = {
    open: function (signup) {
      $('authScrim').classList.add('open');
      UI.auth.tab(signup ? 'signup' : 'login');
    },
    close: function () { $('authScrim').classList.remove('open'); $('authErr').textContent = ''; },
    tab: function (which) {
      var login = which === 'login';
      $('tabLogin').classList.toggle('on', login); $('tabSignup').classList.toggle('on', !login);
      $('loginForm').style.display = login ? '' : 'none';
      $('signupForm').style.display = login ? 'none' : '';
      $('authErr').textContent = '';
    }
  };
  $('tabLogin').onclick = function () { UI.auth.tab('login'); };
  $('tabSignup').onclick = function () { UI.auth.tab('signup'); };
  document.querySelectorAll('input[name=sumode]').forEach(function (r) {
    r.onchange = function () {
      var email = r.value === 'email' && r.checked;
      if (r.checked) {
        $('suContactL').textContent = email ? 'Email' : 'Phone number';
        $('suContact').placeholder = email ? 'you@example.com' : '+263 77 123 4567';
      }
    };
  });
  $('liGo').onclick = doLogin;
  $('liPass').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
  $('suGo').onclick = doSignup;

  async function doLogin() {
    var err = $('authErr');
    err.textContent = '';
    try {
      var d = await api('POST', '/api/login', { identifier: $('liId').value.trim(), password: $('liPass').value });
      await onAuthed(d.user);
      UI.auth.close(); toast('Welcome back, ' + d.user.name.split(' ')[0] + '!');
    } catch (e) { err.textContent = e.message; }
  }
  async function doSignup() {
    var err = $('authErr'); err.textContent = '';
    var mode = document.querySelector('input[name=sumode]:checked').value;
    try {
      var d = await api('POST', '/api/signup', {
        mode: mode, contact: $('suContact').value.trim(), name: $('suName').value.trim(),
        username: $('suUser').value.trim(), password: $('suPass').value
      });
      await onAuthed(d.user);
      UI.auth.close(); toast('Account created. Welcome, ' + d.user.name.split(' ')[0] + '!');
    } catch (e) { err.textContent = e.message; }
  }

  async function onAuthed(user) {
    S.user = user;
    var d = await api('GET', '/api/chats');
    S.chats = d.chats;
    var guests = [];
    try { guests = JSON.parse(localStorage.getItem(LS.guest) || '[]'); } catch (e) {}
    if (guests.length) $('syncNote').style.display = '';
    $('syncNote').style.display = guests.length ? '' : 'none';
    renderSide(''); newChat(); welcomeGreeting(); renderBottom();
  }
  $('importBtn').onclick = async function () {
    try {
      var guests = JSON.parse(localStorage.getItem(LS.guest) || '[]');
      if (!guests.length) return;
      await api('POST', '/api/chats', { import: guests });
      localStorage.removeItem(LS.guest);
      var d = await api('GET', '/api/chats'); S.chats = d.chats;
      $('syncNote').style.display = 'none';
      renderSide(''); toast('Guest chats imported');
    } catch (e) { toast(e.message); }
  };

  /* ---------- settings ---------- */
  UI.settings = {
    open: function () { buildSettings(); $('setScrim').classList.add('open'); },
    close: function () { $('setScrim').classList.remove('open'); }
  };
  function buildSettings() {
    var b = $('setBody'); b.innerHTML = '';
    var u = S.user;
    var sect = function (title) {
      var s = document.createElement('div'); s.className = 'setsect';
      var h = document.createElement('h4'); h.textContent = title; s.appendChild(h);
      b.appendChild(s); return s;
    };

    if (!u) {
      var s1 = sect('Account');
      var p = document.createElement('p'); p.className = 'mut';
      p.textContent = 'Create a free account to sync your chats across devices, unlock personalization and manage your history.';
      s1.appendChild(p);
      var btn = document.createElement('button'); btn.className = 'btn'; btn.style.marginTop = '10px'; btn.textContent = 'Create account / Sign in';
      btn.onclick = function () { UI.settings.close(); UI.auth.open(); };
      s1.appendChild(btn);
    } else {
      var sp = sect('Profile');
      sp.insertAdjacentHTML('beforeend', '<div class="kv"><span>Username</span><span>@' + esc(u.username) + '</span></div>');
      var f = document.createElement('div'); f.className = 'field'; f.style.margin = '10px 0 8px';
      f.innerHTML = '<label>Display name</label>';
      var nm = document.createElement('input'); nm.value = u.name; f.appendChild(nm);
      var saveBtn = document.createElement('button'); saveBtn.className = 'btn ghost'; saveBtn.style.marginTop = '4px'; saveBtn.textContent = 'Save name';
      saveBtn.onclick = async function () {
        try { await api('POST', '/api/profile', { name: nm.value }); S.user.name = nm.value.trim(); renderBottom(); welcomeGreeting(); toast('Name updated'); }
        catch (e) { toast(e.message); }
      };
      sp.appendChild(f); sp.appendChild(saveBtn);

      var st = (u.settings || {});
      var s2 = sect('Personalization');
      var f1 = document.createElement('div'); f1.className = 'field';
      f1.innerHTML = '<label>Tone</label>';
      var sel1 = document.createElement('select');
      [['friendly', 'Friendly & casual'], ['balanced', 'Balanced (default)'], ['professional', 'Professional']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel1.appendChild(op);
      });
      sel1.value = st.tone || 'balanced'; f1.appendChild(sel1);
      var f2 = document.createElement('div'); f2.className = 'field'; f2.style.marginTop = '8px';
      f2.innerHTML = '<label>Response length</label>';
      var sel2 = document.createElement('select');
      [['concise', 'Concise'], ['balanced', 'Balanced (default)'], ['detailed', 'Detailed']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel2.appendChild(op);
      });
      sel2.value = st.length || 'balanced'; f2.appendChild(sel2);
      var f3 = document.createElement('div'); f3.className = 'field'; f3.style.marginTop = '8px';
      f3.innerHTML = '<label>Custom instructions — what should Vibes Agent know about you?</label>';
      var ta = document.createElement('textarea'); ta.maxLength = 600; ta.placeholder = 'e.g. I am a developer in Harare; I prefer practical code examples; call me B';
      ta.value = st.custom || ''; f3.appendChild(ta);
      var tg = document.createElement('div'); tg.className = 'toggle';
      tg.innerHTML = '<span>Greet me by name on the home screen</span>';
      var lab = document.createElement('label'); lab.className = 'tgl';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.greeting !== false;
      lab.appendChild(cb); lab.insertAdjacentHTML('beforeend', '<i></i>'); tg.appendChild(lab);
      var pBtn = document.createElement('button'); pBtn.className = 'btn ghost'; pBtn.style.marginTop = '6px'; pBtn.textContent = 'Save personalization';
      pBtn.onclick = async function () {
        var settings = { tone: sel1.value, length: sel2.value, custom: ta.value, greeting: cb.checked };
        try { await api('POST', '/api/settings', { settings: settings }); S.user.settings = settings; welcomeGreeting(); toast('Personalization saved'); }
        catch (e) { toast(e.message); }
      };
      s2.appendChild(f1); s2.appendChild(f2); s2.appendChild(f3); s2.appendChild(tg); s2.appendChild(pBtn);
    }

    var s3 = sect('Appearance');
    var row1 = document.createElement('div'); row1.className = 'toggle';
    row1.innerHTML = '<span>Light theme</span>';
    var l1 = document.createElement('label'); l1.className = 'tgl';
    var c1 = document.createElement('input'); c1.type = 'checkbox'; c1.checked = localStorage.getItem(LS.theme) === 'light';
    c1.onchange = function () { localStorage.setItem(LS.theme, c1.checked ? 'light' : 'dark'); applyLook(); };
    l1.appendChild(c1); l1.insertAdjacentHTML('beforeend', '<i></i>'); row1.appendChild(l1);
    s3.appendChild(row1);
    var fsw = document.createElement('div'); fsw.className = 'field'; fsw.style.marginTop = '8px';
    fsw.innerHTML = '<label>Accent color</label>';
    var sw = document.createElement('div'); sw.className = 'swatches';
    [['violet', '#7c6cf0'], ['blue', '#3b82f6'], ['teal', '#14b8a6'], ['amber', '#f59e0b'], ['pink', '#ec4899']].forEach(function (a) {
      var d = document.createElement('div'); d.className = 'swatch'; d.style.background = a[1]; d.title = a[0];
      d.onclick = function () { localStorage.setItem(LS.accent, a[0]); applyLook(); buildSettings(); };
      sw.appendChild(d);
    });
    fsw.appendChild(sw); s3.appendChild(fsw);

    if (u) {
      var s4 = sect('Account & security');
      s4.insertAdjacentHTML('beforeend', '<div class="field"><label>Current password</label><input type="password" id="cpw"></div>' +
        '<div class="field"><label>New password</label><input type="password" id="npw" placeholder="at least 6 characters"></div>');
      var pwBtn = document.createElement('button'); pwBtn.className = 'btn ghost'; pwBtn.textContent = 'Change password';
      pwBtn.onclick = async function () {
        try { await api('POST', '/api/password', { current: $('cpw').value, next: $('npw').value }); $('cpw').value = ''; $('npw').value = ''; toast('Password updated'); }
        catch (e) { toast(e.message); }
      };
      s4.appendChild(pwBtn);
      var outBtn = document.createElement('button'); outBtn.className = 'btn ghost'; outBtn.style.marginTop = '8px'; outBtn.textContent = 'Sign out';
      outBtn.onclick = async function () {
        await api('POST', '/api/logout');
        S.user = null; S.chats = []; loadGuest(); renderSide(''); newChat(); welcomeGreeting(); renderBottom();
        UI.settings.close(); toast('Signed out');
      };
      s4.appendChild(outBtn);
      var delBtn = document.createElement('button'); delBtn.className = 'btn danger'; delBtn.style.marginTop = '8px'; delBtn.textContent = 'Delete my account and all chats';
      delBtn.onclick = async function () {
        var t = delBtn.textContent, arm = null;
        if (!arm) { arm = true; delBtn.textContent = 'Tap again to permanently delete'; setTimeout(function () { arm = null; delBtn.textContent = t; }, 3000); return; }
        try {
          await api('DELETE', '/api/account');
          S.user = null; S.chats = []; loadGuest(); renderSide(''); newChat(); welcomeGreeting(); renderBottom();
          UI.settings.close(); toast('Account deleted');
        } catch (e) { toast(e.message); }
      };
      s4.appendChild(delBtn);
    }
    var s5 = sect('About');
    s5.insertAdjacentHTML('beforeend', '<p class="mut">Vibes Agent — free AI assistant by Brendon Pikirai, part of the Vibes ecosystem. Your account data lives on your own private infrastructure.</p>');
  }

  /* ---------- boot ---------- */
  (async function boot() {
    try {
      var me = await api('GET', '/api/me');
      if (me.user) {
        S.user = me.user;
        var d = await api('GET', '/api/chats');
        S.chats = d.chats;
        var guests = [];
        try { guests = JSON.parse(localStorage.getItem(LS.guest) || '[]'); } catch (e) {}
        $('syncNote').style.display = guests.length ? '' : 'none';
      } else { loadGuest(); }
    } catch (e) { loadGuest(); }
    renderSide(''); welcomeGreeting(); newChat();
    if (innerWidth > 900) toggleSide(true);
  })();
})();
<\/script>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ status: "ok", agent: "Vibes Agent" });
    }
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML, { headers: { "content-type": "text/html;charset=UTF-8", "cache-control": "public, max-age=300" } });
    }
    if (url.pathname === "/chat" && request.method === "POST") {
      return chat(request, env, ctx);
    }
    if (url.pathname.startsWith("/api/")) {
      return api(request, env, url);
    }
    return new Response("Not found", { status: 404 });
  }
};
