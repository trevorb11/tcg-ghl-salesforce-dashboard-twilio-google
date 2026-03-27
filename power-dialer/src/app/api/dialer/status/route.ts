// GET /api/dialer/status?sessionId=xxx — Poll session status
// The frontend and caller screen poll this to know what's happening.
//
// In multi-line mode, `currentLead` reflects whoever actually
// connected (not just whoever was dialed). The `batch` field
// gives visibility into parallel dialing state.

import { NextRequest, NextResponse } from "next/server";
import { sessions, type Lead } from "@/lib/types";
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

  // Helper to serialize a lead with all CRM context fields
  function serializeLead(lead: Lead) {
    return {
      name: lead.name,
      businessName: lead.businessName,
      phone: lead.phone,
      email: lead.email,
      stageName: lead.stageName,
      tags: lead.tags,
      // Extended CRM fields for LeadContextCard
      _monthlyRevenue: lead._monthlyRevenue,
      _industry: lead._industry,
      _yearsInBusiness: lead._yearsInBusiness,
      _amountRequested: lead._amountRequested,
      _creditScore: lead._creditScore,
      _lastNote: lead._lastNote,
      _lastDisposition: lead._lastDisposition,
      _approvalLetter: lead._approvalLetter,
      _previouslyFunded: lead._previouslyFunded,
      _currentPositions: lead._currentPositions,
      _salesforceId: lead._salesforceId,
      _salesforceType: lead._salesforceType,
    };
  }

  if (session.dialMode === "multi" && session.currentBatch?.connectedLeadIndex != null) {
    const connectedLead = session.leads[session.currentBatch.connectedLeadIndex];
    if (connectedLead) {
      currentLead = serializeLead(connectedLead);
    }
  } else if (session.currentLeadIndex >= 0 && session.currentLeadIndex < session.leads.length) {
    currentLead = serializeLead(session.leads[session.currentLeadIndex]);
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
