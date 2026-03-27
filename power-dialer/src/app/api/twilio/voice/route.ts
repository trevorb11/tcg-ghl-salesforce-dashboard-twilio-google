// POST/GET /api/twilio/voice — TwiML webhook
// Twilio hits this when a call connects. Returns TwiML to join the conference.

import { NextRequest, NextResponse } from "next/server";

function generateTwiML(action: string, conferenceName: string, role: string, sessionId?: string): string {
  if (action === "join_conference") {
    // Rep joins with:
    //   - startConferenceOnEnter=true (conference starts when rep joins)
    //   - endConferenceOnExit=true (conference ends if rep hangs up)
    //   - record=record-from-start (record everything)
    //   - beep=true (beep when lead joins so rep knows they connected)
    //
    // Lead joins with:
    //   - startConferenceOnEnter=false (don't start it — rep already did)
    //   - endConferenceOnExit=false (if lead hangs up, rep stays)
    //   - beep=false (no beep for lead — seamless)

    const isRep = role === "rep";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const recordingCallback = sessionId
      ? `${appUrl}/api/twilio/recording?sessionId=${encodeURIComponent(sessionId)}`
      : `${appUrl}/api/twilio/recording`;

    // Both rep and lead can start the conference (startConferenceOnEnter=true)
    // This prevents the timing issue where a lead answers before the
    // WebRTC browser client has fully joined as moderator.
    // Only the rep's exit ends the conference (endConferenceOnExit).
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference
      startConferenceOnEnter="true"
      endConferenceOnExit="${isRep}"
      record="record-from-start"
      recordingStatusCallback="${recordingCallback}"
      recordingStatusCallbackEvent="completed"
      recordingStatusCallbackMethod="POST"
      beep="${isRep ? "false" : "true"}"
      statusCallback="${appUrl}/api/twilio/status"
      statusCallbackEvent="start end join leave"
      waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical"
    >${conferenceName}</Conference>
  </Dial>
</Response>`;
  }

  // Voicemail drop — plays a pre-recorded message and hangs up
  if (action === "voicemail_drop") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Matthew" language="en-US">
    Hi, this is a quick message from Today Capital Group.
    We help business owners access working capital quickly and easily.
    If you have a moment, we'd love to chat about how we can help your business grow.
    Feel free to give us a call back at your convenience.
    Have a great day!
  </Say>
  <Pause length="1"/>
  <Hangup/>
</Response>`;
  }

  // Fallback — just say something
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred. Please try again.</Say>
  <Hangup/>
</Response>`;
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "join_conference";
  const conference = req.nextUrl.searchParams.get("conference") || "default";
  const role = req.nextUrl.searchParams.get("role") || "lead";
  const sessionId = req.nextUrl.searchParams.get("sessionId") || undefined;

  const twiml = generateTwiML(action, conference, role, sessionId);

  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}

// Twilio may also hit this as GET
export async function GET(req: NextRequest) {
  return POST(req);
}
