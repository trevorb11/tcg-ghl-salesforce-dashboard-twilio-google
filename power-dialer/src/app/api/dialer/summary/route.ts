// POST /api/dialer/summary — Generate AI daily summary for a session
// Called when rep ends their session or requests a summary.

import { NextRequest, NextResponse } from "next/server";
import { sessions } from "@/lib/types";
import { generateDailySummary } from "@/lib/claude";

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json();

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Build the call data for Claude
  const calls = session.callLog
    .filter((c) => c.duration && c.duration > 5) // Only meaningful calls
    .map((c) => ({
      leadName: c.leadName,
      businessName: c.leadBusinessName,
      disposition: c.disposition || "unknown",
      summary: c.analysis?.summary || c.notes || "No summary available",
      keyPoints: c.analysis?.keyPoints || [],
      followUpActions: c.analysis?.followUpActions || [],
      duration: c.duration,
    }));

  // Also include short calls in stats
  const allCalls = session.callLog.map((c) => ({
    leadName: c.leadName,
    businessName: c.leadBusinessName,
    disposition: c.disposition || "no_answer",
    summary: c.analysis?.summary || "No answer / short call",
    keyPoints: [],
    followUpActions: [],
    duration: c.duration,
  }));

  try {
    const summary = await generateDailySummary(allCalls);

    return NextResponse.json({
      ...summary,
      sessionStats: {
        totalCalls: session.callLog.length,
        totalLeads: session.leads.length,
        connected: session.callLog.filter(
          (c) => c.duration && c.duration > 10
        ).length,
        interested: session.callLog.filter(
          (c) => c.disposition === "interested"
        ).length,
        callbacks: session.callLog.filter(
          (c) => c.disposition === "callback"
        ).length,
        notInterested: session.callLog.filter(
          (c) => c.disposition === "not_interested"
        ).length,
        noAnswer: session.callLog.filter(
          (c) =>
            c.disposition === "no_answer" || c.disposition === "voicemail"
        ).length,
        totalTalkTime: session.callLog.reduce(
          (sum, c) => sum + (c.duration || 0),
          0
        ),
        startedAt: session.startedAt,
        endedAt: session.endedAt || new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Summary failed";
    console.error("Daily summary generation failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
