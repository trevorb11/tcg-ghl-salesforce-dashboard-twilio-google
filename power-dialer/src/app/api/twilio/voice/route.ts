// POST/GET /api/twilio/voice — TwiML webhook
// Twilio hits this when a call connects. Returns TwiML to join the conference.

import { NextRequest, NextResponse } from "next/server";

function generateTwiML(action: string, conferenceName: string, role: string): string {
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

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference
      startConferenceOnEnter="${isRep}"
      endConferenceOnExit="${isRep}"
      record="record-from-start"
      beep="${isRep ? "false" : "true"}"
      statusCallback="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/twilio/status"
      statusCallbackEvent="start end join leave"
      waitUrl="http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical"
    >${conferenceName}</Conference>
  </Dial>
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

  const twiml = generateTwiML(action, conference, role);

  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}

// Twilio may also hit this as GET
export async function GET(req: NextRequest) {
  return POST(req);
}
