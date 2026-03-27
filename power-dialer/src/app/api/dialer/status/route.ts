// GET /api/dialer/status?sessionId=xxx — Poll session status
// The frontend and caller screen poll this to know what's happening.
//
// In multi-line mode, `currentLead` reflects whoever actually
// connected (not just whoever was dialed). The `batch` field
// gives visibility into parallel dialing state.

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

  // In multi-line mode, the "current lead" is whoever actually connected
  // (the batch winner), not just the last lead index.
  let currentLead = null;

  if (session.dialMode === "multi" && session.currentBatch?.connectedLeadIndex != null) {
    const connectedLead = session.leads[session.currentBatch.connectedLeadIndex];
    if (connectedLead) {
      currentLead = {
        name: connectedLead.name,
        businessName: connectedLead.businessName,
        phone: connectedLead.phone,
        email: connectedLead.email,
        stageName: connectedLead.stageName,
        tags: connectedLead.tags,
      };
    }
  } else if (session.currentLeadIndex >= 0 && session.currentLeadIndex < session.leads.length) {
    const lead = session.leads[session.currentLeadIndex];
    currentLead = {
      name: lead.name,
      businessName: lead.businessName,
      phone: lead.phone,
      email: lead.email,
      stageName: lead.stageName,
      tags: lead.tags,
    };
  }

  const lastCall = session.callLog[session.callLog.length - 1] || null;

  // In multi-line, find the actual connected call (not just the last one logged)
  const connectedCall = session.currentBatch?.connectedSid
    ? session.callLog.find((c) => c.twilioCallSid === session.currentBatch?.connectedSid)
    : lastCall;

  // Batch info for multi-line visibility
  const batchInfo = session.dialMode === "multi" && session.currentBatch
    ? {
        linesDialed: session.currentBatch.callSids.length,
        connected: !!session.currentBatch.connectedSid,
        settled: session.currentBatch.settled,
      }
    : null;

  return NextResponse.json({
    sessionId: session.id,
    status: session.status,
    dialMode: session.dialMode || "single",
    lines: session.lines || 1,
    currentLead,
    batch: batchInfo,
    lastCallStatus: connectedCall?.status || lastCall?.status || null,
    lastCallDisposition: connectedCall?.disposition || lastCall?.disposition || null,
    lastCallId: connectedCall?.id || lastCall?.id || null,
    lastCallAnalysis: connectedCall?.analysis || lastCall?.analysis || null,
    lastCallHasRecording: !!(connectedCall?.recordingSid || lastCall?.recordingSid),
    position: session.currentLeadIndex + 1,
    total: session.leads.length,
    callsCompleted: session.callLog.filter((c) => c.endedAt).length,
    totalConnected: session.totalConnected || 0,
    abandonedCalls: session.abandonedCalls || 0,
    callLog: session.callLog.map((c) => ({
      id: c.id,
      leadName: c.leadName,
      leadBusinessName: c.leadBusinessName,
      status: c.status,
      disposition: c.disposition,
      duration: c.duration,
      startedAt: c.startedAt,
      notes: c.notes,
      analysis: c.analysis || null,
    })),
  });
}
