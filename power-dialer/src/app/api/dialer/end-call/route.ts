// POST /api/dialer/end-call — Hang up the current lead's call without setting a disposition
//
// Used by the "End Call" button in the dialer UI. Lets reps cleanly hang up
// the current call (e.g. when they realize it's a wrong number, or to escape
// a long voicemail) without immediately picking a disposition or auto-advancing.
//
// After this returns, the session status is "wrap_up" so the rep can pick a
// disposition next.

import { NextRequest, NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/session-store";
import { getClient } from "@/lib/carrier";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { sessionId } = (await req.json()) as { sessionId: string };

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const lastCall = session.callLog[session.callLog.length - 1];
  if (!lastCall) {
    return NextResponse.json({ error: "No active call to end" }, { status: 400 });
  }

  // Phone/conference mode: hang up the lead's call leg via the carrier API.
  // WebRTC mode: the client already calls webrtc.hangupCall() before hitting this endpoint,
  // so this is a no-op for WebRTC sessions (no twilioCallSid is set).
  if (lastCall.twilioCallSid && session.connectionMode !== "webrtc") {
    try {
      const client = getClient();
      await client.calls(lastCall.twilioCallSid).update({ status: "completed" });
    } catch (err) {
      // Best-effort — call may have already ended
      console.log("[EndCall] Call already ended or hangup failed:", (err as Error).message);
    }
  }

  session.status = "wrap_up";
  await saveSession(session);

  return NextResponse.json({ success: true });
}
