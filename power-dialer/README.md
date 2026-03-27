# TCG Power Dialer — Dashboard Server

The backend + web dashboard for the TCG Power Dialer system. This is the deployed server that handles Twilio calls, GHL integration, and AI analysis.

Reps interact with this through **Claude Desktop** (using the `dialer-kit/` project) and/or the **web dashboard** directly.

## Architecture

```
Rep's Claude Desktop          Web Dashboard (browser)
        |                            |
        └──── both call ─────────────┘
                    |
            Dashboard Server (this app)
             /        |          \
         Twilio     GHL CRM    Claude AI
        (voice)    (leads)    (analysis)
```

## Setup & Deployment

### 1. Environment Variables

```bash
cp .env.example .env.local
```

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Voice-enabled Twilio number |
| `ANTHROPIC_API_KEY` | For AI call analysis + summaries |
| `GHL_API_KEY` | GoHighLevel PIT token |
| `GHL_LOCATION_ID` | GHL location (`n778xwOps9t8Q34eRPfM`) |
| `DIALER_API_KEY` | API key that Claude and the dashboard use to auth |
| `NEXT_PUBLIC_APP_URL` | Public URL (Twilio webhooks need to reach this) |

### 2. Install & Run

```bash
npm install
npm run dev
```

### 3. Deploy

```bash
vercel deploy  # or Railway, Fly.io
```

Set `NEXT_PUBLIC_APP_URL` to the deployed URL so Twilio can reach the webhooks.

### 4. Give Reps Access

Once deployed, give each rep the `dialer-kit/` folder with:
- The `DASHBOARD_URL` set to your deployed URL
- The `DIALER_API_KEY` matching what you set on the server
- The `GHL_API_KEY` for direct CRM access

They open it in Claude Desktop and start dialing.

## API Endpoints

All non-Twilio endpoints require `X-Dialer-Key` header.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth` | Verify rep identity |
| GET | `/api/leads?stage=...` | Pull leads from GHL |
| POST | `/api/dialer/start` | Start dialing session |
| POST | `/api/dialer/next` | Dial next lead |
| POST | `/api/dialer/disposition` | Set call disposition |
| GET | `/api/dialer/status?sessionId=...` | Poll session status |
| POST | `/api/dialer/end` | End session |
| POST | `/api/dialer/call-analysis` | AI call analysis |
| POST | `/api/dialer/summary` | AI daily briefing |
| POST/GET | `/api/twilio/voice` | TwiML webhook (Twilio) |
| POST | `/api/twilio/status` | Call status webhook (Twilio) |
| POST | `/api/twilio/recording` | Recording webhook (Twilio) |
