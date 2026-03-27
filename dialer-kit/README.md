# TCG Power Dialer Kit

This folder is your **Claude Desktop project** for the TCG Power Dialer. Open it in Claude Desktop and start dialing.

## Quick Start

1. Copy `.env.example` to `.env` and fill in the credentials (ask your admin)
2. Open this folder in Claude Desktop
3. Tell Claude: "I'm [your name], my number is [your phone]. I want to dial my absent leads."
4. Answer your phone when it rings — you're in the dialer
5. Tell Claude "dial next" and start selling

## What's in this folder

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Instructions Claude reads automatically — controls everything |
| `.env` | Your credentials (dashboard URL, API keys) |
| `DIALER_API_REFERENCE.md` | Complete API docs for the dialer dashboard |
| `GHL_PIPELINES.md` | All GHL pipelines, stages, and API reference |

## What you can say to Claude

- "I want to dial my absent leads"
- "Load the new opportunities"
- "Dial next"
- "That was interested, he wants $50K"
- "Set as callback, call him back Thursday"
- "Skip this one"
- "Look up John Smith in GHL"
- "What stage is ABC Trucking in?"
- "End the session"
- "Give me my daily briefing"
- "Open the dashboard" (for the visual dialer)

## The Web Dashboard

There's also a visual dashboard at your `DASHBOARD_URL`. Open it in a browser alongside Claude for:
- Point-and-click dialer controls
- Real-time call timer
- Visual call log
- AI analysis cards

Claude and the dashboard are connected to the same backend — use whichever you prefer.
