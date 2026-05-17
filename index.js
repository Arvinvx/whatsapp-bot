require("dotenv").config();
const express = require("express");
const twilio  = require("twilio");
const OpenAI  = require("openai");
const { createClient } = require("@supabase/supabase-js");
const MessagingResponse = twilio.twiml.MessagingResponse;

const app    = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

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
        `📋 *New Job — SparkClean Birmingham*\n\nHi ${cleaner.name.split(" ")[0]}!\n\n👤 *Client:* ${job.client}\n📍 *Address:* ${job.address}\n🧹 *Type:* ${job.type}\n📅 *Date:* ${job.date} at ${job.time}\n\nReply *STARTED* when you arrive, *DONE* when finished. 💪`
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
const SYSTEM_PROMPT = `You are a friendly WhatsApp booking assistant for SparkClean Birmingham, a professional cleaning company.

Your job is to collect a quote request from the customer. Collect these details one question at a time — never ask more than one question per message:
1. Customer's full name
2. Type of cleaning (Domestic Clean, Office Clean, or End of Tenancy)
3. Property size (e.g. 1-bed flat, 3-bed house, office)
4. Location / area in Birmingham
5. Preferred date
6. Best phone number to reach them on

Rules:
- Keep messages short and natural — this is WhatsApp not email
- Use a warm, friendly tone. A couple of emojis is fine
- Never make up prices — say the team will be in touch to confirm
- Once you have ALL 6 details, send a clear confirmation summary to the customer and say the team will call within the hour
- After the confirmation message, on a new line by itself, output exactly: BOOKING_COMPLETE:{"name":"...","service_type":"...","property_size":"...","location":"...","preferred_date":"...","phone":"..."}
- Only output BOOKING_COMPLETE once you have confirmed all 6 details`;

// conversations[phone] = { history: [], startedAt: timestamp }
const conversations = {};

function getConv(phone) {
  if (!conversations[phone]) {
    conversations[phone] = { history: [], startedAt: Date.now() };
  }
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
      const conv = getConv(from);
      conv.history.push({ role: "user", content: body });

      // Keep last 20 messages to avoid token bloat
      const trimmed = conv.history.slice(-20);

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
          const responseTimeSecs = Math.round((Date.now() - conv.startedAt) / 1000);

          // Save lead to Supabase
          if (supabase) {
            const { error } = await supabase.from("leads").insert({
              phone:                 from,
              name:                  data.name           || null,
              service_type:          data.service_type   || null,
              property_size:         data.property_size  || null,
              location:              data.location        || null,
              preferred_date:        data.preferred_date  || null,
              response_time_seconds: responseTimeSecs,
              status:                "waiting_call",
            });
            if (error) console.error("Supabase insert error:", error.message);
            else console.log(`Lead saved — ${data.name} (${from}), response time: ${responseTimeSecs}s`);
          }

          // Also create in-memory job so existing dashboard still works
          const job = {
            id:      jobIdCounter++,
            client:  data.name          || "Unknown",
            phone:   data.phone         || from,
            address: data.location      || "",
            type:    data.service_type  || "Domestic Clean",
            date:    data.preferred_date || "",
            time:    "",
            cleaner: null,
            status:  "incoming",
            source:  "whatsapp",
            notes:   `Property: ${data.property_size || "N/A"} — Booked via WhatsApp`,
          };
          state.jobs.push(job);
          pushEvent("JOB_CREATED", { job });
          addNotif(`New lead via WhatsApp — ${job.client}`, "📱");

          // Reset conversation so customer can start a new quote
          conversations[from] = { history: [], startedAt: Date.now() };
        } catch (e) {
          console.error("Booking parse error:", e.message);
        }
        // Strip the marker line before replying to customer
        reply = rawReply.replace(/\nBOOKING_COMPLETE:\{.*\}/, "").trim();
      } else {
        reply = rawReply;
      }

      conv.history.push({ role: "assistant", content: rawReply });
    }

    twiml.message(reply);
  } catch (err) {
    console.error("Webhook error:", err);
    twiml.message("Sorry, something went wrong. Please try again!");
  }

  res.set("Content-Type", "text/xml");
  res.send(twiml.toString());
});

// ── WEB CHAT ENDPOINT ─────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: "Missing sessionId or message" });

  const phone = "web-" + sessionId;
  const conv  = getConv(phone);
  conv.history.push({ role: "user", content: message });

  const trimmed = conv.history.slice(-20);

  let rawReply;
  try {
    const completion = await openai.chat.completions.create({
      model:      "gpt-4o",
      messages:   [{ role: "system", content: SYSTEM_PROMPT }, ...trimmed],
      max_tokens: 350,
    });
    rawReply = completion.choices[0].message.content.trim();
  } catch (e) {
    console.error("OpenAI /chat error:", e.message);
    return res.json({ reply: "Sorry, something went wrong. Call us on 0121 600 1234!" });
  }

  const markerMatch = rawReply.match(/BOOKING_COMPLETE:(\{.*\})/);
  let reply = rawReply;

  if (markerMatch) {
    try {
      const data = JSON.parse(markerMatch[1]);
      const responseTimeSecs = Math.round((Date.now() - conv.startedAt) / 1000);

      if (supabase) {
        const { error } = await supabase.from("leads").insert({
          phone:                 data.phone          || phone,
          name:                  data.name           || null,
          service_type:          data.service_type   || null,
          property_size:         data.property_size  || null,
          location:              data.location        || null,
          preferred_date:        data.preferred_date  || null,
          response_time_seconds: responseTimeSecs,
          status:                "waiting_call",
        });
        if (error) console.error("Supabase insert error:", error.message);
        else console.log(`Web lead saved — ${data.name}, response time: ${responseTimeSecs}s`);
      }

      const job = {
        id:      jobIdCounter++,
        client:  data.name          || "Unknown",
        phone:   data.phone         || phone,
        address: data.location      || "",
        type:    data.service_type  || "Domestic Clean",
        date:    data.preferred_date || "",
        time:    "",
        cleaner: null,
        status:  "incoming",
        source:  "website",
        notes:   `Property: ${data.property_size || "N/A"} — Booked via Website Chat`,
      };
      state.jobs.push(job);
      pushEvent("JOB_CREATED", { job });
      addNotif(`New lead via Website — ${job.client}`, "🌐");

      conversations[phone] = { history: [], startedAt: Date.now() };
    } catch (e) {
      console.error("Web booking parse error:", e.message);
    }
    reply = rawReply.replace(/\nBOOKING_COMPLETE:\{.*\}/, "").trim();
  }

  conv.history.push({ role: "assistant", content: rawReply });
  res.json({ reply });
});

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) =>
  res.send("✨ SparkClean Birmingham Bot is running.")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✨ SparkClean Birmingham Bot  →  http://localhost:${PORT}`);
  console.log(`   API state              →  http://localhost:${PORT}/api/state`);
  console.log(`   SSE stream             →  http://localhost:${PORT}/api/events`);
  console.log(`   Webhook                →  POST http://localhost:${PORT}/webhook\n`);
});
