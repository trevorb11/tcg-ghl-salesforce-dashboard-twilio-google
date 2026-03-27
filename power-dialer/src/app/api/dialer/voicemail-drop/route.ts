// POST /api/dialer/voicemail-drop — Drop a pre-recorded voicemail and move on
//
// When a call goes to voicemail, the rep clicks "Drop VM" and:
// 1. The lead's active call is redirected to TwiML that plays a voicemail message
// 2. The call auto-hangs-up after the message
// 3. Disposition is set to "voicemail"
// 4. Session moves to wrap_up so rep can immediately dial next

import { NextRequest, NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/session-store";
import { addContactNote } from "@/lib/ghl";
import { getClient, getCarrierConfig } from "@/lib/carrier";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { sessionId } = (await req.json()) as { sessionId: string };

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Find the current active call (most recent without an end time)
  const lastCall = session.callLog[session.callLog.length - 1];
  if (!lastCall || lastCall.endedAt) {
    return NextResponse.json(
      { error: "No active call to drop voicemail on" },
      { status: 400 }
    );
  }

  const callSid = lastCall.twilioCallSid;
  if (!callSid) {
    return NextResponse.json(
      { error: "No call SID found — cannot redirect call" },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    // Redirect the lead's call to the voicemail drop TwiML
    const client = getClient();
    await client.calls(callSid).update({
      url: `${appUrl}/api/twilio/voice?action=voicemail_drop&sessionId=${encodeURIComponent(session.id)}`,
      method: "POST",
    });

    // Set disposition to voicemail
    lastCall.disposition = "voicemail";
    lastCall.notes = (lastCall.notes ? lastCall.notes + " | " : "") + "VM dropped";
    session.status = "wrap_up";

    await saveSession(session);

    // Push note to GHL (non-blocking)
    addContactNote(
      lastCall.leadId,
      `📞 Power Dialer — ${new Date().toLocaleDateString()}\nDisposition: voicemail\nNotes: Pre-recorded voicemail dropped`
    ).catch((err) => console.error("GHL note failed:", err));

    return NextResponse.json({
      success: true,
      message: "Voicemail dropped — lead will hear your message",
      disposition: "voicemail",
    });
  } catch (err) {
    console.error("Voicemail drop failed:", err);
    return NextResponse.json(
      { error: "Failed to drop voicemail. The call may have already ended." },
      { status: 500 }
    );
  }
}
