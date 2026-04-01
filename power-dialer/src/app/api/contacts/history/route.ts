// GET /api/contacts/history?phone=+15551234567 — Get call history for a contact
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const digits = phone.replace(/\D/g, "").slice(-10);

  try {
    // Check dialer_session_logs for calls to this number
    const result = await query(
      `SELECT call_details FROM dialer_session_logs
       WHERE call_details::text ILIKE $1
       ORDER BY started_at DESC LIMIT 5`,
      [`%${digits}%`]
    );

    const history: {disposition: string; date: string; notes?: string}[] = [];

    for (const row of result.rows) {
      try {
        const details = typeof row.call_details === 'string' ? JSON.parse(row.call_details) : row.call_details;
        if (Array.isArray(details)) {
          for (const call of details) {
            if (call.phone?.includes(digits) || call.name) {
              history.push({
                disposition: call.disposition || "Unknown",
                date: call.date || call.startedAt || "",
                notes: call.notes || "",
              });
            }
          }
        }
      } catch { /* skip malformed entries */ }
    }

    // Also check the contact record itself
    const contact = await query(
      `SELECT call_disposition, last_contacted, last_note, dialer_call_count
       FROM dialer_contacts WHERE phone LIKE $1 LIMIT 1`,
      [`%${digits}`]
    );

    return NextResponse.json({
      history,
      contact: contact.rows[0] || null,
      totalCalls: contact.rows[0]?.dialer_call_count || 0,
    });
  } catch {
    return NextResponse.json({ history: [], contact: null, totalCalls: 0 });
  }
}
