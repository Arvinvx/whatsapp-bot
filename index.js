require("dotenv").config();

const express = require("express");
const twilio = require("twilio");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MessagingResponse = twilio.twiml.MessagingResponse;

const SYSTEM_PROMPT = `You are a friendly WhatsApp assistant for Demo Restaurant in Istanbul. You help customers with reservations, menu questions, opening hours, and location. When someone wants to make a reservation, collect their name, date, time, and party size one question at a time, then confirm it. Keep responses short and natural — this is WhatsApp, not email. Respond in whatever language the customer writes in (Turkish or English).`;

// In-memory conversation history keyed by phone number
const conversations = {};

function getHistory(phone) {
  if (!conversations[phone]) {
    conversations[phone] = [{ role: "system", content: SYSTEM_PROMPT }];
  }
  return conversations[phone];
}

app.post("/webhook", async (req, res) => {
  const incomingMsg = req.body.Body?.trim();
  const from = req.body.From;

  if (!incomingMsg || !from) {
    return res.sendStatus(400);
  }

  const history = getHistory(from);
  history.push({ role: "user", content: incomingMsg });

  let replyText;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: history,
      max_tokens: 300,
    });
    replyText = completion.choices[0].message.content.trim();
    history.push({ role: "assistant", content: replyText });
  } catch (err) {
    console.error("OpenAI error:", err.message);
    replyText = "Sorry, I'm having trouble right now. Please try again in a moment.";
  }

  const twiml = new MessagingResponse();
  twiml.message(replyText);
  res.set("Content-Type", "text/xml");
  res.send(twiml.toString());
});

app.get("/", (req, res) => res.send("CaffeBot is running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CaffeBot listening on port ${PORT}`));
