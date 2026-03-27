// POST /api/dialer/call-analysis — Trigger AI analysis for a call
// Can be called manually after a call, or automatically when transcription is ready.
// Fetches transcript from Twilio, runs Claude analysis, pushes note to GHL.

import { NextRequest, NextResponse } from "next/server";
import { sessions } from "@/lib/types";
import { analyzeCallTranscript } from "@/lib/claude";
import { addContactNote } from "@/lib/ghl";
import { getClient, getTwilioClient, getActiveCarrier } from "@/lib/carrier";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { sessionId, callId } = await req.json();

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const call = session.callLog.find((c) => c.id === callId);
  if (!call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Already analyzed?
  if (call.analysis) {
    return NextResponse.json({ analysis: call.analysis, cached: true });
  }

  // Try to get transcript
  let transcript = call.transcription || "";

  if (!transcript && call.recordingSid) {
    // Try fetching transcription — use the carrier that made the call,
    // falling back to Twilio client for transcription if available
    const carrier = call.carrier || getActiveCarrier();
    const transcriptionClient = carrier === "signalwire"
      ? (getTwilioClient() || getClient()) // Prefer Twilio for transcription, fall back to SW
      : getClient();

    try {
      const transcriptions = await transcriptionClient
        .recordings(call.recordingSid)
        .transcriptions.list({ limit: 1 });

      if (transcriptions.length > 0 && transcriptions[0].transcriptionText) {
        transcript = transcriptions[0].transcriptionText;
        call.transcription = transcript;
      }
    } catch (err) {
      console.error("Failed to fetch transcription:", err);
    }
  }

  // If still no transcript, we can't do much
  if (!transcript) {
    // If the call was very short or no recording, provide a basic analysis
    if (call.duration && call.duration < 10) {
      call.analysis = {
        summary: "Very short call — likely no answer or immediate hangup.",
        disposition: call.disposition || "no_answer",
        dispositionReason: `Call lasted only ${call.duration} seconds`,
        keyPoints: [],
        followUpActions: ["Try calling again at a different time"],
        leadSentiment: "neutral",
        ghlNote: `Power Dialer Call — ${new Date(call.startedAt).toLocaleDateString()}\nVery short call (${call.duration}s). No meaningful conversation.`,
      };
      return NextResponse.json({ analysis: call.analysis, noTranscript: true });
    }

    return NextResponse.json({
      error: "Transcript not yet available. Try again in a moment.",
      recordingSid: call.recordingSid,
      hasRecording: !!call.recordingSid,
    }, { status: 202 });
  }

  // Run Claude analysis
  try {
    const analysis = await analyzeCallTranscript(transcript, {
      leadName: call.leadName,
      businessName: call.leadBusinessName,
      stageName: session.leads[session.currentLeadIndex]?.stageName || "Unknown",
      repName: session.repName,
    });

    call.analysis = analysis;

    // Auto-update disposition if rep hasn't already set one manually
    if (!call.disposition || call.disposition === "no_answer") {
      call.disposition = analysis.disposition;
    }

    // Push the AI-generated note to GHL
    try {
      await addContactNote(call.leadId, analysis.ghlNote);
      console.log(`GHL note pushed for ${call.leadName}`);
    } catch (ghlErr) {
      console.error("Failed to push note to GHL:", ghlErr);
    }

    return NextResponse.json({ analysis });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    console.error("Claude analysis failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — Check if analysis is ready for a call (used by polling)
export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const callId = req.nextUrl.searchParams.get("callId");

  if (!sessionId || !callId) {
    return NextResponse.json({ error: "sessionId and callId required" }, { status: 400 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const call = session.callLog.find((c) => c.id === callId);
  if (!call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  return NextResponse.json({
    hasAnalysis: !!call.analysis,
    hasTranscription: !!call.transcription,
    hasRecording: !!call.recordingSid,
    analysis: call.analysis || null,
  });
}
