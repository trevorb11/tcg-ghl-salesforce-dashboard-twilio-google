// ============================================================
// Twilio Dialer Engine — Conference-based power dialing
// ============================================================
//
// How it works:
// 1. Rep starts a session → Twilio calls the REP first and puts them
//    in a named conference room (they hear hold music).
// 2. Rep presses "Dial Next" → Twilio calls the LEAD and bridges
//    them into the same conference.
// 3. If lead answers → rep hears a beep, they're live together.
//    If lead doesn't answer → call ends, rep stays in conference.
// 4. After the call → recording is available, rep sets disposition.
// 5. Repeat until session ends.

import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
const authToken = process.env.TWILIO_AUTH_TOKEN || "";
const twilioPhone = process.env.TWILIO_PHONE_NUMBER || "";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const twilioClient = twilio(accountSid, authToken);

// Step 1: Call the rep and put them in a conference
export async function callRepIntoConference(
  repPhone: string,
  conferenceName: string,
  sessionId?: string
): Promise<string> {
  const sessionParam = sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : "";
  const call = await twilioClient.calls.create({
    to: repPhone,
    from: twilioPhone,
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
  const call = await twilioClient.calls.create({
    to: leadPhone,
    from: twilioPhone,
    url: `${appUrl}/api/twilio/voice?action=join_conference&conference=${encodeURIComponent(conferenceName)}&role=lead&sessionId=${encodeURIComponent(sessionId)}`,
    statusCallback: `${appUrl}/api/twilio/status?leadId=${leadId}&sessionId=${sessionId}`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    timeout: 30, // Ring for 30 seconds before giving up
    machineDetection: "Enable", // Detect voicemail
  });

  return call.sid;
}

// Hang up a specific call (e.g., when skipping a lead)
export async function hangupCall(callSid: string): Promise<void> {
  await twilioClient.calls(callSid).update({ status: "completed" });
}

// End the entire conference (when session ends)
export async function endConference(conferenceName: string): Promise<void> {
  const conferences = await twilioClient.conferences.list({
    friendlyName: conferenceName,
    status: "in-progress",
  });

  for (const conf of conferences) {
    // Remove all participants → conference auto-ends
    const participants = await twilioClient
      .conferences(conf.sid)
      .participants.list();
    for (const p of participants) {
      await twilioClient
        .conferences(conf.sid)
        .participants(p.callSid)
        .remove();
    }
  }
}

// Get recording URL for a conference
export async function getConferenceRecordings(conferenceSid: string) {
  const recordings = await twilioClient
    .conferences(conferenceSid)
    .recordings.list();
  return recordings.map((r) => ({
    sid: r.sid,
    url: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${r.sid}.mp3`,
    duration: r.duration,
  }));
}
