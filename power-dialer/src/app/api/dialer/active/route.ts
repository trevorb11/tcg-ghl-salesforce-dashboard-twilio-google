// GET /api/dialer/active?repId=xxx — Find the active session for a rep

import { NextRequest, NextResponse } from "next/server";
import { getActiveSessionForRep } from "@/lib/session-store";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const repId = req.nextUrl.searchParams.get("repId");
  if (!repId) {
    return NextResponse.json({ error: "repId required" }, { status: 400 });
  }

  const session = await getActiveSessionForRep(repId);

  if (!session) {
    return NextResponse.json({ active: false });
  }

  return NextResponse.json({
    active: true,
    sessionId: session.id,
    status: session.status,
    dialMode: session.dialMode || "single",
    lines: session.lines || 1,
    totalLeads: session.leads.length,
    currentLeadIndex: session.currentLeadIndex,
    callsCompleted: session.callLog.filter((c) => c.endedAt).length,
    startedAt: session.startedAt,
  });
}
