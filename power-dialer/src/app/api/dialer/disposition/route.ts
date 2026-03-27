// POST /api/dialer/disposition — Set disposition for the current/last call

import { NextRequest, NextResponse } from "next/server";
import { sessions, type Disposition } from "@/lib/types";
import { addContactNote } from "@/lib/ghl";
import { requireAuth } from "@/lib/auth";

const VALID_DISPOSITIONS: Disposition[] = [
  "interested",
  "callback",
  "not_interested",
  "no_answer",
  "voicemail",
  "wrong_number",
  "disconnected",
];

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { sessionId, disposition, notes } = await req.json() as {
    sessionId: string;
    disposition: Disposition;
    notes?: string;
  };

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!VALID_DISPOSITIONS.includes(disposition)) {
    return NextResponse.json(
      { error: `Invalid disposition. Valid: ${VALID_DISPOSITIONS.join(", ")}` },
      { status: 400 }
    );
  }

  // Find the most recent call
  const lastCall = session.callLog[session.callLog.length - 1];
  if (!lastCall) {
    return NextResponse.json({ error: "No calls in session yet" }, { status: 400 });
  }

  lastCall.disposition = disposition;
  lastCall.notes = notes;
  session.status = "wrap_up";

  // Push note to GHL
  try {
    const noteBody = [
      `📞 Power Dialer Call — ${new Date().toLocaleDateString()}`,
      `Disposition: ${disposition}`,
      notes ? `Notes: ${notes}` : null,
      lastCall.duration ? `Duration: ${lastCall.duration}s` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await addContactNote(lastCall.leadId, noteBody);
  } catch (err) {
    console.error("Failed to push note to GHL:", err);
    // Don't fail the disposition — GHL sync is best-effort in Phase 1
  }

  return NextResponse.json({
    success: true,
    callId: lastCall.id,
    disposition,
    notes,
  });
}
