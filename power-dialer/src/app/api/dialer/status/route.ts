// GET /api/dialer/status?sessionId=xxx — Poll session status
// The frontend polls this to know what's happening

import { NextRequest, NextResponse } from "next/server";
import { sessions } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const currentLead =
    session.currentLeadIndex >= 0 && session.currentLeadIndex < session.leads.length
      ? session.leads[session.currentLeadIndex]
      : null;

  const lastCall = session.callLog[session.callLog.length - 1] || null;

  return NextResponse.json({
    sessionId: session.id,
    status: session.status,
    currentLead: currentLead
      ? {
          name: currentLead.name,
          businessName: currentLead.businessName,
          phone: currentLead.phone,
          stageName: currentLead.stageName,
        }
      : null,
    lastCallStatus: lastCall?.status || null,
    lastCallDisposition: lastCall?.disposition || null,
    lastCallId: lastCall?.id || null,
    lastCallAnalysis: lastCall?.analysis || null,
    lastCallHasRecording: !!lastCall?.recordingSid,
    position: session.currentLeadIndex + 1,
    total: session.leads.length,
    callsCompleted: session.callLog.filter((c) => c.endedAt).length,
    callLog: session.callLog.map((c) => ({
      id: c.id,
      leadName: c.leadName,
      leadBusinessName: c.leadBusinessName,
      status: c.status,
      disposition: c.disposition,
      duration: c.duration,
      startedAt: c.startedAt,
      analysis: c.analysis || null,
    })),
  });
}
