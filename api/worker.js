/* ⚡ Vibes Agent — public app API worker.
   /chat streaming + full accounts & chat-history API (D1) + sessions (KV).
   Identity rules enforced server-side. CORS open to any origin with credentials. */

const ITER = 30000;

/* ---------------- helpers ---------------- */
const j2 = o => JSON.stringify(o);
function cors(request) {
  const o = request.headers.get("Origin") || "*";
  return {
    "access-control-allow-origin": o,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "vary": "Origin"
  };
}
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
  return COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=" + maxAge;
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

/* ---------------- accounts & chats API ---------------- */
async function api(request, env, url) {
  const C = cors(request);
  const path = url.pathname;
  const method = request.method;
  const body = (method === "POST" || method === "PATCH" || method === "DELETE") ? await request.json().catch(() => ({})) : {};

  if (path === "/api/signup" && method === "POST") {
    const { mode, contact, username, name, password } = body;
    const uname = String(username || "").toLowerCase();
    if (!RX_USER.test(uname)) return json({ error: "Username: 3-20 chars, letters/numbers/_" }, 400, C);
    const email = mode === "email" ? String(contact || "").trim().toLowerCase() : null;
    const phone = mode === "phone" ? normPhone(String(contact || "")) : null;
    if (mode === "email" && !RX_EMAIL.test(email || "")) return json({ error: "Enter a valid email address" }, 400, C);
    if (mode === "phone" && !/^\d{7,15}$/.test(phone || "")) return json({ error: "Enter a valid phone number" }, 400, C);
    if (!name || String(name).trim().length < 1) return json({ error: "Enter your name" }, 400, C);
    if (!password || String(password).length < 6) return json({ error: "Password must be at least 6 characters" }, 400, C);
    const clash = await env.DB.prepare("SELECT id FROM users WHERE username=? OR email=? OR phone=?").bind(uname, email, phone).first();
    if (clash) return json({ error: "That username or contact is already registered" }, 409, C);
    const salt = randHex(16);
    const hash = await hashPass(String(password), salt);
    try {
      await env.DB.prepare("INSERT INTO users (username,email,phone,name,pass_hash,salt,settings,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(uname, email, phone, String(name).trim().slice(0, 40), hash, salt, "{}", Date.now()).run();
    } catch (e) { return json({ error: "Could not create account" }, 409, C); }
    const u = await env.DB.prepare("SELECT id, username, name, settings FROM users WHERE username=?").bind(uname).first();
    const token = randHex(24);
    await env.SESSIONS.put("sess:" + token, j2({ uid: u.id }), { expirationTtl: 2592000 });
    return json({ user: { username: u.username, name: u.name, settings: JSON.parse(u.settings || "{}") } }, 200,
      { ...C, "Set-Cookie": setCookie(token, 2592000) });
  }

  if (path === "/api/login" && method === "POST") {
    const id = String(body.identifier || "").trim();
    const pw = String(body.password || "");
    if (!id || !pw) return json({ error: "Enter your login and password" }, 400, C);
    const u = await env.DB.prepare("SELECT * FROM users WHERE username=? OR email=? OR phone=?")
      .bind(id.toLowerCase(), id.toLowerCase(), normPhone(id)).first();
    if (!u) return json({ error: "No account found with those details" }, 401, C);
    if (await hashPass(pw, u.salt) !== u.pass_hash) return json({ error: "Wrong password" }, 401, C);
    const token = randHex(24);
    await env.SESSIONS.put("sess:" + token, j2({ uid: u.id }), { expirationTtl: 2592000 });
    return json({ user: { username: u.username, name: u.name, settings: JSON.parse(u.settings || "{}") } }, 200,
      { ...C, "Set-Cookie": setCookie(token, 2592000) });
  }

  if (path === "/api/logout" && method === "POST") {
    const m = (request.headers.get("Cookie") || "").match(new RegExp(COOKIE + "=([a-f0-9]{32,})"));
    if (m) await env.SESSIONS.delete("sess:" + m[1]);
    return json({ ok: true }, 200, { ...C, "Set-Cookie": setCookie("", 0) });
  }

  if (path === "/api/me" && method === "GET") {
    const u = await getUser(request, env);
    if (!u) return json({ user: null }, 200, C);
    return json({ user: { username: u.username, name: u.name, settings: JSON.parse(u.settings || "{}") } }, 200, C);
  }

  if (path === "/api/profile" && method === "POST") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401, C);
    const name = String(body.name || "").trim().slice(0, 40);
    if (!name) return json({ error: "Name can't be empty" }, 400, C);
    await env.DB.prepare("UPDATE users SET name=? WHERE id=?").bind(name, u.id).run();
    return json({ ok: true, name }, 200, C);
  }

  if (path === "/api/settings" && method === "POST") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401, C);
    const s = body.settings || {};
    const clean = {
      tone: ["friendly", "balanced", "professional"].includes(s.tone) ? s.tone : "balanced",
      length: ["concise", "balanced", "detailed"].includes(s.length) ? s.length : "balanced",
      greeting: s.greeting !== false,
      custom: typeof s.custom === "string" ? s.custom.slice(0, 600) : ""
    };
    await env.DB.prepare("UPDATE users SET settings=? WHERE id=?").bind(j2(clean), u.id).run();
    return json({ ok: true, settings: clean }, 200, C);
  }

  if (path === "/api/password" && method === "POST") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401, C);
    const row = await env.DB.prepare("SELECT pass_hash, salt FROM users WHERE id=?").bind(u.id).first();
    if (await hashPass(String(body.current || ""), row.salt) !== row.pass_hash) return json({ error: "Current password is wrong" }, 401, C);
    if (!body.next || String(body.next).length < 6) return json({ error: "New password must be at least 6 characters" }, 400, C);
    const salt = randHex(16);
    await env.DB.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(await hashPass(String(body.next), salt), salt, u.id).run();
    return json({ ok: true }, 200, C);
  }

  if (path === "/api/account" && method === "DELETE") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401, C);
    await env.DB.prepare("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id=?)").bind(u.id).run();
    await env.DB.prepare("DELETE FROM chats WHERE user_id=?").bind(u.id).run();
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(u.id).run();
    const m = (request.headers.get("Cookie") || "").match(new RegExp(COOKIE + "=([a-f0-9]{32,})"));
    if (m) await env.SESSIONS.delete("sess:" + m[1]);
    return json({ ok: true }, 200, { ...C, "Set-Cookie": setCookie("", 0) });
  }

  if (path === "/api/chats" && method === "GET") {
    const u = await getUser(request, env);
    if (!u) return json({ chats: [] }, 200, C);
    const { results } = await env.DB.prepare(
      "SELECT id, title, created_at, updated_at FROM chats WHERE user_id=? ORDER BY updated_at DESC LIMIT 200").bind(u.id).all();
    return json({ chats: results }, 200, C);
  }

  if (path === "/api/chats" && method === "POST") {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401, C);
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
      return json({ ok: true }, 200, C);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO chats (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)")
      .bind(id, u.id, "New chat", Date.now(), Date.now()).run();
    return json({ id }, 200, C);
  }

  const cm = path.match(/^\/api\/chats\/([a-f0-9-]{8,36})$/);
  if (cm) {
    const u = await getUser(request, env);
    if (!u) return json({ error: "not signed in" }, 401, C);
    const chatId = cm[1];
    const chat = await env.DB.prepare("SELECT id, title FROM chats WHERE id=? AND user_id=?").bind(chatId, u.id).first();
    if (!chat) return json({ error: "not found" }, 404, C);
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT role, content FROM messages WHERE chat_id=? ORDER BY id").bind(chatId).all();
      return json({ chat, messages: results }, 200, C);
    }
    if (method === "PATCH") {
      await env.DB.prepare("UPDATE chats SET title=? WHERE id=?").bind(String(body.title || "New chat").slice(0, 80), chatId).run();
      return json({ ok: true }, 200, C);
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM messages WHERE chat_id=?").bind(chatId).run();
      await env.DB.prepare("DELETE FROM chats WHERE id=?").bind(chatId).run();
      return json({ ok: true }, 200, C);
    }
  }

  return json({ error: "not found" }, 404, C);
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
  const C = cors(request);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400, C); }
  const clean = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && typeof m.content === "string")
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.slice(0, 6000) }))
    .slice(-20);
  if (!clean.length) return json({ error: "nothing to send" }, 400, C);

  const user = await getUser(request, env);
  let chatId = /^[a-f0-9-]{8,36}$/.test(body.chat_id || "") ? body.chat_id : null;
  if (user && chatId) {
    const owned = await env.DB.prepare("SELECT id FROM chats WHERE id=? AND user_id=?").bind(chatId, user.id).first();
    if (!owned)
      await env.DB.prepare("INSERT OR IGNORE INTO chats (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)")
        .bind(chatId, user.id, "New chat", Date.now(), Date.now()).run();
    const first = clean[clean.length - 1];
    await env.DB.prepare("INSERT INTO messages (chat_id,role,content,created_at) VALUES (?,?,?,?)")
      .bind(chatId, "user", first.content, Date.now()).run();
    const ch = await env.DB.prepare("SELECT title FROM chats WHERE id=?").bind(chatId).first();
    if (ch && ch.title === "New chat" && first.role === "user")
      await env.DB.prepare("UPDATE chats SET title=?, updated_at=? WHERE id=?")
        .bind(first.content.slice(0, 48), Date.now(), chatId).run();
  }

  const settings = user ? JSON.parse(user.settings || "{}") : {};
  const prefs = (body.prefs && typeof body.prefs === "object" && Object.keys(body.prefs).length) ? body.prefs : settings;
  const sys = SYSTEM + "\n" + prefsSystem(prefs);

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
    if (!upstream.ok || !upstream.body) return json({ error: "upstream error" }, 502, C);

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
        "x-accel-buffering": "no", ...C } });
    }
    return new Response(upstream.body, { headers: {
      "content-type": "text/event-stream", "cache-control": "no-cache",
      "x-accel-buffering": "no", ...C } });
  } catch (e) { return json({ error: "unavailable" }, 502, C); }
}

/* ---------------- routes ---------------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const C = cors(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: C });
    }
    if (url.pathname === "/health") {
      return json({ status: "ok", agent: "Vibes Agent" }, 200, C);
    }
    if (url.pathname === "/chat" && request.method === "POST") {
      return chat(request, env, ctx);
    }
    if (url.pathname.startsWith("/api/")) {
      return api(request, env, url);
    }
    return new Response("Vibes Agent API", { headers: { "content-type": "text/plain", ...C } });
  }
};
