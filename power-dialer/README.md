# TCG Power Dialer

AI-powered conference-based power dialer for Today Capital Group sales reps. Works through the **Claude app** (via MCP tools) and/or a **web dashboard** — hybrid setup.

## Two Ways to Use It

### 1. Through the Claude App (Conversational)
Open Claude and say things like:
- "I want to dial my absent leads"
- "Load the Missing In Action leads and start dialing"
- "Set that as interested, he wants $50K"
- "Give me my daily briefing"

Claude has MCP tools that connect to GHL, Twilio, and the AI analysis — it controls everything.

### 2. Through the Web Dashboard (Visual)
Go to the dashboard URL in a browser for a point-and-click experience:
- Select pipeline stage, see lead list, press buttons to dial/disposition
- Real-time call status, timer, call log
- AI analysis panel with suggested dispositions
- Daily briefing at session end

**Best approach: Use both.** Open the dashboard for the visual dialer controls during calls, and talk to Claude for commands, summaries, and CRM lookups.

## How It Works

1. **Rep identifies themselves** — email + phone number (via Claude or dashboard login)
2. **Selects a lead stage** — e.g., "Missing In Action" for absent leads
3. **Leads are pulled from GHL** for that pipeline stage
4. **Rep starts dialing session** — Twilio calls the rep first and puts them in a conference room
5. **Dials leads** — each lead is called into the same conference (zero delay when they answer)
6. **After each call** — Claude AI analyzes the recording, generates notes, suggests disposition
7. **Notes auto-pushed to GHL** — AI-generated CRM notes with disposition, key points, follow-ups
8. **Daily briefing** — AI recap of the day with hot leads and follow-up plan

## Architecture

```
Claude App (MCP)  ──┐
                    ├──→  MCP Server  ──→  Twilio (Voice/Conference)
Web Dashboard  ────┘     (tools)     ──→  GHL API (Leads + Notes)
                                     ──→  Claude AI (Analysis + Summaries)
```

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
| `ANTHROPIC_API_KEY` | Anthropic API key (for call analysis + summaries) |
| `GHL_API_KEY` | GoHighLevel PIT token |
| `GHL_LOCATION_ID` | GHL location ID (default: TCG's) |
| `MCP_API_KEY` | Optional — secures the MCP SSE endpoint |
| `NEXT_PUBLIC_APP_URL` | Public URL where this app is hosted |

### 2. Install & Run

```bash
cd power-dialer
npm install
npm run dev
```

### 3. Twilio Webhook Access

Twilio needs to reach your `/api/twilio/*` endpoints.

**Local dev:** use ngrok:
```bash
ngrok http 3000
# Set NEXT_PUBLIC_APP_URL to the ngrok URL in .env.local
```

**Production:** Deploy to Vercel/Railway/Fly.io.

## Claude App Setup (MCP)

### Option A: Local Claude Desktop (stdio)

Add to your `claude_desktop_config.json` (usually at `~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tcg-power-dialer": {
      "command": "npx",
      "args": ["tsx", "/path/to/power-dialer/src/mcp/stdio.ts"],
      "env": {
        "TWILIO_ACCOUNT_SID": "your_sid",
        "TWILIO_AUTH_TOKEN": "your_token",
        "TWILIO_PHONE_NUMBER": "+1XXXXXXXXXX",
        "GHL_API_KEY": "your_ghl_key",
        "GHL_LOCATION_ID": "n778xwOps9t8Q34eRPfM",
        "ANTHROPIC_API_KEY": "your_anthropic_key",
        "NEXT_PUBLIC_APP_URL": "https://your-app-url.com"
      }
    }
  }
}
```

Then restart Claude Desktop. You'll see the tools available in Claude.

### Option B: Remote Claude Access (SSE)

If the dashboard is deployed, any Claude instance can connect via SSE:

```
SSE endpoint: https://your-app-url.com/api/mcp/sse
Auth: Bearer token via MCP_API_KEY, or ?key= query param
```

This lets reps on different computers use Claude to control the dialer without needing the project locally.

## MCP Tools Available in Claude

| Tool | What It Does |
|------|-------------|
| `identify_rep` | Authenticate a rep by email + phone |
| `list_stages` | Show all pipeline stages available to dial |
| `load_leads` | Pull leads from GHL for a stage |
| `start_dialer_session` | Call the rep, create conference room |
| `dial_next_lead` | Dial next lead into the conference |
| `set_call_disposition` | Set disposition + push note to GHL |
| `get_session_status` | Get live session status + call log |
| `end_dialer_session` | End session, hang up all calls |
| `analyze_last_call` | Run AI analysis on most recent call |
| `get_daily_briefing` | Generate AI end-of-day summary |
| `search_ghl_contact` | Search GHL CRM by name/email/phone |
| `add_ghl_note` | Manually add a note to a GHL contact |
| `get_dashboard_link` | Get the web dashboard URL |

## Example Claude Conversation

```
Rep: I'm Dillon, my number is 555-123-4567. I want to dial my absent leads.

Claude: [calls identify_rep] Got it, Dillon. Let me pull up your absent leads.
        [calls load_leads with "missing_in_action"]
        Found 23 leads in Missing In Action. Ready to start dialing?

Rep: Yes, let's go.

Claude: [calls start_dialer_session] Calling your phone now. Answer to
        join the dialer.

Rep: I'm in. Start dialing.

Claude: [calls dial_next_lead] Dialing John Smith at ABC Trucking
        (555-987-6543)... 22 leads remaining.

Rep: He picked up, we talked. He's interested in $50K.

Claude: [calls set_call_disposition with "interested"]
        Marked as interested. Note pushed to GHL. Want me to dial the next one?

Rep: Yeah, keep going.

Claude: [calls dial_next_lead] Dialing Sarah Jones at Quick Mart...

... (session continues) ...

Rep: That's enough for today. End it.

Claude: [calls end_dialer_session] Session ended. 15 calls: 3 interested,
        2 callbacks, 8 no answer, 2 not interested.
        [calls get_daily_briefing]

        **Daily Briefing:**
        Good session today. Your hot leads are John Smith (ABC Trucking)
        and Maria Garcia (Downtown Deli) — both expressed strong interest.
        Tomorrow: call John back at 2pm as he requested, and send Maria
        the application link she asked about...
```

## Pipeline Stages Available

| Category | Stages |
|----------|--------|
| Absent/Cold | Missing In Action, No Use At The Moment, Low Revenue |
| App Sent (Warm) | New Opportunity, Waiting for App/Statements, 2nd Attempt |
| Pipeline (Active) | Approved - Moving Forward, Contracts Sent, Renewal |
| Hold | Hold, Follow Up Date Has Hit |

## Deployment (Multi-Rep Access)

Deploy as a standard Next.js app:

- **Vercel** — `vercel deploy` from this directory
- **Railway** — Good for persistent server
- **Fly.io** — Best for low-latency voice

All reps access the same URL. Each gets their own isolated session.

For the Claude app: each rep adds the MCP server config to their Claude Desktop, or connects via the SSE endpoint. The credentials give Claude access to GHL, Twilio, and the AI — reps just talk to Claude.

## Roadmap

- [x] Conference-based power dialer (Twilio)
- [x] GHL integration (lead pulling + CRM notes)
- [x] Claude AI call analysis + auto-disposition
- [x] Daily briefing generation
- [x] MCP tools for Claude app integration
- [ ] Smart lead ordering — AI prioritizes by time zone, answer patterns, lead quality
- [ ] Salesforce integration — dual CRM sync
- [ ] WebSocket-based real-time status (replace polling)
- [ ] Call recording playback in dashboard
