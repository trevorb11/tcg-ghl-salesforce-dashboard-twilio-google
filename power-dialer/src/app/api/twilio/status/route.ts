// POST /api/twilio/status — Twilio/SignalWire status callback
// Updates call status in the session when the carrier reports changes.
//
// Multi-line mode: When multiple leads are ringing simultaneously,
// the first call to hit "in-progress" wins. All other ringing calls
// in the same batch are immediately hung up. This keeps the rep
// connected to exactly one lead at a time.

import { NextRequest, NextResponse } from "next/server";
import { sessions, type CallStatus } from "@/lib/types";
import { hangupCall } from "@/lib/carrier";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const callSid = formData.get("CallSid") as string;
  const callStatus = formData.get("CallStatus") as CallStatus;
  const callDuration = formData.get("CallDuration") as string;
  const answeredBy = formData.get("AnsweredBy") as string; // machine detection

  const leadId = req.nextUrl.searchParams.get("leadId");
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  // If this is a lead call status update, update the session
  if (sessionId && leadId) {
    const session = sessions.get(sessionId);
    if (session) {
      const callRecord = session.callLog.find((c) => c.twilioCallSid === callSid);
      if (callRecord) {
        callRecord.status = callStatus;
        if (callDuration) callRecord.duration = parseInt(callDuration, 10);

        // ── Call ended (any reason) ────────────────────────
        if (callStatus === "completed" || callStatus === "busy" || callStatus === "no-answer" || callStatus === "failed" || callStatus === "canceled") {
          callRecord.endedAt = new Date().toISOString();

          // Auto-disposition for non-answers
          if (!callRecord.disposition) {
            if (callStatus === "no-answer" || callStatus === "busy" || callStatus === "canceled") {
              callRecord.disposition = "no_answer";
            }
            if (answeredBy === "machine_start" || answeredBy === "machine_end_beep" || answeredBy === "machine_end_silence") {
              callRecord.disposition = "voicemail";
            }
          }

          // If we were "on_call" and call completed, move to wrap_up
          if (session.status === "on_call" || session.status === "dialing") {
            // In multi-line mode, only transition to wrap_up if this was
            // the connected call (the winner), not a leftover being hung up
            const batch = session.currentBatch;
            if (batch && batch.connectedSid) {
              if (callSid === batch.connectedSid) {
                session.status = "wrap_up";
                batch.settled = true;
              }
              // If it's not the winner, it's a batch loser completing — ignore for status
            } else {
              // Single-line mode or no batch
              session.status = "wrap_up";
            }
          }

          // Check if all calls in a multi-line batch have ended
          // (e.g., all went to no-answer/VM — nobody picked up)
          if (session.currentBatch && !session.currentBatch.settled) {
            const batch = session.currentBatch;
            const batchCalls = session.callLog.filter(
              (c) => c.twilioCallSid && batch.callSids.includes(c.twilioCallSid)
            );
            const allEnded = batchCalls.every(
              (c) => c.status === "completed" || c.status === "busy" || c.status === "no-answer" || c.status === "failed" || c.status === "canceled"
            );
            if (allEnded && !batch.connectedSid) {
              // Nobody answered in this batch
              session.status = "wrap_up";
              batch.settled = true;
            }
          }
        }

        // ── Call connected (in-progress) ───────────────────
        if (callStatus === "in-progress") {
          // Multi-line mode: first to answer wins
          if (session.currentBatch && !session.currentBatch.settled) {
            const batch = session.currentBatch;

            if (!batch.connectedSid) {
              // This is the WINNER — first call to connect
              batch.connectedSid = callSid;

              // Find which lead this is
              const winnerRecord = session.callLog.find((c) => c.twilioCallSid === callSid);
              if (winnerRecord) {
                const winnerLeadIndex = session.leads.findIndex((l) => l.id === winnerRecord.leadId);
                batch.connectedLeadIndex = winnerLeadIndex;
              }

              session.status = "on_call";
              session.totalConnected++;

              // Hang up all other ringing calls in this batch
              const loserSids = batch.callSids.filter((sid) => sid !== callSid);
              for (const loserSid of loserSids) {
                const loserRecord = session.callLog.find((c) => c.twilioCallSid === loserSid);
                if (loserRecord && (loserRecord.status === "ringing" || loserRecord.status === "queued")) {
                  // Hang up asynchronously — don't block the webhook
                  hangupCall(loserSid).catch((err) =>
                    console.error(`Failed to hang up batch loser ${loserSid}:`, err)
                  );
                  loserRecord.status = "canceled";
                  loserRecord.disposition = "no_answer";
                  loserRecord.endedAt = new Date().toISOString();
                  loserRecord.notes = "Multi-line: another lead answered first";
                }
              }
            } else {
              // A second call connected after the winner was already picked.
              // This is an "abandoned call" — the lead answered but we have
              // to drop them because the rep is already talking to someone.
              session.abandonedCalls++;

              // Hang up immediately
              hangupCall(callSid).catch((err) =>
                console.error(`Failed to hang up late-answerer ${callSid}:`, err)
              );
              callRecord.status = "canceled";
              callRecord.disposition = "no_answer";
              callRecord.endedAt = new Date().toISOString();
              callRecord.notes = "Multi-line: answered after another lead already connected (abandoned)";
            }
          } else {
            // Single-line mode — straightforward
            session.status = "on_call";
            session.totalConnected = (session.totalConnected || 0) + 1;
          }
        }
      }
    }
  }

  // Twilio/SignalWire expects 200 OK
  return new NextResponse("<Response/>", {
    headers: { "Content-Type": "text/xml" },
  });
}
