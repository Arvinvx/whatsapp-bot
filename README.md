# SparkClean Birmingham — WhatsApp Lead Bot + Landing Page

A WhatsApp AI lead-capture bot for SparkClean Birmingham, powered by Twilio, OpenAI GPT-4o and Supabase. Includes a mobile-first landing page with embedded chat widget and a real-time admin dashboard.

---

## Project Structure

```
caffebot/
├── index.js          # Express server + Twilio webhook + Supabase lead save
├── index.html        # Landing page with embedded AI chat widget
├── dashboard.html    # Admin dashboard — reads leads from Supabase
├── package.json
├── .env              # Environment variables (never commit)
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
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API |

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

---

## Supabase Setup

### Create the `leads` table

Run this SQL in your Supabase project → SQL Editor:

```sql
create table leads (
  id uuid default gen_random_uuid() primary key,
  phone text,
  name text,
  service_type text,
  property_size text,
  location text,
  preferred_date text,
  response_time_seconds integer,
  status text default 'waiting_call',
  created_at timestamp default now()
);
```

### Connect the dashboard

Open `dashboard.html` and fill in the two constants at the top of the `<script>` block:

```js
const SUPABASE_URL      = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key";
```

### Connect the landing page chat widget

Open `index.html` and fill in:

```js
const OPENAI_API_KEY = "sk-...";
```

---

## Notes

- The WhatsApp bot collects: name, service type, property size, location, preferred date, phone — then saves to Supabase and resets the conversation.
- `response_time_seconds` is measured from the customer's first WhatsApp message to booking completion.
- Conversation history is stored in memory per phone number. Restarting the server clears all history (fine for a demo).
- For production, replace the in-memory store with Redis or a database.
