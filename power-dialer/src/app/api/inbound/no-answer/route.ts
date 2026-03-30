// POST /api/inbound/no-answer — Called when rep doesn't answer inbound call
// Falls back to voicemail recording

import { NextRequest, NextResponse } from "next/server";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  const caller = req.nextUrl.searchParams.get("caller") || "";
  const contact = req.nextUrl.searchParams.get("contact") || "";
  const business = req.nextUrl.searchParams.get("business") || "";

  // Check if the call was answered (DialCallStatus from SignalWire/Twilio)
  const formData = await req.formData();
  const dialStatus = (formData.get("DialCallStatus") as string) || "";

  if (dialStatus === "completed" || dialStatus === "answered") {
    // Call was answered — just hang up cleanly
    return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`, {
      headers: { "Content-Type": "text/xml" },
    });
  }

  // Rep didn't answer — offer voicemail
  console.log(`[INBOUND] Rep didn't answer. Offering voicemail to ${contact} (${caller})`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">
    Sorry, your representative is unavailable right now.
    Please leave a message after the tone and they'll get back to you as soon as possible.
  </Say>
  <Record
    maxLength="120"
    action="${appUrl}/api/inbound/voicemail?caller=${encodeURIComponent(caller)}&contact=${encodeURIComponent(contact)}&business=${encodeURIComponent(business)}"
    transcribe="true"
    playBeep="true"
  />
  <Say voice="Polly.Joanna">Thank you. Goodbye.</Say>
  <Hangup/>
</Response>`;

  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}

export async function GET(req: NextRequest) { return POST(req); }
