// POST /api/dialer/end — End the dialing session
// Hangs up all calls, ends the conference, returns summary

import { NextRequest, NextResponse } from "next/server";
import { endConference } from "@/lib/twilio";
import { sessions } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json();

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    await endConference(session.conferenceName);
  } catch (err) {
    console.error("Error ending conference:", err);
  }

  session.status = "ended";
  session.endedAt = new Date().toISOString();

  const summary = {
    sessionId: session.id,
    totalLeadsDialed: session.callLog.length,
    totalLeadsInQueue: session.leads.length,
    callLog: session.callLog,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    dispositions: session.callLog.reduce(
      (acc, c) => {
        const d = c.disposition || "pending";
        acc[d] = (acc[d] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
  };

  return NextResponse.json(summary);
}
