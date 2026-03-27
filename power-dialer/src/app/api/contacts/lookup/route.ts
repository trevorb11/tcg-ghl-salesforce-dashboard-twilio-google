// GET /api/contacts/lookup?phone=+15551234567
// Looks up a contact by phone number in the dialer_contacts database.
// Returns full contact info if found, or { found: false } if not.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "phone parameter is required" }, { status: 400 });
  }

  // Normalize to digits for flexible matching
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  if (!digits.startsWith("+")) digits = "+" + digits;

  try {
    // Try exact match first, then partial (last 10 digits)
    const last10 = digits.slice(-10);
    const result = await query(
      `SELECT ghl_contact_id, first_name, last_name, phone, email, business_name,
              doing_business_as, opp_stage_selection, pipeline_selection, tags, assigned_to,
              monthly_revenue, industry_dropdown, years_in_business,
              amount_requested, personal_credit_score_range, last_note,
              last_contacted, call_disposition, approval_letter,
              previously_funded, current_positions_balances, previous_lender,
              prior_advance_details, ucc_filings, most_recent_filing_date,
              website, city, state, source, lead_batch, selling_note
       FROM dialer_contacts
       WHERE phone LIKE $1 OR phone LIKE $2 OR phone LIKE $3
       LIMIT 1`,
      [digits, `%${last10}`, `+1${last10}`]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ found: false });
    }

    const row = result.rows[0];
    return NextResponse.json({
      found: true,
      contact: {
        id: row.ghl_contact_id,
        firstName: row.first_name,
        lastName: row.last_name,
        name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
        phone: row.phone,
        email: row.email,
        businessName: row.business_name,
        dba: row.doing_business_as,
        stage: row.opp_stage_selection,
        pipeline: row.pipeline_selection,
        tags: row.tags,
        assignedTo: row.assigned_to,
        monthlyRevenue: row.monthly_revenue,
        industry: row.industry_dropdown,
        yearsInBusiness: row.years_in_business,
        amountRequested: row.amount_requested,
        creditScore: row.personal_credit_score_range,
        lastNote: row.last_note,
        lastContacted: row.last_contacted,
        lastDisposition: row.call_disposition,
        approvalLetter: row.approval_letter,
        previouslyFunded: row.previously_funded,
        currentPositions: row.current_positions_balances,
        previousLender: row.previous_lender,
        priorAdvanceDetails: row.prior_advance_details,
        uccFilings: row.ucc_filings,
        mostRecentFilingDate: row.most_recent_filing_date,
        website: row.website,
        city: row.city,
        state: row.state,
        source: row.source,
        leadBatch: row.lead_batch,
        sellingNote: row.selling_note,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    console.error("Contact lookup error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
