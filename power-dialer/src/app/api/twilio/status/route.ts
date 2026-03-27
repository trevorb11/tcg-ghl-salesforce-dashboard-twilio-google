// POST /api/twilio/status — Twilio status callback
// Updates call status in the session when Twilio reports changes

import { NextRequest, NextResponse } from "next/server";
import { sessions, type CallStatus } from "@/lib/types";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const callSid = formData.get("CallSid") as string;
  const callStatus = formData.get("CallStatus") as CallStatus;
  const callDuration = formData.get("CallDuration") as string;
  const answeredBy = formData.get("AnsweredBy") as string; // machine detection

  const leadId = req.nextUrl.searchParams.get("leadId");
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  // If this is a lead call status update, update the session
  if (sessionId && leadId) {
    const session = sessions.get(sessionId);
    if (session) {
      const callRecord = session.callLog.find((c) => c.twilioCallSid === callSid);
      if (callRecord) {
        callRecord.status = callStatus;
        if (callDuration) callRecord.duration = parseInt(callDuration, 10);
        if (callStatus === "completed" || callStatus === "busy" || callStatus === "no-answer" || callStatus === "failed") {
          callRecord.endedAt = new Date().toISOString();
          // Auto-disposition for non-answers
          if (!callRecord.disposition) {
            if (callStatus === "no-answer") callRecord.disposition = "no_answer";
            if (callStatus === "busy") callRecord.disposition = "no_answer";
            if (answeredBy === "machine_start" || answeredBy === "machine_end_beep" || answeredBy === "machine_end_silence") {
              callRecord.disposition = "voicemail";
            }
          }
          // If we were "on_call" and call completed, move to wrap_up
          if (session.status === "on_call" || session.status === "dialing") {
            session.status = "wrap_up";
          }
        }
        if (callStatus === "in-progress") {
          session.status = "on_call";
        }
      }
    }
  }

  // Twilio expects 200 OK
  return new NextResponse("<Response/>", {
    headers: { "Content-Type": "text/xml" },
  });
}
