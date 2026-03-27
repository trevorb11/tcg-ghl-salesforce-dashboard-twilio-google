// ============================================================
// Carrier Abstraction Layer — Twilio + SignalWire
// ============================================================
//
// Provides a unified interface for both carriers. The active
// carrier is determined by the VOICE_CARRIER env var.
//
// SignalWire's Compatibility API is a drop-in replacement for
// the Twilio SDK — same method names, same TwiML. This file
// simply routes calls through the right client.
//
// To switch carriers: set VOICE_CARRIER=signalwire in .env
// and redeploy. Everything else stays the same.

import twilio from "twilio";

// ── Carrier detection ──────────────────────────────────────
export type CarrierType = "twilio" | "signalwire";

export function getActiveCarrier(): CarrierType {
  const carrier = (process.env.VOICE_CARRIER || "twilio").toLowerCase();
  if (carrier === "signalwire") return "signalwire";
  return "twilio";
}

// ── Carrier config ─────────────────────────────────────────
interface CarrierConfig {
  carrier: CarrierType;
  phoneNumber: string;
  accountSid: string;   // Twilio Account SID or SignalWire Project ID
  authToken: string;     // Twilio Auth Token or SignalWire API Token
  space?: string;        // SignalWire space (e.g. "today-capital-group")
}

export function getCarrierConfig(): CarrierConfig {
  const carrier = getActiveCarrier();

  if (carrier === "signalwire") {
    return {
      carrier: "signalwire",
      phoneNumber: process.env.SIGNALWIRE_PHONE_NUMBER || "",
      accountSid: process.env.SIGNALWIRE_PROJECT_ID || "",
      authToken: process.env.SIGNALWIRE_API_TOKEN || "",
      space: process.env.SIGNALWIRE_SPACE?.replace(".signalwire.com", "") || "",
    };
  }

  return {
    carrier: "twilio",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
  };
}

// ── Client factory ─────────────────────────────────────────
// Both Twilio and SignalWire Compatibility API expose the same
// interface, so we use the Twilio SDK for both — just with
// different credentials and (for SignalWire) a custom API host.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
let _clientCarrier: CarrierType | null = null;

export function getClient() {
  const config = getCarrierConfig();

  // Return cached client if carrier hasn't changed
  if (_client && _clientCarrier === config.carrier) return _client;

  if (config.carrier === "signalwire") {
    // SignalWire Compatibility API works with the Twilio SDK
    // by pointing it at the SignalWire REST API host
    _client = twilio(config.accountSid, config.authToken, {
      accountSid: config.accountSid,
    });
    // Override the base URL to point at SignalWire
    const swSpace = config.space || process.env.SIGNALWIRE_SPACE?.replace(".signalwire.com", "");
    _client._api = new _client._api.constructor(
      _client,
      `https://${swSpace}.signalwire.com`
    );
  } else {
    _client = twilio(config.accountSid, config.authToken);
  }

  _clientCarrier = config.carrier;
  return _client;
}

// ── Convenience: get the raw Twilio client for Twilio-only features ──
// (e.g., transcription requests that SignalWire doesn't support)
export function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  if (!sid || !token) return null;
  return twilio(sid, token);
}

// ── Call functions ─────────────────────────────────────────
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Step 1: Call the rep and put them in a conference
export async function callRepIntoConference(
  repPhone: string,
  conferenceName: string,
  sessionId?: string
): Promise<string> {
  const config = getCarrierConfig();
  const client = getClient();
  const sessionParam = sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : "";

  const call = await client.calls.create({
    to: repPhone,
    from: config.phoneNumber,
    url: `${appUrl}/api/twilio/voice?action=join_conference&conference=${encodeURIComponent(conferenceName)}&role=rep${sessionParam}`,
    statusCallback: `${appUrl}/api/twilio/status`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  return call.sid;
}

// Step 2: Dial a lead into the same conference
export async function dialLeadIntoConference(
  leadPhone: string,
  conferenceName: string,
  leadId: string,
  sessionId: string
): Promise<string> {
  const config = getCarrierConfig();
  const client = getClient();

  const call = await client.calls.create({
    to: leadPhone,
    from: config.phoneNumber,
    url: `${appUrl}/api/twilio/voice?action=join_conference&conference=${encodeURIComponent(conferenceName)}&role=lead&sessionId=${encodeURIComponent(sessionId)}`,
    statusCallback: `${appUrl}/api/twilio/status?leadId=${leadId}&sessionId=${sessionId}`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    timeout: 30,
    machineDetection: "Enable",
  });

  return call.sid;
}

// Hang up a specific call
export async function hangupCall(callSid: string): Promise<void> {
  const client = getClient();
  await client.calls(callSid).update({ status: "completed" });
}

// End the entire conference
export async function endConference(conferenceName: string): Promise<void> {
  const client = getClient();
  const conferences = await client.conferences.list({
    friendlyName: conferenceName,
    status: "in-progress",
  });

  for (const conf of conferences) {
    const participants = await client.conferences(conf.sid).participants.list();
    for (const p of participants) {
      await client.conferences(conf.sid).participants(p.callSid).remove();
    }
  }
}

// ── WebRTC: Generate JWT for browser calling ─────────────
// The browser connects to SignalWire via WebRTC using this JWT.
// The `resource` param becomes the SIP identity the server can call.
export async function generateWebRTCToken(repId: string): Promise<{
  token: string;
  resource: string;
  project: string;
}> {
  const config = getCarrierConfig();
  const space = process.env.SIGNALWIRE_SPACE || `${config.space}.signalwire.com`;
  const spaceHost = space.includes(".signalwire.com") ? space : `${space}.signalwire.com`;
  const resource = `dialer-${repId}-${Date.now()}`;

  const response = await fetch(`https://${spaceHost}/api/relay/rest/jwt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64"),
    },
    body: JSON.stringify({
      resource,
      expires_in: 7200, // 2 hours
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SignalWire JWT error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return {
    token: data.jwt_token,
    resource,
    project: config.accountSid,
  };
}

// Call the WebRTC browser client into the conference (instead of calling a phone)
export async function callWebRTCClientIntoConference(
  resource: string,
  conferenceName: string,
  sessionId: string
): Promise<string> {
  const config = getCarrierConfig();
  const client = getClient();
  const space = process.env.SIGNALWIRE_SPACE || `${config.space}.signalwire.com`;
  const spaceHost = space.includes(".signalwire.com") ? space : `${space}.signalwire.com`;
  const sessionParam = `&sessionId=${encodeURIComponent(sessionId)}`;

  const call = await client.calls.create({
    to: `sip:${resource}@${spaceHost}`,
    from: config.phoneNumber,
    url: `${appUrl}/api/twilio/voice?action=join_conference&conference=${encodeURIComponent(conferenceName)}&role=rep${sessionParam}`,
    statusCallback: `${appUrl}/api/twilio/status`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  return call.sid;
}

// Get recording URL for a conference
export async function getConferenceRecordings(conferenceSid: string) {
  const config = getCarrierConfig();
  const client = getClient();
  const recordings = await client.conferences(conferenceSid).recordings.list();

  // Recording URL format differs by carrier
  const baseUrl = config.carrier === "signalwire"
    ? `https://${config.space}.signalwire.com/api/laml/2010-04-01/Accounts/${config.accountSid}`
    : `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}`;

  return recordings.map((r: { sid: string; duration: string }) => ({
    sid: r.sid,
    url: `${baseUrl}/Recordings/${r.sid}.mp3`,
    duration: r.duration,
  }));
}
