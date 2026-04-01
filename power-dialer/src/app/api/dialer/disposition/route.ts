// POST /api/dialer/disposition — Set disposition for the current/last call
// Syncs to: GHL (note), Salesforce (Task + field update), dialer_contacts DB

import { NextRequest, NextResponse } from "next/server";
import { type Disposition, DISPOSITION_LABELS } from "@/lib/types";
import { getSession, saveSession } from "@/lib/session-store";
import { addContactNote } from "@/lib/ghl";
import { syncCallToSalesforce } from "@/lib/salesforce";
import { query } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const VALID_DISPOSITIONS: Disposition[] = [
  "interested", "callback", "not_interested", "no_answer",
  "voicemail", "wrong_number", "disconnected",
];

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { sessionId, disposition, notes, callbackDate } = await req.json() as {
    sessionId: string;
    disposition: Disposition;
    notes?: string;
    callbackDate?: string; // ISO date string (e.g. "2026-04-03") for callback follow-up
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

  // 1b. GHL — update Follow Up Date if callback
  if (disposition === "callback" && callbackDate && lastCall.leadId) {
    syncPromises.push(
      fetch(`https://services.leadconnectorhq.com/contacts/${lastCall.leadId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${process.env.GHL_API_KEY}`,
          "Version": "2021-07-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customFields: [
            { id: "HIUNWd157AipcEJgWPPW", value: callbackDate }, // Follow Up Date
          ],
        }),
      }).then(r => {
        if (r.ok) console.log(`[Disposition] GHL Follow Up Date set to ${callbackDate}`);
        else console.error("[Disposition] GHL Follow Up Date update failed:", r.status);
      }).catch(err => console.error("[Disposition] GHL Follow Up Date error:", err))
    );
  }

  // 2. Salesforce — Task + Contact/Lead field update + Follow Up Date
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
      callbackDate,
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
          follow_up_date = $5,
          sf_follow_up_date = $5,
          updated_at = NOW()
        WHERE ghl_contact_id = $4`,
        [dispLabel, dateStr, notes || `${dispLabel} — ${dateStr}`, lastCall.leadId, callbackDate || null]
      ).catch(err =>
        console.error("[Disposition] DB update failed:", err)
      )
    );
  }

  // Await all syncs — DB update is critical, GHL/SF are fast HTTP calls
  await Promise.allSettled(syncPromises);

  await saveSession(session);
  return NextResponse.json({
    success: true,
    callId: lastCall.id,
    disposition,
    notes,
  });
}
