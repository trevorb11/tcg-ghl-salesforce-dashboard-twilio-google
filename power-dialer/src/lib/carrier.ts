// ============================================================
// Carrier Abstraction Layer — Twilio + SignalWire
// ============================================================
//
// Provides a unified interface for both carriers. The active
// carrier is determined by the VOICE_CARRIER env var.
//
// - Twilio: uses the `twilio` SDK directly
// - SignalWire: uses `@signalwire/compatibility-api` which has
//   the same interface as Twilio but talks to SignalWire's API
//
// To switch carriers: set VOICE_CARRIER=signalwire in .env
// and redeploy. Everything else stays the same.

import twilio from "twilio";
import { getLocalPresenceNumber } from "./local-presence";

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
// Twilio uses the `twilio` SDK. SignalWire uses `@signalwire/compatibility-api`
// which exposes the exact same interface (calls.create, conferences.list, etc.)
// but authenticates with SignalWire Project ID + API Token.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
let _clientCarrier: CarrierType | null = null;

export function getClient() {
  const config = getCarrierConfig();

  // Return cached client if carrier hasn't changed
  if (_client && _clientCarrier === config.carrier) return _client;

  if (config.carrier === "signalwire") {
    // Use SignalWire's own Compatibility API client
    // Same interface as Twilio SDK — calls.create(), conferences.list(), etc.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RestClient } = require("@signalwire/compatibility-api");
    const swSpace = config.space || process.env.SIGNALWIRE_SPACE?.replace(".signalwire.com", "");
    _client = RestClient(config.accountSid, config.authToken, {
      signalwireSpaceUrl: `${swSpace}.signalwire.com`,
    });
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
// Uses local presence matching to pick the best caller ID
export async function dialLeadIntoConference(
  leadPhone: string,
  conferenceName: string,
  leadId: string,
  sessionId: string
): Promise<string> {
  const client = getClient();
  const fromNumber = getLocalPresenceNumber(leadPhone);

  const call = await client.calls.create({
    to: leadPhone,
    from: fromNumber,
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
  const resource = `rep-${repId}-${Date.now()}`;

  // Request a JWT from SignalWire's REST API
  const resp = await fetch(`https://${spaceHost}/api/relay/rest/jwt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
    },
    body: JSON.stringify({
      expires_in: 480, // 8 hours in minutes (SignalWire max: 10080 = 7 days)
      resource,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SignalWire JWT request failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return {
    token: data.jwt_token,
    resource,
    project: config.accountSid,
  };
}

// ── WebRTC: Call a browser client into a conference ───────
// After the browser has connected with a JWT, we can call the
// browser's resource into the conference using the REST API.
export async function callWebRTCClientIntoConference(
  resource: string,
  conferenceName: string,
  sessionId: string
): Promise<string> {
  const config = getCarrierConfig();
  const client = getClient();

  // Call the browser's SIP resource into the conference
  const call = await client.calls.create({
    to: `sip:${resource}@${config.space || process.env.SIGNALWIRE_SPACE?.replace(".signalwire.com", "")}.signalwire.com`,
    from: config.phoneNumber,
    url: `${appUrl}/api/twilio/voice?action=join_conference&conference=${encodeURIComponent(conferenceName)}&role=rep&sessionId=${encodeURIComponent(sessionId)}`,
    statusCallback: `${appUrl}/api/twilio/status`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  return call.sid;
}

// ── Conference recordings ────────────────────────────────
export async function getConferenceRecordings(conferenceSid: string) {
  const client = getClient();
  const config = getCarrierConfig();
  const recordings = await client.conferences(conferenceSid).recordings.list();

  const baseUrl = config.carrier === "signalwire"
    ? `https://${config.space || process.env.SIGNALWIRE_SPACE?.replace(".signalwire.com", "")}.signalwire.com/api/laml/2010-04-01/Accounts/${config.accountSid}/Recordings`
    : `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Recordings`;

  return recordings.map((r: { sid: string; duration: string }) => ({
    sid: r.sid,
    url: `${baseUrl}/${r.sid}.mp3`,
    duration: r.duration,
  }));
}
