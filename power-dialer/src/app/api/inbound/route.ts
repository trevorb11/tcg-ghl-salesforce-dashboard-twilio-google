// POST /api/inbound — Handle inbound calls (lead calling back)
//
// Flow:
// 1. Look up caller's phone in dialer_contacts → find assigned rep
// 2. Check if that rep has an active dialer session
// 3. If yes → bridge caller into the rep's conference (they hear the rep immediately)
// 4. If no → try ringing the rep directly (WebRTC or phone)
// 5. If rep unavailable → professional greeting + voicemail
//
// Point your SignalWire phone number's inbound webhook here:
//   https://power-dialer-ten.vercel.app/api/inbound

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getActiveSessionForRep } from "@/lib/session-store";
import { getCarrierConfig } from "@/lib/carrier";
import { REP_DIRECTORY } from "@/lib/types";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const callerNumber = (formData.get("From") as string) || "";
  const calledNumber = (formData.get("To") as string) || "";
  const callSid = (formData.get("CallSid") as string) || "";

  console.log(`[INBOUND] Call from ${callerNumber} to ${calledNumber} (${callSid})`);

  // Step 1: Look up the caller in dialer_contacts
  let assignedRepName: string | null = null;
  let contactName = "Unknown Caller";
  let businessName = "";

  try {
    const digits = callerNumber.replace(/\D/g, "").slice(-10);
    const result = await query(
      `SELECT first_name, last_name, business_name, assigned_to
       FROM dialer_contacts
       WHERE phone LIKE $1 OR phone LIKE $2
       LIMIT 1`,
      [`%${digits}`, `+1${digits}`]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      contactName = [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown";
      businessName = row.business_name || "";
      assignedRepName = row.assigned_to || null;
      console.log(`[INBOUND] Matched contact: ${contactName} (${businessName}), assigned to: ${assignedRepName}`);
    } else {
      console.log(`[INBOUND] No contact match for ${callerNumber}`);
    }
  } catch (err) {
    console.error("[INBOUND] Contact lookup failed:", err);
  }

  // Step 2: Find the assigned rep in the directory
  let repId: string | null = null;
  if (assignedRepName) {
    const rep = REP_DIRECTORY.find(
      r => r.name.toLowerCase() === assignedRepName!.toLowerCase()
    );
    if (rep) repId = rep.id;
  }

  // Step 3: Check if rep has an active session
  if (repId) {
    try {
      const session = await getActiveSessionForRep(repId);
      if (session && session.conferenceName) {
        // Rep is in an active dialer session — bridge the inbound caller into the conference
        console.log(`[INBOUND] Bridging ${contactName} into ${assignedRepName}'s conference: ${session.conferenceName}`);

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">Connecting you now.</Say>
  <Dial>
    <Conference
      startConferenceOnEnter="true"
      endConferenceOnExit="false"
      beep="true"
    >${session.conferenceName}</Conference>
  </Dial>
</Response>`;

        return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
      }
    } catch (err) {
      console.error("[INBOUND] Session lookup failed:", err);
    }
  }

  // Step 4: Rep has no active session — try to connect them directly
  // Create a temporary conference for this inbound call, then ring the rep
  if (repId) {
    const config = getCarrierConfig();
    const conferenceName = `inbound-${repId}-${Date.now()}`;

    console.log(`[INBOUND] No active session. Creating inbound conference ${conferenceName} and ringing ${assignedRepName}`);

    // Put the inbound caller in a conference with hold music, then use the status callback
    // to ring the rep. The rep joining the conference connects them.
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">Thank you for calling. We're connecting you to your representative now. Please hold.</Say>
  <Dial timeout="25" action="${appUrl}/api/inbound/no-answer?caller=${encodeURIComponent(callerNumber)}&contact=${encodeURIComponent(contactName)}&business=${encodeURIComponent(businessName)}">
    <Conference
      startConferenceOnEnter="true"
      endConferenceOnExit="false"
      beep="false"
      waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical"
    >${conferenceName}</Conference>
  </Dial>
</Response>`;

    // Fire off a call to the rep in the background
    // We use the carrier client to ring them into the same conference
    try {
      const client = (await import("@/lib/carrier")).getClient();
      const rep = REP_DIRECTORY.find(r => r.id === repId);

      // Try WebRTC resource if rep has one, otherwise phone
      // For now, create a call to the rep's phone if they have one
      if (rep?.phone) {
        client.calls.create({
          to: rep.phone,
          from: config.phoneNumber,
          url: `${appUrl}/api/twilio/voice?action=join_conference&conference=${encodeURIComponent(conferenceName)}&role=rep`,
          statusCallback: `${appUrl}/api/twilio/status`,
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          timeout: 25,
        }).catch((err: Error) => console.error("[INBOUND] Failed to ring rep:", err.message));
      }
    } catch (err) {
      console.error("[INBOUND] Failed to initiate rep call:", err);
    }

    return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
  }

  // Step 5: No matched rep — professional greeting + voicemail
  console.log(`[INBOUND] No rep match. Playing voicemail greeting.`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">
    Thank you for calling. We're sorry we missed your call.
    Please leave a message after the tone and a representative will get back to you shortly.
  </Say>
  <Record
    maxLength="120"
    action="${appUrl}/api/inbound/voicemail?caller=${encodeURIComponent(callerNumber)}&contact=${encodeURIComponent(contactName)}&business=${encodeURIComponent(businessName)}"
    transcribe="true"
    playBeep="true"
  />
  <Say voice="Polly.Joanna">Thank you. Goodbye.</Say>
  <Hangup/>
</Response>`;

  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}

// SignalWire may also hit as GET
export async function GET(req: NextRequest) {
  return POST(req);
}
