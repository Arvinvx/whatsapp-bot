# CaffeBot — WhatsApp AI Restaurant Assistant

A WhatsApp chatbot demo for a restaurant, powered by Twilio and OpenAI GPT-4o.

---

## Project Structure

```
caffebot/
├── index.js          # Express server + webhook handler
├── package.json
├── .env.example      # Copy to .env and fill in your keys
└── .gitignore
```

---

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Where to find it |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account Info |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (sandbox default) |
| `OPENAI_API_KEY` | platform.openai.com → API Keys |

### 3. Run locally

```bash
npm run dev
```

---

## Twilio WhatsApp Sandbox Setup

1. Go to **Twilio Console → Messaging → Try it out → Send a WhatsApp message**
2. Follow the instructions to join the sandbox (send a join code from your WhatsApp to the sandbox number)
3. Under **Sandbox Settings**, set the **"When a message comes in"** webhook to your public URL:
   ```
   https://your-railway-app.railway.app/webhook
   ```
   Method: `HTTP POST`
4. Save. Any WhatsApp message sent to the sandbox number will now hit your bot.

> For local testing, use [ngrok](https://ngrok.com/) to expose your local server:
> ```bash
> ngrok http 3000
> ```
> Then set the Twilio webhook to `https://<ngrok-id>.ngrok.io/webhook`.

---

## Deploy on Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "init caffebot"
git remote add origin https://github.com/YOUR_USERNAME/caffebot.git
git push -u origin main
```

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project → Deploy from GitHub repo** → select `caffebot`
3. Railway auto-detects Node.js and runs `npm start`

### 3. Add environment variables

In Railway → your service → **Variables**, add all four keys from your `.env`:

```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_FROM
OPENAI_API_KEY
```

### 4. Get your public URL

Railway assigns a URL like `https://caffebot-production.up.railway.app`.  
Paste `https://caffebot-production.up.railway.app/webhook` into your Twilio sandbox webhook field.

---

## Testing

1. Join the Twilio sandbox from your WhatsApp (if not done already)
2. Send any message — e.g. `"Hi, I want to make a reservation"`
3. The bot replies as the Demo Restaurant assistant

---

## Notes

- Conversation history is stored in memory per phone number. Restarting the server clears all history (fine for a demo).
- To reset a single user's conversation, restart the server or implement a `"reset"` keyword handler.
- For production, replace the in-memory store with Redis or a database.
