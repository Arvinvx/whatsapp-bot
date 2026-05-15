require("dotenv").config();
const express = require("express");
const twilio  = require("twilio");
const OpenAI  = require("openai");
const MessagingResponse = twilio.twiml.MessagingResponse;

const app    = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin",  "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── TWILIO CLIENT ─────────────────────────────────────────────────────────────
let twilioClient = null;
try {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
} catch (e) { console.warn("Twilio init failed:", e.message); }

async function sendWhatsApp(to, message) {
  if (!twilioClient || !process.env.TWILIO_WHATSAPP_FROM) return;
  try {
    await twilioClient.messages.create({
      body: message,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to:   `whatsapp:${to.replace(/^whatsapp:/, "")}`,
    });
  } catch (e) { console.error("WhatsApp send failed:", e.message); }
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let jobIdCounter = 1;

const state = {
  jobs:          [],
  cleaners:      [],
  notifications: [],
};

// ── SSE ───────────────────────────────────────────────────────────────────────
const sseClients = [];

function pushEvent(type, data) {
  const payload = JSON.stringify({ type, data, ts: Date.now() });
  sseClients.forEach(c => { try { c.write(`data: ${payload}\n\n`); } catch (_) {} });
}

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "INIT", data: state, ts: Date.now() })}\n\n`);
  sseClients.push(res);
  req.on("close", () => {
    const i = sseClients.indexOf(res);
    if (i > -1) sseClients.splice(i, 1);
  });
});

setInterval(() => {
  sseClients.forEach(c => { try { c.write(": ping\n\n"); } catch (_) {} });
}, 25000);

// ── HELPERS ───────────────────────────────────────────────────────────────────
const COLORS = ["#7c3aed","#db2777","#ea580c","#0284c7","#0d9488","#65a30d","#9333ea"];

function addNotif(text, icon = "📣") {
  const n = {
    id:   Date.now(),
    text, icon,
    time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
  state.notifications.unshift(n);
  if (state.notifications.length > 60) state.notifications.pop();
  pushEvent("NOTIFICATION", n);
}

function normalizePhone(p = "") {
  return p.replace(/[\s\-\(\)]/g, "").replace("whatsapp:", "");
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.get("/api/state", (_req, res) => res.json(state));

// Jobs
app.post("/api/jobs", (req, res) => {
  const job = { id: jobIdCounter++, source: "dashboard", ...req.body };
  state.jobs.push(job);
  pushEvent("JOB_CREATED", { job });
  addNotif(`New job added — ${job.client}`, "📋");
  res.json({ ok: true, job });
});

app.put("/api/jobs/:id", async (req, res) => {
  const id  = parseInt(req.params.id);
  const job = state.jobs.find(j => j.id === id);
  if (!job) return res.status(404).json({ error: "Not found" });

  const prevCleaner = job.cleaner;
  const prevStatus  = job.status;
  Object.assign(job, req.body);

  if (req.body.cleaner && req.body.cleaner !== prevCleaner) {
    const cleaner = state.cleaners.find(c => c.id === req.body.cleaner);
    if (cleaner?.phone) {
      await sendWhatsApp(cleaner.phone,
        `📋 *New Job — Sparkle Clean*\n\nHi ${cleaner.name.split(" ")[0]}!\n\n👤 *Client:* ${job.client}\n📍 *Address:* ${job.address}\n🧹 *Type:* ${job.type}\n📅 *Date:* ${job.date} at ${job.time}\n\nReply *STARTED* when you arrive, *DONE* when finished. 💪`
      );
    }
    addNotif(`${cleaner?.name ?? "Cleaner"} assigned to ${job.client}'s job`, "👤");
  }

  if (job.status === "done" && prevStatus !== "done") {
    addNotif(`Job complete — ${job.client}`, "✅");
  }

  pushEvent("JOB_UPDATED", { job });
  res.json({ ok: true, job });
});

app.delete("/api/jobs/:id", (req, res) => {
  const id = parseInt(req.params.id);
  state.jobs = state.jobs.filter(j => j.id !== id);
  pushEvent("JOB_DELETED", { id });
  res.json({ ok: true });
});

// Cleaners
app.get("/api/cleaners", (_req, res) => res.json(state.cleaners));

app.post("/api/cleaners", (req, res) => {
  const cleaner = {
    id:        Date.now(),
    color:     COLORS[state.cleaners.length % COLORS.length],
    jobs_done: 0,
    ...req.body,
  };
  state.cleaners.push(cleaner);
  pushEvent("CLEANER_CREATED", { cleaner });
  addNotif(`New cleaner added — ${cleaner.name}`, "👤");
  res.json({ ok: true, cleaner });
});

app.put("/api/cleaners/:id", (req, res) => {
  const id      = parseInt(req.params.id);
  const cleaner = state.cleaners.find(c => c.id === id);
  if (!cleaner) return res.status(404).json({ error: "Not found" });
  Object.assign(cleaner, req.body);
  pushEvent("CLEANER_UPDATED", { cleaner });
  res.json({ ok: true, cleaner });
});

// ── OPENAI CUSTOMER CONVERSATION ──────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a friendly WhatsApp booking assistant for Sparkle Clean, a professional cleaning company in the UK.

Your job is to book customers in for a clean. Collect these details one question at a time — never ask more than one question per message:
1. Customer's full name
2. Type of clean (Standard Clean, Deep Clean, End of Tenancy, or Office Clean)
3. Full address
4. Preferred date
5. Preferred time
6. Best phone number to reach them on

Rules:
- Keep messages short and natural — this is WhatsApp not email
- Use a warm, friendly tone. A couple of emojis is fine
- Never make up prices — say the team will be in touch to confirm
- Once you have ALL 6 details, send a clear confirmation summary to the customer
- After the confirmation message, on a new line by itself, output exactly: BOOKING_COMPLETE:{"name":"...","type":"...","address":"...","date":"...","time":"...","phone":"..."}
- Only output BOOKING_COMPLETE once you have confirmed all 6 details`;

const conversations = {};

function getHistory(phone) {
  if (!conversations[phone]) conversations[phone] = [];
  return conversations[phone];
}

// ── CLEANER COMMANDS ──────────────────────────────────────────────────────────
const DONE_PATTERN    = /\b(done|finished|complete|completed|all done|job done|i.?m done|job finished|all finished)\b/i;
const STARTED_PATTERN = /\b(started|starting|on.?my.?way|arrived|in.?progress|heading there)\b/i;

// ── TWILIO WEBHOOK ────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const twiml = new MessagingResponse();
  try {
    const body    = (req.body.Body || "").trim();
    const fromRaw = (req.body.From || "");
    const from    = normalizePhone(fromRaw);

    if (!body || !from) {
      twiml.message("Hi! How can I help? 😊");
      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    // Check if sender is a registered cleaner
    const cleaner = state.cleaners.find(
      c => c.phone && normalizePhone(c.phone) === from
    );

    let reply;

    if (cleaner) {
      const first = cleaner.name.split(" ")[0];

      if (DONE_PATTERN.test(body)) {
        const activeJob = state.jobs.find(
          j => j.cleaner === cleaner.id && ["in-progress", "assigned"].includes(j.status)
        );
        if (activeJob) {
          activeJob.status = "done";
          pushEvent("JOB_UPDATED", { job: activeJob });
          addNotif(`${cleaner.name} marked job complete — ${activeJob.client}`, "✅");
          reply = `✅ Job complete! Great work ${first}! 💪\n\n*${activeJob.client}* has been marked as Done on the dashboard. Your manager has been notified.`;
        } else {
          reply = `Hey ${first}! No active job found for you right now. Check with your manager 🙂`;
        }

      } else if (STARTED_PATTERN.test(body)) {
        const assignedJob = state.jobs.find(
          j => j.cleaner === cleaner.id && j.status === "assigned"
        );
        if (assignedJob) {
          assignedJob.status = "in-progress";
          pushEvent("JOB_UPDATED", { job: assignedJob });
          addNotif(`${cleaner.name} started job — ${assignedJob.client}`, "🚀");
          reply = `🚀 Got it! *${assignedJob.client}*'s job is now In Progress on the dashboard. Good luck ${first}!`;
        } else {
          reply = `Hey ${first}! No assigned job found. Check with your manager.`;
        }

      } else {
        reply = `Hi ${first}! 👋\n\nYour commands:\n• *STARTED* — mark job as in progress\n• *DONE* — mark job complete\n\nThe dashboard updates automatically. 💪`;
      }

    } else {
      // ── GPT-4o customer conversation ──
      const history = getHistory(from);
      history.push({ role: "user", content: body });

      // Keep last 20 messages to avoid token bloat
      const trimmed = history.slice(-20);

      let rawReply;
      try {
        const completion = await openai.chat.completions.create({
          model:      "gpt-4o",
          messages:   [{ role: "system", content: SYSTEM_PROMPT }, ...trimmed],
          max_tokens: 350,
        });
        rawReply = completion.choices[0].message.content.trim();
      } catch (e) {
        console.error("OpenAI error:", e.message);
        rawReply = "Sorry, I'm having a little trouble right now. Please try again in a moment!";
      }

      // Check for booking completion marker
      const markerMatch = rawReply.match(/BOOKING_COMPLETE:(\{.*\})/);
      if (markerMatch) {
        try {
          const data = JSON.parse(markerMatch[1]);
          const job  = {
            id:      jobIdCounter++,
            client:  data.name  || "Unknown",
            phone:   data.phone || from,
            address: data.address || "",
            type:    data.type  || "Standard Clean",
            date:    data.date  || "",
            time:    data.time  || "",
            cleaner: null,
            status:  "incoming",
            source:  "whatsapp",
            notes:   "Booked via WhatsApp",
          };
          state.jobs.push(job);
          pushEvent("JOB_CREATED", { job });
          addNotif(`New booking via WhatsApp — ${job.client}`, "📱");
          // Reset conversation so they can book again
          conversations[from] = [];
        } catch (e) {
          console.error("Booking parse error:", e.message);
        }
        // Strip the marker line before sending to customer
        reply = rawReply.replace(/\nBOOKING_COMPLETE:\{.*\}/, "").trim();
      } else {
        reply = rawReply;
      }

      history.push({ role: "assistant", content: rawReply });
    }

    twiml.message(reply);
  } catch (err) {
    console.error("Webhook error:", err);
    twiml.message("Sorry, something went wrong. Please try again!");
  }

  res.set("Content-Type", "text/xml");
  res.send(twiml.toString());
});

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) =>
  res.send("✨ Sparkle Clean Bot is running.")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✨ Sparkle Clean Bot  →  http://localhost:${PORT}`);
  console.log(`   API state          →  http://localhost:${PORT}/api/state`);
  console.log(`   SSE stream         →  http://localhost:${PORT}/api/events`);
  console.log(`   Webhook            →  POST http://localhost:${PORT}/webhook\n`);
});
