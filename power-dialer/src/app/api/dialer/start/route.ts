// POST /api/dialer/start — Start a dialing session
// 1. Creates a conference room
// 2. Calls the rep into it
// 3. Stores the session in memory

import { NextRequest, NextResponse } from "next/server";
import { callRepIntoConference } from "@/lib/twilio";
import { sessions, type DialerSession, type Lead } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { repId, repName, repPhone, leads } = await req.json() as {
    repId: string;
    repName: string;
    repPhone: string;
    leads: Lead[];
  };

  if (!repId || !repPhone || !leads?.length) {
    return NextResponse.json(
      { error: "repId, repPhone, and leads[] are required" },
      { status: 400 }
    );
  }

  // Create unique conference name
  const conferenceName = `tcg-dialer-${repId}-${Date.now()}`;
  const sessionId = `session-${repId}-${Date.now()}`;

  // Create session
  const session: DialerSession = {
    id: sessionId,
    repId,
    repPhone,
    conferenceName,
    leads,
    currentLeadIndex: -1, // Not dialing anyone yet
    callLog: [],
    status: "connecting_rep",
    startedAt: new Date().toISOString(),
  };

  sessions.set(sessionId, session);

  try {
    // Call the rep first — they join the conference and wait
    const repCallSid = await callRepIntoConference(repPhone, conferenceName);
    session.conferenceCallSid = repCallSid;
    session.status = "connecting_rep";

    return NextResponse.json({
      sessionId,
      conferenceName,
      repCallSid,
      totalLeads: leads.length,
      status: "connecting_rep",
      message: `Calling ${repName || repId} at ${repPhone}. Answer to join the dialer.`,
    });
  } catch (err: unknown) {
    sessions.delete(sessionId);
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to start session:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
