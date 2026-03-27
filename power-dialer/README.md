# TCG Power Dialer

AI-powered conference-based power dialer for Today Capital Group sales reps.

## How It Works

1. **Rep logs in** with their TCG email + personal phone number
2. **Selects a lead stage** (e.g., "Missing In Action" for absent leads)
3. **Leads are pulled from GHL** for that pipeline stage
4. **Rep starts dialing session** — Twilio calls the rep first and puts them in a conference room
5. **Rep presses "Dial Next"** — Twilio calls the next lead into the same conference
6. **When lead answers** — rep is already there, zero delay, seamless connection
7. **After each call** — rep sets a disposition + optional notes (synced to GHL)
8. **Repeat** until all leads are dialed or rep ends the session

## Architecture

```
Browser (Dashboard)  →  Next.js API Routes  →  Twilio (Voice/Conference)
                                            →  GHL API (Leads + Notes)
```

**Key design: Conference-based dialing**
- Rep joins a Twilio conference first (hears hold music)
- Each lead is dialed INTO the rep's conference
- When lead answers, they hear the rep immediately — no bridge delay
- If lead doesn't answer, rep stays in conference, next lead is dialed

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number (must be voice-enabled) |
| `GHL_API_KEY` | GoHighLevel PIT token |
| `GHL_LOCATION_ID` | GHL location ID (default: TCG's) |
| `NEXT_PUBLIC_APP_URL` | Public URL where this app is hosted (Twilio needs to reach it) |

### 2. Install & Run

```bash
cd power-dialer
npm install
npm run dev
```

### 3. Twilio Webhook Access

Twilio needs to reach your `/api/twilio/voice` and `/api/twilio/status` endpoints.

**For local development**, use ngrok:
```bash
ngrok http 3000
```
Then set `NEXT_PUBLIC_APP_URL=https://your-id.ngrok.io` in `.env.local`.

**For production**, deploy to Vercel/Railway/Fly.io and set the public URL.

## Deployment (Multi-Rep Access)

Deploy as a standard Next.js app. Recommended platforms:

- **Vercel** — Easiest. `vercel deploy` from this directory.
- **Railway** — Good for persistent server (if you need WebSockets later).
- **Fly.io** — Best for low-latency voice applications.

All reps access the same URL, log in with their TCG email, and get their own isolated dialing session.

## Pipeline Stages Available

| Category | Stages |
|----------|--------|
| Absent/Cold | Missing In Action, No Use At The Moment, Low Revenue |
| App Sent (Warm) | New Opportunity, Waiting for App/Statements, 2nd Attempt |
| Pipeline (Active) | Approved - Moving Forward, Contracts Sent, Renewal |
| Hold | Hold, Follow Up Date Has Hit |

## Phase 2 Roadmap

- [ ] Claude AI integration — auto-transcribe calls, generate notes, auto-disposition
- [ ] Smart lead ordering — AI prioritizes by time zone, answer patterns, lead quality
- [ ] Daily summary — end-of-day briefing with hot leads and follow-up plan
- [ ] Salesforce integration — dual CRM sync
- [ ] WebSocket-based real-time status (replace polling)
