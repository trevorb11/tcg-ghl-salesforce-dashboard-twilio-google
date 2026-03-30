// POST /api/inbound/voicemail — Called after a voicemail is recorded
// Logs the voicemail to the database and adds a note to GHL

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { addContactNote } from "@/lib/ghl";

export async function POST(req: NextRequest) {
  const caller = req.nextUrl.searchParams.get("caller") || "";
  const contact = req.nextUrl.searchParams.get("contact") || "Unknown";
  const business = req.nextUrl.searchParams.get("business") || "";

  const formData = await req.formData();
  const recordingUrl = (formData.get("RecordingUrl") as string) || "";
  const recordingSid = (formData.get("RecordingSid") as string) || "";
  const recordingDuration = (formData.get("RecordingDuration") as string) || "0";
  const transcriptionText = (formData.get("TranscriptionText") as string) || "";

  console.log(`[VOICEMAIL] From ${contact} (${caller}): ${recordingDuration}s, URL: ${recordingUrl}`);

  // Look up the contact's GHL ID and assigned rep
  try {
    const digits = caller.replace(/\D/g, "").slice(-10);
    const result = await query(
      `SELECT ghl_contact_id, assigned_to, first_name, last_name, business_name
       FROM dialer_contacts
       WHERE phone LIKE $1 OR phone LIKE $2
       LIMIT 1`,
      [`%${digits}`, `+1${digits}`]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const ghlContactId = row.ghl_contact_id;
      const repName = row.assigned_to || "Unassigned";
      const callerName = [row.first_name, row.last_name].filter(Boolean).join(" ") || contact;

      // Add a note to GHL with the voicemail details
      if (ghlContactId) {
        const noteBody = [
          `📞 INBOUND VOICEMAIL from ${callerName}`,
          business ? `Business: ${business}` : null,
          `Duration: ${recordingDuration}s`,
          recordingUrl ? `Recording: ${recordingUrl}.mp3` : null,
          transcriptionText ? `Transcription: ${transcriptionText}` : null,
          `Assigned to: ${repName}`,
        ].filter(Boolean).join("\n");

        await addContactNote(ghlContactId, noteBody).catch(err =>
          console.error("[VOICEMAIL] GHL note failed:", err)
        );
        console.log(`[VOICEMAIL] Note added to GHL contact ${ghlContactId}`);
      }

      // Update the contact's last_contacted and call_disposition in the DB
      await query(
        `UPDATE dialer_contacts
         SET call_disposition = 'Inbound Voicemail',
             last_contacted = $1,
             last_note = $2,
             updated_at = NOW()
         WHERE ghl_contact_id = $3`,
        [
          new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
          `Inbound voicemail (${recordingDuration}s)${transcriptionText ? `: ${transcriptionText.substring(0, 200)}` : ""}`,
          ghlContactId,
        ]
      ).catch(err => console.error("[VOICEMAIL] DB update failed:", err));
    }
  } catch (err) {
    console.error("[VOICEMAIL] Processing error:", err);
  }

  // Acknowledge the recording
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thank you for your message. Goodbye.</Say>
  <Hangup/>
</Response>`;

  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}

export async function GET(req: NextRequest) { return POST(req); }
