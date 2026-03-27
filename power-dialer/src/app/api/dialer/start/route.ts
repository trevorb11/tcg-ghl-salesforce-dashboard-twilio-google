// POST /api/dialer/start — Start a dialing session
// 1. Creates a conference room
// 2. Calls the rep into it
// 3. Stores the session in memory
//
// Supports two dial modes:
//   - "single" (default): one lead at a time
//   - "multi": dials N leads in parallel, connects the first to answer

import { NextRequest, NextResponse } from "next/server";
import { callRepIntoConference, getActiveCarrier } from "@/lib/carrier";
import { sessions, type DialerSession, type DialMode, type Lead } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { repId, repName, repPhone, leads, dialMode, lines } = await req.json() as {
    repId: string;
    repName: string;
    repPhone: string;
    leads: Lead[];
    dialMode?: DialMode;
    lines?: number;
  };

  if (!repId || !repPhone || !leads?.length) {
    return NextResponse.json(
      { error: "repId, repPhone, and leads[] are required" },
      { status: 400 }
    );
  }

  // Validate lines (1-5, default 1 for single, 3 for multi)
  const mode: DialMode = dialMode === "multi" ? "multi" : "single";
  const lineCount = mode === "single" ? 1 : Math.min(Math.max(lines || 3, 2), 5);

  // Create unique conference name
  const conferenceName = `tcg-dialer-${repId}-${Date.now()}`;
  const sessionId = `session-${repId}-${Date.now()}`;

  // Create session
  const session: DialerSession = {
    id: sessionId,
    repId,
    repName: repName || repId,
    repPhone,
    conferenceName,
    leads,
    currentLeadIndex: -1, // Not dialing anyone yet
    callLog: [],
    status: "connecting_rep",
    startedAt: new Date().toISOString(),
    dialMode: mode,
    lines: lineCount,
    abandonedCalls: 0,
    totalConnected: 0,
  };

  sessions.set(sessionId, session);

  try {
    // Call the rep first — they join the conference and wait
    const repCallSid = await callRepIntoConference(repPhone, conferenceName, sessionId);
    session.conferenceCallSid = repCallSid;
    session.status = "connecting_rep";

    return NextResponse.json({
      sessionId,
      conferenceName,
      repCallSid,
      totalLeads: leads.length,
      status: "connecting_rep",
      carrier: getActiveCarrier(),
      dialMode: mode,
      lines: lineCount,
      message: `Calling ${repName || repId} at ${repPhone}. Answer to join the dialer. Mode: ${mode === "multi" ? `multi-line (${lineCount} lines)` : "single-line"}.`,
    });
  } catch (err: unknown) {
    sessions.delete(sessionId);
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to start session:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
