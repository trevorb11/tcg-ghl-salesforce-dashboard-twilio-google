// GET /api/sync — Periodic sync: pulls recently modified contacts from GHL → updates DB
// Designed to run via Vercel Cron every 4-6 hours as a safety net
// behind the real-time GHL webhooks.
//
// Add to vercel.json:
// { "crons": [{ "path": "/api/sync", "schedule": "0 */4 * * *" }] }

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const GHL_API_KEY = process.env.GHL_API_KEY || "";
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || "n778xwOps9t8Q34eRPfM";

async function ghlSearchPage(startAfterId?: string) {
  const params: Record<string, string> = {
    locationId: GHL_LOCATION_ID,
    query: "",
    pageLimit: "100",
    sortBy: "dateUpdated",
    sortOrder: "desc",
  };
  if (startAfterId) params.startAfterId = startAfterId;

  const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GHL_API_KEY}`,
      "Version": "2021-07-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) throw new Error(`GHL search failed: ${res.status}`);
  const data = await res.json();
  return {
    contacts: data.contacts || [],
    total: data.total || 0,
  };
}

export async function GET(req: NextRequest) {
  // Verify this is a cron request or has the dialer key
  const authKey = req.headers.get("x-dialer-key") || req.nextUrl.searchParams.get("key");
  const isCron = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron && authKey !== process.env.DIALER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!GHL_API_KEY) {
    return NextResponse.json({ error: "GHL_API_KEY not configured" }, { status: 500 });
  }

  const startTime = Date.now();
  let updated = 0;
  let created = 0;
  let errors = 0;
  let processed = 0;

  // Get the last sync timestamp
  const lastSyncResult = await query(
    "SELECT MAX(updated_at) as last_sync FROM dialer_contacts WHERE updated_at IS NOT NULL"
  );
  const lastSync = lastSyncResult.rows[0]?.last_sync;
  const syncCutoff = lastSync ? new Date(lastSync) : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24h

  console.log(`[Sync] Starting. Last sync: ${syncCutoff.toISOString()}`);

  try {
    // Pull recently updated contacts from GHL (sorted by dateUpdated desc)
    // Stop when we hit contacts older than our last sync
    let hasMore = true;
    let startAfterId: string | undefined;
    let staleCount = 0;

    while (hasMore && processed < 2000) { // Cap at 2000 per run
      const { contacts } = await ghlSearchPage(startAfterId);

      if (contacts.length === 0) break;

      for (const c of contacts) {
        const contactUpdated = c.dateUpdated ? new Date(c.dateUpdated) : null;

        // If this contact is older than our last sync, we've caught up
        if (contactUpdated && contactUpdated < syncCutoff) {
          staleCount++;
          if (staleCount > 5) { // Allow a few out-of-order records
            hasMore = false;
            break;
          }
          continue;
        }

        const ghlId = c.id;
        if (!ghlId) continue;

        const tags = Array.isArray(c.tags) ? c.tags.join(", ") : (c.tags || null);

        try {
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
               updated_at = NOW()
             RETURNING (xmax = 0) AS is_insert`,
            [
              ghlId,
              c.firstName || c.first_name || null,
              c.lastName || c.last_name || null,
              c.phone || null,
              c.email || null,
              c.companyName || c.company_name || null,
              tags,
              c.dnd?.toString() || null,
              c.assignedTo || c.assigned_to || null,
            ]
          );

          if (result.rows[0]?.is_insert) created++;
          else updated++;
          processed++;
        } catch (e) {
          errors++;
          if (errors <= 3) console.error(`[Sync] Error on ${ghlId}:`, e);
        }
      }

      // Pagination
      if (contacts.length < 100) {
        hasMore = false;
      } else {
        startAfterId = contacts[contacts.length - 1].id;
      }

      // GHL rate limit
      await new Promise(r => setTimeout(r, 300));
    }

    // Also trigger SF sync
    let sfResult = null;
    try {
      const sfRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/sync/salesforce?key=${process.env.DIALER_API_KEY}`, {
        headers: { "x-dialer-key": process.env.DIALER_API_KEY || "" },
      });
      sfResult = await sfRes.json();
      console.log("[Sync] SF sync:", sfResult);
    } catch (sfErr) {
      console.error("[Sync] SF sync failed:", sfErr);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(`[Sync] Complete in ${duration}s. GHL: created=${created} updated=${updated}. SF: ${JSON.stringify(sfResult || "skipped")}`);

    return NextResponse.json({
      ok: true,
      duration: `${duration}s`,
      ghl: { created, updated, errors, processed },
      salesforce: sfResult,
      lastSync: syncCutoff.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[Sync] Fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
