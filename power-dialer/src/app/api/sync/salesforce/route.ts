// GET /api/sync/salesforce — Pull recently modified SF records → update dialer_contacts
// Runs as part of the periodic sync or can be triggered manually

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getValidToken, handleTokenExpiry } from "@/lib/sf-auth";

async function sfQuery(soql: string) {
  const token = await getValidToken();
  if (!token) return [];

  async function doQuery(accessToken: string, instanceUrl: string): Promise<Response> {
    return fetch(
      `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
  }

  let res = await doQuery(token.accessToken, token.instanceUrl);

  // Auto-refresh on 401 and retry
  if (res.status === 401) {
    const refreshed = await handleTokenExpiry();
    if (refreshed) {
      res = await doQuery(refreshed.accessToken, refreshed.instanceUrl);
    } else {
      throw new Error("SF token expired and refresh failed");
    }
  }

  if (!res.ok) {
    throw new Error(`SF query failed: ${res.status}`);
  }

  const data = await res.json();
  return data.records || [];
}

export async function GET(req: NextRequest) {
  const authKey = req.headers.get("x-dialer-key") || req.nextUrl.searchParams.get("key");
  const isCron = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron && authKey !== process.env.DIALER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getValidToken();
  if (!token) {
    return NextResponse.json({ error: "Salesforce not configured", skipped: true });
  }

  let contactsUpdated = 0;
  let oppsUpdated = 0;
  let leadsUpdated = 0;
  let errors = 0;

  try {
    // Sync SF Contacts modified in last 24 hours
    const recentContacts = await sfQuery(
      `SELECT Id, Phone, Email, GHL_Id__c, Call_Disposition__c, Last_Contacted__c,
              Follow_up_Date__c, Dial_Attempts__c
       FROM Contact
       WHERE LastModifiedDate >= LAST_N_DAYS:1
       AND (Phone != null OR GHL_Id__c != null)`
    );

    for (const c of recentContacts) {
      if (!c.GHL_Id__c && !c.Phone) continue;

      try {
        const matchField = c.GHL_Id__c ? "ghl_contact_id" : "phone";
        const matchValue = c.GHL_Id__c || c.Phone;

        await query(
          `UPDATE dialer_contacts SET
            sf_contact_id = COALESCE(sf_contact_id, $1),
            sf_follow_up_date = $2,
            sf_synced_at = NOW(),
            updated_at = NOW()
          WHERE ${matchField} = $3`,
          [c.Id, c.Follow_up_Date__c || null, matchValue]
        );
        contactsUpdated++;
      } catch { errors++; }
    }

    // Sync SF Opportunities modified in last 24 hours
    const recentOpps = await sfQuery(
      `SELECT Id, StageName, Amount, ContactId, Follow_Up_Date__c
       FROM Opportunity
       WHERE LastModifiedDate >= LAST_N_DAYS:1`
    );

    for (const o of recentOpps) {
      if (!o.ContactId) continue;

      try {
        await query(
          `UPDATE dialer_contacts SET
            sf_opportunity_id = COALESCE(sf_opportunity_id, $1),
            sf_opp_stage = $2,
            sf_opp_amount = $3,
            sf_follow_up_date = COALESCE($4, sf_follow_up_date),
            sf_synced_at = NOW(),
            updated_at = NOW()
          WHERE sf_contact_id = $5`,
          [o.Id, o.StageName || null, o.Amount || null, o.Follow_Up_Date__c || null, o.ContactId]
        );
        oppsUpdated++;
      } catch { errors++; }
    }

    // Sync SF Leads modified in last 24 hours
    const recentLeads = await sfQuery(
      `SELECT Id, Phone, Status, Last_Contacted__c, Follow_Up_Date__c, Dial_Attempts__c
       FROM Lead
       WHERE LastModifiedDate >= LAST_N_DAYS:1
       AND IsConverted = false
       AND Phone != null`
    );

    for (const l of recentLeads) {
      if (!l.Phone) continue;

      try {
        const digits = l.Phone.replace(/\D/g, "").slice(-10);
        await query(
          `UPDATE dialer_contacts SET
            sf_lead_id = COALESCE(sf_lead_id, $1),
            sf_lead_status = $2,
            sf_follow_up_date = COALESCE($3, sf_follow_up_date),
            sf_synced_at = NOW(),
            updated_at = NOW()
          WHERE phone LIKE $4`,
          [l.Id, l.Status || null, l.Follow_Up_Date__c || null, `%${digits}`]
        );
        leadsUpdated++;
      } catch { errors++; }
    }

    console.log(`[SF Sync] Contacts: ${contactsUpdated}, Opps: ${oppsUpdated}, Leads: ${leadsUpdated}, Errors: ${errors}`);

    return NextResponse.json({
      ok: true,
      contactsUpdated,
      oppsUpdated,
      leadsUpdated,
      errors,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "SF sync failed";
    console.error("[SF Sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
