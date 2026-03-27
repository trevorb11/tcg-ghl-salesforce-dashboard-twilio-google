// POST /api/dialer/next — Dial the next lead(s) in the queue
//
// Single-line mode: dials one lead into the conference.
// Multi-line mode: dials N leads in parallel. The first to answer
// gets bridged to the rep; the rest are hung up automatically by
// the status callback (/api/twilio/status).

import { NextRequest, NextResponse } from "next/server";
import { dialLeadIntoConference, callWebRTCClientIntoConference, getActiveCarrier } from "@/lib/carrier";
import { sessions, type CallRecord } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { sessionId } = await req.json();

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status === "ended") {
    return NextResponse.json({ error: "Session has ended" }, { status: 400 });
  }

  // WebRTC mode: ensure the browser client is in the conference before dialing leads
  if (session.connectionMode === "webrtc" && !session.conferenceCallSid && session.webrtcResource) {
    try {
      const repCallSid = await callWebRTCClientIntoConference(
        session.webrtcResource,
        session.conferenceName,
        session.id
      );
      session.conferenceCallSid = repCallSid;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to connect browser to conference";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // ── Single-line mode ──────────────────────────────────────
  if (session.dialMode === "single" || !session.dialMode) {
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

      const record: CallRecord = {
        id: `call-${Date.now()}`,
        leadId: lead.id,
        leadName: lead.name,
        leadBusinessName: lead.businessName,
        leadPhone: lead.phone,
        repId: session.repId,
        status: "ringing",
        twilioCallSid: callSid,
        carrier: getActiveCarrier(),
        startedAt: new Date().toISOString(),
      };

      session.callLog.push(record);

      return NextResponse.json({
        dialing: true,
        dialMode: "single",
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

  // ── Multi-line mode ───────────────────────────────────────
  const linesToDial = session.lines || 3;

  // Gather the next N leads
  const batchLeads: { lead: typeof session.leads[0]; index: number }[] = [];
  for (let i = 0; i < linesToDial; i++) {
    const nextIndex = session.currentLeadIndex + 1 + i;
    if (nextIndex >= session.leads.length) break;
    batchLeads.push({ lead: session.leads[nextIndex], index: nextIndex });
  }

  if (batchLeads.length === 0) {
    session.status = "ended";
    session.endedAt = new Date().toISOString();
    return NextResponse.json({
      done: true,
      message: "All leads have been dialed.",
      callLog: session.callLog,
    });
  }

  // Advance the index past all leads in this batch
  session.currentLeadIndex += batchLeads.length;
  session.status = "dialing";

  // Fire all calls in parallel
  const dialResults = await Promise.allSettled(
    batchLeads.map(async ({ lead, index }) => {
      const callSid = await dialLeadIntoConference(
        lead.phone,
        session.conferenceName,
        lead.id,
        session.id
      );

      const record: CallRecord = {
        id: `call-${Date.now()}-${index}`,
        leadId: lead.id,
        leadName: lead.name,
        leadBusinessName: lead.businessName,
        leadPhone: lead.phone,
        repId: session.repId,
        status: "ringing",
        twilioCallSid: callSid,
        carrier: getActiveCarrier(),
        startedAt: new Date().toISOString(),
      };

      session.callLog.push(record);

      return { callSid, lead, index };
    })
  );

  // Collect successful dials
  const dialed = dialResults
    .filter((r): r is PromiseFulfilledResult<{ callSid: string; lead: typeof session.leads[0]; index: number }> => r.status === "fulfilled")
    .map((r) => r.value);

  const failed = dialResults.filter((r) => r.status === "rejected").length;

  // Create the batch tracker — the status callback uses this to
  // detect the first answer and hang up the rest
  session.currentBatch = {
    callSids: dialed.map((d) => d.callSid),
    leadIndices: dialed.map((d) => d.index),
    settled: false,
  };

  return NextResponse.json({
    dialing: true,
    dialMode: "multi",
    lines: dialed.length,
    leads: dialed.map((d) => ({
      name: d.lead.name,
      businessName: d.lead.businessName,
      phone: d.lead.phone,
      stageName: d.lead.stageName,
      callSid: d.callSid,
    })),
    failed,
    position: session.currentLeadIndex + 1,
    total: session.leads.length,
    remaining: session.leads.length - session.currentLeadIndex,
    message: `Dialing ${dialed.length} leads simultaneously. First to answer connects to you.`,
  });
}
