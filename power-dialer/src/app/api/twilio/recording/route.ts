// POST /api/twilio/recording — Twilio recording status callback
// Called when a conference recording is ready. Triggers transcription + AI analysis.

import { NextRequest, NextResponse } from "next/server";
import { sessions } from "@/lib/types";
import { getActiveCarrier } from "@/lib/carrier";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const recordingSid = formData.get("RecordingSid") as string;
  const recordingUrl = formData.get("RecordingUrl") as string;
  const recordingStatus = formData.get("RecordingStatus") as string;
  const recordingDuration = formData.get("RecordingDuration") as string;

  const sessionId = req.nextUrl.searchParams.get("sessionId");

  console.log(`Recording ${recordingSid} status: ${recordingStatus}, duration: ${recordingDuration}s`);

  // Only process completed recordings
  if (recordingStatus !== "completed" || !sessionId) {
    return new NextResponse("<Response/>", {
      headers: { "Content-Type": "text/xml" },
    });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`Session ${sessionId} not found for recording ${recordingSid}`);
    return new NextResponse("<Response/>", {
      headers: { "Content-Type": "text/xml" },
    });
  }

  // Find the most recent call that doesn't already have a recording
  const callRecord = [...session.callLog].reverse().find(
    (c) => !c.recordingSid && c.status !== "ringing"
  );

  if (callRecord) {
    callRecord.recordingSid = recordingSid;
    callRecord.recordingUrl = `${recordingUrl}.mp3`;
    if (recordingDuration) {
      callRecord.duration = parseInt(recordingDuration, 10);
    }

    // Store reference and request transcription (don't block the webhook)
    storeRecordingRef(recordingSid, session.id, callRecord.id).catch((err) =>
      console.error("Recording ref error:", err)
    );
  }

  return new NextResponse("<Response/>", {
    headers: { "Content-Type": "text/xml" },
  });
}

// Store recording reference and mark it for transcription.
// Twilio's built-in transcription is requested via the Transcriptions REST API.
// The call-analysis endpoint fetches transcriptions when needed.
async function storeRecordingRef(
  recordingSid: string,
  sessionId: string,
  callId: string
) {
  const session = sessions.get(sessionId);
  if (session) {
    const call = session.callLog.find((c) => c.id === callId);
    if (call) {
      call.recordingSid = recordingSid;
    }
  }

  // Request transcription via REST API (best-effort)
  // SignalWire doesn't support Twilio's transcription API, so we only
  // request transcription when on Twilio or when Twilio creds are available as fallback.
  const carrier = getActiveCarrier();
  const accountSid = carrier === "signalwire"
    ? (process.env.TWILIO_ACCOUNT_SID || "") // Use Twilio creds as fallback
    : (process.env.TWILIO_ACCOUNT_SID || "");
  const authToken = carrier === "signalwire"
    ? (process.env.TWILIO_AUTH_TOKEN || "")
    : (process.env.TWILIO_AUTH_TOKEN || "");

  // Only attempt Twilio transcription if we have Twilio credentials
  if (accountSid && authToken && carrier === "twilio") {
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}/Transcriptions.json`,
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      if (res.ok) {
        console.log(`Transcription requested for recording ${recordingSid}`);
      } else {
        console.log(`Transcription request returned ${res.status} — will rely on call-analysis endpoint`);
      }
    } catch (err) {
      console.error("Failed to request Twilio transcription:", err);
    }
  } else if (carrier === "signalwire") {
    console.log(`Recording ${recordingSid} on SignalWire — transcription will be handled by call-analysis endpoint`);
  }
}
