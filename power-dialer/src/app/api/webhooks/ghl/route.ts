// POST /api/webhooks/ghl — Receives GHL webhook events
// Updates dialer_contacts in real-time when contacts change in GHL
//
// GHL sends webhooks for: contact.create, contact.update, contact.delete,
// opportunity.create, opportunity.update, opportunity.stageUpdate
//
// Configure in GHL: Settings → Webhooks → Add webhook:
//   URL: https://power-dialer-ten.vercel.app/api/webhooks/ghl
//   Events: Contact Create, Contact Update, Opportunity Create, Opportunity Stage Update

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const eventType = payload.type || payload.event || "";

    console.log(`[GHL Webhook] Event: ${eventType}`);

    // Contact created or updated
    if (eventType.includes("contact") || payload.contactId || payload.id) {
      const contact = payload.contact || payload;
      const ghlId = contact.id || contact.contactId || payload.contactId;

      if (!ghlId) {
        return NextResponse.json({ ok: true, skipped: "no contact ID" });
      }

      const firstName = contact.firstName || contact.first_name || null;
      const lastName = contact.lastName || contact.last_name || null;
      const phone = contact.phone || null;
      const email = contact.email || null;
      const companyName = contact.companyName || contact.company_name || null;
      const tags = Array.isArray(contact.tags) ? contact.tags.join(", ") : (contact.tags || null);
      const dnd = contact.dnd?.toString() || null;
      const assignedTo = contact.assignedTo || contact.assigned_to || null;

      // Upsert into dialer_contacts
      const result = await query(
        `INSERT INTO dialer_contacts (ghl_contact_id, first_name, last_name, phone, email, business_name, tags, dnd, assigned_to, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (ghl_contact_id) DO UPDATE SET
           first_name = COALESCE(NULLIF($2, ''), dialer_contacts.first_name),
           last_name = COALESCE(NULLIF($3, ''), dialer_contacts.last_name),
           phone = COALESCE(NULLIF($4, ''), dialer_contacts.phone),
           email = COALESCE(NULLIF($5, ''), dialer_contacts.email),
           business_name = COALESCE(NULLIF($6, ''), dialer_contacts.business_name),
           tags = COALESCE(NULLIF($7, ''), dialer_contacts.tags),
           dnd = COALESCE($8, dialer_contacts.dnd),
           assigned_to = COALESCE(NULLIF($9, ''), dialer_contacts.assigned_to),
           updated_at = NOW()`,
        [ghlId, firstName, lastName, phone, email, companyName, tags, dnd, assignedTo]
      );

      console.log(`[GHL Webhook] Contact ${eventType.includes("create") ? "created" : "updated"}: ${ghlId} (${firstName} ${lastName})`);
      return NextResponse.json({ ok: true, action: "contact_upserted", ghlId });
    }

    // Opportunity stage change
    if (eventType.includes("opportunity") || payload.opportunityId) {
      const opp = payload.opportunity || payload;
      const contactId = opp.contactId || opp.contact_id;
      const stageName = opp.pipelineStageName || opp.stageName || opp.stage || null;
      const pipelineName = opp.pipelineName || opp.pipeline || null;
      const monetaryValue = opp.monetaryValue || opp.monetary_value || null;

      if (contactId && stageName) {
        await query(
          `UPDATE dialer_contacts SET
            opp_stage_selection = $1,
            pipeline_selection = COALESCE($2, pipeline_selection),
            updated_at = NOW()
           WHERE ghl_contact_id = $3`,
          [stageName, pipelineName, contactId]
        );

        console.log(`[GHL Webhook] Opp stage updated for contact ${contactId}: ${stageName}`);
        return NextResponse.json({ ok: true, action: "stage_updated", contactId, stage: stageName });
      }
    }

    // Contact deleted
    if (eventType.includes("delete")) {
      const ghlId = payload.contactId || payload.id;
      if (ghlId) {
        // Don't delete from DB — just mark as inactive
        await query(
          `UPDATE dialer_contacts SET dnd = 'deleted', updated_at = NOW() WHERE ghl_contact_id = $1`,
          [ghlId]
        );
        console.log(`[GHL Webhook] Contact marked deleted: ${ghlId}`);
        return NextResponse.json({ ok: true, action: "contact_marked_deleted", ghlId });
      }
    }

    return NextResponse.json({ ok: true, skipped: "unhandled event type" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Webhook error";
    console.error("[GHL Webhook] Error:", message);
    // Always return 200 to prevent GHL from retrying
    return NextResponse.json({ ok: false, error: message });
  }
}

// GHL may also send GET for verification
export async function GET() {
  return NextResponse.json({ status: "GHL webhook endpoint active" });
}
