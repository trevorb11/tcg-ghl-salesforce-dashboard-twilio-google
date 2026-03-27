# Carrier Migration Guide: Adding SignalWire to the TCG Power Dialer

This guide covers the exact backend changes needed in your Next.js dashboard to support both Twilio and SignalWire, switchable via a single env var.

## Overview

SignalWire's REST API is **Twilio-compatible** — same endpoint patterns, same TwiML, same concepts. The migration is mostly about swapping the base URL and credentials. The carrier abstraction lives in one file that every API route imports.

## Step 1: Add Environment Variables

Already done in `.env`:

```
VOICE_CARRIER=twilio  # or "signalwire"

TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

SIGNALWIRE_SPACE=your-space.signalwire.com
SIGNALWIRE_PROJECT_ID=your_signalwire_project_id
SIGNALWIRE_API_TOKEN=your_signalwire_api_token
SIGNALWIRE_PHONE_NUMBER=+1XXXXXXXXXX
```

Add these to your Vercel project settings (Settings > Environment Variables).

## Step 2: Install the SignalWire SDK

```bash
npm install @signalwire/compatibility-api
```

This package is a **drop-in replacement** for the Twilio SDK. It uses the same method names, same TwiML objects, same everything — just routes through SignalWire's infrastructure.

## Step 3: Create the Carrier Abstraction

Create a new file `lib/carrier.ts` (or `.js`):

```typescript
// lib/carrier.ts
// Unified voice carrier interface — supports Twilio and SignalWire

import twilio from 'twilio';

const CARRIER = process.env.VOICE_CARRIER || 'twilio';

// --- Client Factory ---
function createClient() {
  if (CARRIER === 'signalwire') {
    // SignalWire's compatibility API uses the same interface as Twilio
    const { RestClient } = require('@signalwire/compatibility-api');
    return RestClient(
      process.env.SIGNALWIRE_PROJECT_ID,
      process.env.SIGNALWIRE_API_TOKEN,
      { signalwireSpaceUrl: process.env.SIGNALWIRE_SPACE }
    );
  }

  // Default: Twilio
  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

// --- TwiML Factory ---
// SignalWire uses the same TwiML format, but import from compatibility package
function createVoiceResponse() {
  if (CARRIER === 'signalwire') {
    const { RestClient } = require('@signalwire/compatibility-api');
    // SignalWire compatibility API exposes twiml on the module
    const sw = require('@signalwire/compatibility-api');
    return new sw.LaML.VoiceResponse();
  }
  return new twilio.twiml.VoiceResponse();
}

// --- Carrier Config ---
function getCarrierConfig() {
  if (CARRIER === 'signalwire') {
    return {
      name: 'signalwire',
      phoneNumber: process.env.SIGNALWIRE_PHONE_NUMBER,
      perMinuteRate: 0.008,
      perSecondBilling: true,
      // SignalWire webhook URLs use your space
      statusCallbackBase: `https://${process.env.SIGNALWIRE_SPACE}`,
    };
  }

  return {
    name: 'twilio',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    perMinuteRate: 0.014,
    perSecondBilling: false,  // 1-min minimum
    statusCallbackBase: 'https://api.twilio.com',
  };
}

// --- Outbound Call ---
async function makeCall(to: string, options: {
  url?: string;           // TwiML URL to execute when call connects
  twiml?: string;         // Inline TwiML (alternative to url)
  statusCallback?: string;
  statusCallbackEvent?: string[];
  machineDetection?: 'Enable' | 'DetectMessageEnd';
  asyncAmd?: boolean;
  asyncAmdStatusCallback?: string;
}) {
  const client = createClient();
  const config = getCarrierConfig();

  const callParams: any = {
    to,
    from: config.phoneNumber,
    ...(options.url && { url: options.url }),
    ...(options.twiml && { twiml: options.twiml }),
    ...(options.statusCallback && { statusCallback: options.statusCallback }),
    ...(options.statusCallbackEvent && { statusCallbackEvent: options.statusCallbackEvent }),
  };

  // AMD support (both carriers support this)
  if (options.machineDetection) {
    callParams.machineDetection = options.machineDetection;
    if (options.asyncAmd) {
      callParams.asyncAmd = 'true';
      callParams.asyncAmdStatusCallback = options.asyncAmdStatusCallback;
    }
  }

  return client.calls.create(callParams);
}

// --- Conference ---
// Both carriers use the same Conference TwiML
// No changes needed in how you build conference TwiML

// --- Hang Up ---
async function hangupCall(callSid: string) {
  const client = createClient();
  return client.calls(callSid).update({ status: 'completed' });
}

// --- Get Call Info ---
async function getCall(callSid: string) {
  const client = createClient();
  return client.calls(callSid).fetch();
}

// --- Recordings ---
async function getRecordings(callSid: string) {
  const client = createClient();
  return client.calls(callSid).recordings.list();
}

export {
  createClient,
  createVoiceResponse,
  getCarrierConfig,
  makeCall,
  hangupCall,
  getCall,
  getRecordings,
  CARRIER,
};
```

## Step 4: Update Your API Routes

Replace direct Twilio imports with the carrier abstraction. Here's the pattern:

### Before (Twilio-only):
```typescript
import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Make a call
const call = await client.calls.create({
  to: repPhone,
  from: process.env.TWILIO_PHONE_NUMBER,
  url: `${process.env.DASHBOARD_URL}/api/twiml/conference`,
});

// Generate TwiML
const twiml = new twilio.twiml.VoiceResponse();
twiml.dial().conference('room-name');
```

### After (carrier-agnostic):
```typescript
import { makeCall, createVoiceResponse, getCarrierConfig } from '@/lib/carrier';

// Make a call
const call = await makeCall(repPhone, {
  url: `${process.env.DASHBOARD_URL}/api/twiml/conference`,
});

// Generate TwiML (works identically for both carriers)
const twiml = createVoiceResponse();
twiml.dial().conference('room-name');
```

### Files to Update

Search your codebase for these patterns and replace:

```
grep -r "require('twilio')\|from 'twilio'" app/api/
```

Typical files that need updating:
- `app/api/dialer/start/route.ts` — creates conference, calls rep
- `app/api/dialer/next/route.ts` — dials next lead into conference
- `app/api/dialer/end/route.ts` — hangs up all calls
- `app/api/twiml/*/route.ts` — TwiML webhook handlers
- Any file that imports `twilio` directly

### TwiML Webhooks

Both Twilio and SignalWire send webhooks to the same URLs with the same parameters. Your TwiML webhook handlers (`/api/twiml/*`) should work without changes. The only difference:

- **Twilio** sends webhooks from Twilio IPs
- **SignalWire** sends webhooks from SignalWire IPs

If you're validating webhook signatures, you'll need to conditionally use the right validator:

```typescript
import { CARRIER } from '@/lib/carrier';

function validateWebhook(req) {
  if (CARRIER === 'signalwire') {
    // SignalWire uses the same validation approach but with your SW token
    // The compatibility SDK handles this automatically
    return true; // or use SW validation
  }
  // Twilio validation
  return twilio.validateRequest(/* ... */);
}
```

## Step 5: Update Vercel Environment Variables

In your Vercel dashboard (Settings > Environment Variables), add:

| Variable | Value |
|---|---|
| `VOICE_CARRIER` | `twilio` (start here, switch to `signalwire` when ready) |
| `SIGNALWIRE_SPACE` | `your-space.signalwire.com` |
| `SIGNALWIRE_PROJECT_ID` | Your SignalWire project ID |
| `SIGNALWIRE_API_TOKEN` | Your SignalWire API token |
| `SIGNALWIRE_PHONE_NUMBER` | Your SignalWire phone number |

Then redeploy.

## Step 6: Test the Switch

1. Set `VOICE_CARRIER=signalwire` in Vercel env vars
2. Redeploy
3. Start a dialer session with a small lead list (2-3 leads)
4. Verify: calls connect, conference works, dispositions save
5. If anything breaks, flip back to `VOICE_CARRIER=twilio` and redeploy

## Key Differences to Watch For

| Behavior | Twilio | SignalWire |
|---|---|---|
| Billing granularity | 1-min minimum, then per-second | Per-second from first second |
| Call SID format | `CA` + 32 hex chars | Similar format but different prefix |
| Conference recording | `record="record-from-start"` | Same TwiML attribute |
| AMD | `MachineDetection` param | Same param, same values |
| Webhook format | Standard Twilio params | Identical params |
| SDK package | `twilio` | `@signalwire/compatibility-api` |

## SignalWire Trial Mode Note

Your SignalWire account is currently in **Trial Mode** ($4.50 balance). Before going live:

1. Add a credit card at https://your-space.signalwire.com/payment_methods
2. Top up your balance (recommend $50-100 to start)
3. Trial mode limits: can only call verified numbers

## Future: AMD + Voicemail Drop on SignalWire

SignalWire supports the same AMD parameters as Twilio. When you're ready to add this:

```typescript
const call = await makeCall(leadPhone, {
  url: `${dashboardUrl}/api/twiml/conference-lead`,
  machineDetection: 'DetectMessageEnd',
  asyncAmd: true,
  asyncAmdStatusCallback: `${dashboardUrl}/api/webhooks/amd-result`,
  statusCallback: `${dashboardUrl}/api/webhooks/call-status`,
  statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
});
```

Then create `/api/webhooks/amd-result` to handle the AMD callback:

```typescript
export async function POST(req) {
  const body = await req.formData();
  const answeredBy = body.get('AnsweredBy');
  const callSid = body.get('CallSid');

  if (answeredBy === 'machine_end_beep' ||
      answeredBy === 'machine_end_silence' ||
      answeredBy === 'machine_end_other') {
    // It's a voicemail — play pre-recorded message and hang up
    // Update the call's TwiML to play the VM drop
    const client = createClient();
    await client.calls(callSid).update({
      twiml: '<Response><Play>https://your-bucket.s3.amazonaws.com/vm-drop.mp3</Play></Response>'
    });
    // Auto-disposition as voicemail
    // ... your disposition logic here
  }
  // If human — do nothing, they're already in the conference
}
```
