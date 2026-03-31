// GET /api/dialer/history?repId=dillon — Get recent session logs for a rep
// Shows on the lead loader so reps see what they did last time

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const repId = req.nextUrl.searchParams.get("repId");
  if (!repId) {
    return NextResponse.json({ error: "repId required" }, { status: 400 });
  }

  try {
    const result = await query(
      `SELECT session_id, started_at, ended_at, duration_minutes,
              total_leads, total_calls, connected, interested, callbacks,
              no_answer, voicemail, ai_recap, hot_leads, follow_up_plan,
              lead_source, dial_mode, connection_mode
       FROM dialer_session_logs
       WHERE rep_id = $1
       ORDER BY started_at DESC
       LIMIT 5`,
      [repId]
    );

    return NextResponse.json({
      sessions: result.rows,
      count: result.rowCount,
    });
  } catch (err: unknown) {
    // Table might not exist yet or be empty — return empty
    return NextResponse.json({ sessions: [], count: 0 });
  }
}
