# Power Dialer Dashboard — API Reference

All endpoints require the `X-Dialer-Key` header (or `?key=` query param).

**Base URL:** Value of `DASHBOARD_URL` from `.env`

## Table of Contents
1. [Authentication](#authentication)
2. [Leads](#leads)
3. [Dialer Session](#dialer-session)
4. [AI Analysis](#ai-analysis)

---

## Authentication

### POST /api/auth
Verify a rep exists and normalize their phone number.

**Request:**
```json
{
  "email": "dillon@todaycapitalgroup.com",
  "phone": "5551234567"
}
```

**Response (200):**
```json
{
  "id": "dillon",
  "name": "Dillon LeBlanc",
  "email": "dillon@todaycapitalgroup.com",
  "phone": "+15551234567"
}
```

---

## Leads

### GET /api/leads?stage={stage_key}
Pull leads from GHL for a specific pipeline stage.

**Valid stage keys:** `missing_in_action`, `no_use_at_moment`, `low_revenue`, `new_opportunity`, `waiting_for_app`, `second_attempt`, `approved_moving`, `contracts_sent`, `renewal`, `hold`, `follow_up`

**Response (200):**
```json
{
  "leads": [
    {
      "id": "ghl_contact_id",
      "name": "John Smith",
      "businessName": "ABC Trucking LLC",
      "phone": "+15559876543",
      "email": "john@abctrucking.com",
      "pipelineId": "...",
      "pipelineStageId": "...",
      "stageName": "Missing In Action",
      "opportunityId": "opp_id"
    }
  ],
  "count": 23,
  "stage": "missing_in_action"
}
```

---

## Dialer Session

### POST /api/dialer/start
Start a new dialing session. Calls the rep's phone and creates a conference room.

**Request:**
```json
{
  "repId": "dillon",
  "repName": "Dillon LeBlanc",
  "repPhone": "+15551234567",
  "leads": [ "...array of lead objects from /api/leads..." ]
}
```

**Response (200):**
```json
{
  "sessionId": "session-dillon-1711500000000",
  "conferenceName": "tcg-dialer-dillon-1711500000000",
  "repCallSid": "CA...",
  "totalLeads": 23,
  "status": "connecting_rep",
  "message": "Calling Dillon LeBlanc at +15551234567. Answer to join the dialer."
}
```

**IMPORTANT:** Save the `sessionId` — every subsequent call needs it.

### POST /api/dialer/next
Dial the next lead into the rep's conference.

**Request:**
```json
{
  "sessionId": "session-dillon-1711500000000"
}
```

**Response (200) — Dialing:**
```json
{
  "dialing": true,
  "lead": {
    "name": "John Smith",
    "businessName": "ABC Trucking LLC",
    "phone": "+15559876543",
    "stageName": "Missing In Action"
  },
  "callSid": "CA...",
  "position": 1,
  "total": 23,
  "remaining": 22
}
```

**Response (200) — All done:**
```json
{
  "done": true,
  "message": "All leads have been dialed.",
  "callLog": ["..."]
}
```

### POST /api/dialer/disposition
Set the disposition for the most recent call. Also pushes a note to GHL.

**Request:**
```json
{
  "sessionId": "session-dillon-1711500000000",
  "disposition": "interested",
  "notes": "Wants $50K MCA, call back Tuesday 2pm"
}
```

**Valid dispositions:** `interested`, `callback`, `not_interested`, `no_answer`, `voicemail`, `wrong_number`, `disconnected`

**Response (200):**
```json
{
  "success": true,
  "callId": "call-...",
  "disposition": "interested",
  "notes": "Wants $50K MCA, call back Tuesday 2pm"
}
```

### GET /api/dialer/status?sessionId={id}
Get current session status, call log, and live info.

**Response (200):**
```json
{
  "sessionId": "session-dillon-...",
  "status": "on_call",
  "currentLead": {
    "name": "John Smith",
    "businessName": "ABC Trucking LLC",
    "phone": "+15559876543",
    "stageName": "Missing In Action"
  },
  "lastCallStatus": "in-progress",
  "lastCallDisposition": null,
  "lastCallId": "call-...",
  "lastCallAnalysis": null,
  "position": 3,
  "total": 23,
  "callsCompleted": 2,
  "callLog": [
    {
      "id": "call-...",
      "leadName": "Jane Doe",
      "leadBusinessName": "Quick Mart",
      "status": "completed",
      "disposition": "no_answer",
      "duration": 15,
      "startedAt": "2026-03-27T14:30:00Z",
      "analysis": null
    }
  ]
}
```

### POST /api/dialer/end
End the session. Hangs up all calls, closes the conference.

**Request:**
```json
{
  "sessionId": "session-dillon-1711500000000"
}
```

**Response (200):**
```json
{
  "sessionId": "...",
  "totalLeadsDialed": 15,
  "totalLeadsInQueue": 23,
  "callLog": ["..."],
  "startedAt": "2026-03-27T14:00:00Z",
  "endedAt": "2026-03-27T16:30:00Z",
  "dispositions": {
    "interested": 3,
    "callback": 2,
    "not_interested": 1,
    "no_answer": 7,
    "voicemail": 2
  }
}
```

---

## AI Analysis

### POST /api/dialer/call-analysis
Run AI analysis on a specific call. Returns summary, suggested disposition, key points, follow-up actions. Also pushes an AI-generated note to GHL.

**Request:**
```json
{
  "sessionId": "session-dillon-...",
  "callId": "call-..."
}
```

**Response (200):**
```json
{
  "analysis": {
    "summary": "John expressed strong interest in MCA funding for fleet expansion...",
    "disposition": "interested",
    "dispositionReason": "Lead asked about terms and funding timeline",
    "keyPoints": [
      "Needs $50K for 3 new trucks",
      "Currently does $80K/month revenue",
      "Has existing MCA with another provider, balance is low"
    ],
    "followUpActions": [
      "Send application link",
      "Call back Tuesday 2pm as requested",
      "Check if existing MCA allows stacking"
    ],
    "leadSentiment": "positive",
    "ghlNote": "Power Dialer Call — 3/27/2026\nDisposition: Interested\n..."
  }
}
```

### GET /api/dialer/call-analysis?sessionId={id}&callId={id}
Check if analysis is ready for a specific call.

**Response (200):**
```json
{
  "hasAnalysis": true,
  "hasTranscription": true,
  "hasRecording": true,
  "analysis": { "..." }
}
```

### POST /api/dialer/summary
Generate an AI daily briefing for the session.

**Request:**
```json
{
  "sessionId": "session-dillon-..."
}
```

**Response (200):**
```json
{
  "recap": "Strong day on the phones. You connected with 5 leads...",
  "hotLeads": ["John Smith (ABC Trucking)", "Maria Garcia (Downtown Deli)"],
  "followUpPlan": [
    "Call John Smith back Tuesday 2pm — he wants to discuss $50K MCA terms",
    "Send Maria Garcia the application link — she's ready to apply"
  ],
  "stats": "15 calls, 3 interested, 2 callbacks, 8 no-answer, 2 voicemail",
  "sessionStats": {
    "totalCalls": 15,
    "totalLeads": 23,
    "connected": 5,
    "interested": 3,
    "callbacks": 2,
    "notInterested": 1,
    "noAnswer": 9,
    "totalTalkTime": 1847
  }
}
```
