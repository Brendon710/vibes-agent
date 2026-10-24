/* ⚡ Vibes Agent — Telegram AI bot on Cloudflare Workers
   Config: new bot token, Gemini (with Groq fallback), KV-backed memory. */

// module workers expose bindings via env — bind them on each request
let TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, GROQ_API_KEY, GEMINI_MODEL,
    ADMIN_USER_ID, OWNER_NAME, OWNER_PHONE, OWNER_EMAIL, DATABASE_PATH,
    WEBHOOK_SECRET, HISTORY;

function init(env) {
  TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  GEMINI_API_KEY = env.GEMINI_API_KEY;
  GROQ_API_KEY = env.GROQ_API_KEY;
  GEMINI_MODEL = env.GEMINI_MODEL;
  ADMIN_USER_ID = env.ADMIN_USER_ID;
  OWNER_NAME = env.OWNER_NAME;
  OWNER_PHONE = env.OWNER_PHONE;
  OWNER_EMAIL = env.OWNER_EMAIL;
  DATABASE_PATH = env.DATABASE_PATH;
  WEBHOOK_SECRET = env.WEBHOOK_SECRET;
  HISTORY = env.HISTORY;
}

const WEBHOOK_PATH = "/telegram";

const SYSTEM = () => [
  `You are Vibes Agent, a sharp, friendly and modern AI assistant on Telegram.`,
  `You were built by ${OWNER_NAME} (${OWNER_EMAIL}) for the Vibes ecosystem.`,
  `Your admin is ${OWNER_NAME} (Telegram ID ${ADMIN_USER_ID}).`,
  `Be concise, accurate and genuinely useful. Format with Telegram-friendly markdown: *bold*, _italic_, \`code\`.`,
  `If the user is casual, match their energy. Reply in the user's language.`
].join("\n");

// ---------- provider calls ----------
async function askGemini(messages) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM() }] }
      })
    }
  );
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("");
  if (!text) throw new Error(d?.error?.message || "gemini: empty reply");
  return { text: text.trim(), engine: "gemini " + GEMINI_MODEL };
}

async function askGroq(messages) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + GROQ_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "system", content: SYSTEM() }, ...messages],
      temperature: 0.7,
      max_tokens: 2048
    })
  });
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content;
  if (!text) throw new Error(d?.error?.message || "groq: empty reply");
  return { text: text.trim(), engine: "groq gpt-oss-120b" };
}

async function askAI(messages) {
  try {
    return await askGemini(messages);
  } catch (e) {
    const fb = await askGroq(messages);
    return { ...fb, note: "gemini down (" + String(e).slice(0, 120) + "), used fallback" };
  }
}

// ---------- telegram helpers ----------
async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return r.json();
}

async function send(chatId, text) {
  // try markdown, fall back to plain on parse errors
  const withMd = await tg("sendMessage", {
    chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true
  });
  if (withMd.ok) return withMd;
  return tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

async function typing(chatId) {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
}

// ---------- memory (KV) ----------
async function getHistory(chatId) {
  const v = await HISTORY.get("tg:" + chatId, "json");
  return Array.isArray(v) ? v : [];
}

async function saveHistory(chatId, history) {
  await HISTORY.put("tg:" + chatId, JSON.stringify(history.slice(-24)), { expirationTtl: 604800 });
}

// ---------- message handling ----------
async function handleMessage(update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const isAdmin = String(msg.from?.id) === String(ADMIN_USER_ID);
  const cmd = (text.match(/^\/(\w+)(@\w+)?/) || [])[1];

  if (cmd === "start") {
    await send(chatId,
      `⚡ *Vibes Agent* is online.\n\nHey${msg.from?.first_name ? " " + msg.from.first_name : ""}! I'm your personal AI — ask me anything: ideas, code, plans, translations, school work, business strategy.\n\n/help — what I can do\n/reset — clear my memory of this chat\n\n_Built by ${OWNER_NAME} · Vibes ecosystem_`);
    return;
  }

  if (cmd === "help") {
    await send(chatId,
      `⚡ *Vibes Agent* — capabilities:\n\n• Answers questions, explains concepts, writes and debugs code\n• Ideas, plans, drafts, translations\n• Remembers up to 24 recent messages per chat (resets after 7 days of silence)\n\nCommands:\n/reset — clear this chat's memory\n/id — your Telegram ID${isAdmin ? "\n/status — engine + diagnostics" : ""}\n\n_I can make mistakes — double-check important info._\n_Built by ${OWNER_NAME} (${OWNER_EMAIL}) · Vibes ecosystem_`);
    return;
  }

  if (cmd === "reset") {
    await HISTORY.delete("tg:" + chatId);
    await send(chatId, "🧠 Memory cleared. Fresh start — what's next?");
    return;
  }

  if (cmd === "id") {
    await send(chatId, `Your Telegram ID: \`${msg.from.id}\`\nChat ID: \`${chatId}\``);
    return;
  }

  if (cmd === "status" && isAdmin) {
    const me = await tg("getMe", {});
    await send(chatId,
      `📊 *Vibes Agent status*\n\nEngine: gemini \`${GEMINI_MODEL}\` (fallback: groq gpt-oss-120b)\nBot: @${me.result?.username || "?"}\nDB: KV \`${DATABASE_PATH}\` (Workers KV)\nAdmin: ${OWNER_NAME} · \`${ADMIN_USER_ID}\``);
    return;
  }

  if (cmd) { // unknown command
    await send(chatId, "Hmm, I don't know that command. Try /help");
    return;
  }

  // regular chat
  await typing(chatId);
  let history = await getHistory(chatId);
  history.push({ role: "user", content: text });

  let out;
  try {
    out = await askAI(history);
  } catch (e) {
    await send(chatId, "⚠️ Both engines hiccuped: " + String(e).slice(0, 160));
    return;
  }

  await send(chatId, out.text);
  history.push({ role: "assistant", content: out.text });
  await saveHistory(chatId, history);
}

// ---------- worker routes ----------
export default {
  async fetch(request, env, ctx) {
    init(env);
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", agent: "Vibes Agent TG", engine: "gemini->groq" }),
        { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/") {
      return new Response("⚡ Vibes Agent Telegram bot is running. Admin: " + OWNER_NAME,
        { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    if (url.pathname === WEBHOOK_PATH && request.method === "POST") {
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      let update;
      try { update = await request.json(); } catch { return new Response("bad", { status: 400 }); }
      // respond instantly, process in background
      ctx.waitUntil(handleMessage(update).catch(e => console.error("handler:", e)));
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  }
};
