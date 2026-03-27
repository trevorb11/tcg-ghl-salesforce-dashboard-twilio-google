// POST /api/dialer/next — Dial the next lead in the queue
// The rep is already in the conference. This dials the next lead into it.

import { NextRequest, NextResponse } from "next/server";
import { dialLeadIntoConference } from "@/lib/twilio";
import { sessions, type CallRecord } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json();

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status === "ended") {
    return NextResponse.json({ error: "Session has ended" }, { status: 400 });
  }

  // Move to next lead
  session.currentLeadIndex++;

  if (session.currentLeadIndex >= session.leads.length) {
    session.status = "ended";
    session.endedAt = new Date().toISOString();
    return NextResponse.json({
      done: true,
      message: "All leads have been dialed.",
      callLog: session.callLog,
    });
  }

  const lead = session.leads[session.currentLeadIndex];
  session.status = "dialing";

  try {
    const callSid = await dialLeadIntoConference(
      lead.phone,
      session.conferenceName,
      lead.id,
      session.id
    );

    // Create a call record
    const record: CallRecord = {
      id: `call-${Date.now()}`,
      leadId: lead.id,
      leadName: lead.name,
      leadBusinessName: lead.businessName,
      leadPhone: lead.phone,
      repId: session.repId,
      status: "ringing",
      twilioCallSid: callSid,
      startedAt: new Date().toISOString(),
    };

    session.callLog.push(record);

    return NextResponse.json({
      dialing: true,
      lead: {
        name: lead.name,
        businessName: lead.businessName,
        phone: lead.phone,
        stageName: lead.stageName,
      },
      callSid,
      position: session.currentLeadIndex + 1,
      total: session.leads.length,
      remaining: session.leads.length - session.currentLeadIndex - 1,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to dial lead:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
