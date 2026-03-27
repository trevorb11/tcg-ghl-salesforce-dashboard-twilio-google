// GET /api/dialer/active?repId=xxx — Find the active session for a rep
//
// When Claude starts a dialing session, the Vercel dashboard needs a way
// to discover it so it can show the live call status, contact card, and
// call log. The dashboard polls this endpoint on load and whenever it
// doesn't have a sessionId yet.

import { NextRequest, NextResponse } from "next/server";
import { sessions } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const repId = req.nextUrl.searchParams.get("repId");
  if (!repId) {
    return NextResponse.json({ error: "repId required" }, { status: 400 });
  }

  // Find the most recent non-ended session for this rep
  let activeSession = null;
  let latestStart = "";

  for (const session of sessions.values()) {
    if (session.repId === repId && session.status !== "ended") {
      if (session.startedAt > latestStart) {
        activeSession = session;
        latestStart = session.startedAt;
      }
    }
  }

  if (!activeSession) {
    return NextResponse.json({ active: false });
  }

  return NextResponse.json({
    active: true,
    sessionId: activeSession.id,
    status: activeSession.status,
    dialMode: activeSession.dialMode || "single",
    lines: activeSession.lines || 1,
    totalLeads: activeSession.leads.length,
    currentLeadIndex: activeSession.currentLeadIndex,
    callsCompleted: activeSession.callLog.filter((c) => c.endedAt).length,
    startedAt: activeSession.startedAt,
  });
}
