// POST /api/dialer/disposition — Set disposition for the current/last call
// Syncs to: GHL (note), Salesforce (Task + field update), dialer_contacts DB

import { NextRequest, NextResponse } from "next/server";
import { type Disposition } from "@/lib/types";
import { getSession, saveSession } from "@/lib/session-store";
import { addContactNote } from "@/lib/ghl";
import { syncCallToSalesforce } from "@/lib/salesforce";
import { query } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const VALID_DISPOSITIONS: Disposition[] = [
  "interested", "callback", "not_interested", "no_answer",
  "voicemail", "wrong_number", "disconnected",
];

const DISPOSITION_LABELS: Record<string, string> = {
  interested: "Interested",
  callback: "Callback Requested",
  not_interested: "Not Interested",
  no_answer: "No Answer",
  voicemail: "Left Voicemail",
  wrong_number: "Wrong Number",
  disconnected: "Disconnected",
};

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { sessionId, disposition, notes } = await req.json() as {
    sessionId: string;
    disposition: Disposition;
    notes?: string;
  };

  const session = await getSession(sessionId);
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

  const dispLabel = DISPOSITION_LABELS[disposition] || disposition;
  const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });

  // Build note body (shared by GHL and SF)
  const noteBody = [
    `Power Dialer Call — ${dateStr}`,
    `Disposition: ${dispLabel}`,
    notes ? `Notes: ${notes}` : null,
    lastCall.duration ? `Duration: ${Math.floor(lastCall.duration / 60)}m ${lastCall.duration % 60}s` : null,
    `Rep: ${session.repName}`,
  ].filter(Boolean).join("\n");

  // Get the lead's SF IDs from the leads array
  const lead = session.leads[session.currentLeadIndex];
  const sfContactId = lead?._salesforceType === "Contact" ? lead._salesforceId as string : undefined;
  const sfLeadId = lead?._salesforceType === "Lead" ? lead._salesforceId as string : undefined;
  const sfOppId = lead?._salesforceType === "Opportunity" ? lead._salesforceId as string : undefined;

  // Fire all syncs in parallel (all best-effort — don't block the disposition)
  const syncPromises: Promise<unknown>[] = [];

  // 1. GHL note
  syncPromises.push(
    addContactNote(lastCall.leadId, noteBody).catch(err =>
      console.error("[Disposition] GHL note failed:", err)
    )
  );

  // 2. Salesforce — Task + Contact/Lead field update
  syncPromises.push(
    syncCallToSalesforce({
      sfContactId,
      sfLeadId,
      sfOpportunityId: sfOppId,
      disposition,
      duration: lastCall.duration,
      notes: noteBody,
      repName: session.repName,
      leadName: lastCall.leadName,
      businessName: lastCall.leadBusinessName,
    }).then(result => {
      if (result.taskId) console.log(`[Disposition] SF Task created: ${result.taskId}`);
      if (result.contactUpdated) console.log("[Disposition] SF Contact updated");
      if (result.leadUpdated) console.log("[Disposition] SF Lead updated");
    }).catch(err =>
      console.error("[Disposition] SF sync failed:", err)
    )
  );

  // 3. Update dialer_contacts DB — disposition + last contacted
  if (lastCall.leadId && !lastCall.leadId.startsWith("upload-") && !lastCall.leadId.startsWith("dialpad-")) {
    syncPromises.push(
      query(
        `UPDATE dialer_contacts SET
          call_disposition = $1,
          last_contacted = $2,
          last_note = $3,
          dialer_call_count = COALESCE(dialer_call_count, 0) + 1,
          dialer_last_called_at = NOW(),
          dialer_last_disposition = $1,
          updated_at = NOW()
        WHERE ghl_contact_id = $4`,
        [dispLabel, dateStr, notes || `${dispLabel} — ${dateStr}`, lastCall.leadId]
      ).catch(err =>
        console.error("[Disposition] DB update failed:", err)
      )
    );
  }

  // Don't await — let syncs happen in background
  Promise.allSettled(syncPromises);

  await saveSession(session);
  return NextResponse.json({
    success: true,
    callId: lastCall.id,
    disposition,
    notes,
  });
}
