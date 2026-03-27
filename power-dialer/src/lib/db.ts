// ============================================================
// Database client for dialer_contacts table (Neon Postgres)
// ============================================================

import type { Lead } from "./types";

const DB_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "";

// Use dynamic import to avoid bundling pg in client code
async function query(sql: string, params: unknown[] = []) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    await client.end();
  }
}

// Map stage keys used in the UI to the opp_stage_selection values stored in DB
const DB_STAGE_MAP: Record<string, string[]> = {
  // App Sent (warm)
  new_opportunity: ["New Opportunity"],
  waiting_for_app: ["Waiting for App / Statements"],
  second_attempt: ["2nd Attempt"],
  // App Sent (cold)
  missing_in_action: ["Missing In Action"],
  no_use_at_moment: ["No Use At The Moment"],
  low_revenue: ["Low Revenue"],
  // Hold
  hold: ["Hold"],
  follow_up: ["Follow Up Date Has Hit", "Follow Up 30 days", "2nd Follow Up"],
  // Pipeline (warm)
  approved_moving: ["Approved - Moving Forward"],
  contracts_sent: ["Contracts Requested / Sent"],
  renewal: ["Renewal Prospecting"],
  // Marketing Leads
  intake_form: ["Intake Form Submitted", "intake form submitted"],
  application_started: ["Application Started"],
  application_submitted: ["Application Submitted"],
  statements_submitted: ["Statements Submitted"],
  // Underwriting
  submitted_underwriting: ["Submitted to Underwriting", "Submitted To Underwriting"],
  sent_to_lenders: ["Sent to Lenders", "New Submission - Need To Shop"],
  requested_more_info: ["Requested More Information"],
  approved: ["Approved"],
  // Pipeline extended
  contracts_signed: ["Contracts Signed"],
  additional_stips: ["Additional Stips Needed"],
  final_underwriting: ["Final Underwriting / BV"],
  funded: ["Funded"],
  // Cold / Graveyard
  unrealistic: ["Unrealistic"],
  funded_elsewhere: ["Funded Elsewhere"],
  dead_deal: ["Killed In Final / Dead Deal"],
  declined: ["Declined"],
  unqualified: ["Unqualified"],
  disconnected: ["Disconnected #"],
  do_not_contact: ["Do Not Contact"],
  balances_too_high: ["Balances Too High"],
  default_cold: ["Default"],
};

export async function getLeadsFromDb(stageKey: string): Promise<Lead[]> {
  const stageValues = DB_STAGE_MAP[stageKey];
  if (!stageValues) throw new Error(`Unknown stage: ${stageKey}`);

  const placeholders = stageValues.map((_, i) => `$${i + 1}`).join(", ");
  const result = await query(
    `SELECT ghl_contact_id, first_name, last_name, phone, email, business_name,
            opp_stage_selection, pipeline_selection, tags, assigned_to,
            monthly_revenue, industry_dropdown, years_in_business,
            amount_requested, personal_credit_score_range, last_note,
            last_contacted, call_disposition, approval_letter,
            previously_funded, current_positions_balances
     FROM dialer_contacts
     WHERE opp_stage_selection IN (${placeholders})
       AND phone IS NOT NULL AND phone != ''
       AND (dnd IS NULL OR dnd = '' OR dnd = 'false')
     ORDER BY last_contacted ASC NULLS FIRST`,
    stageValues
  );

  return result.rows.map((row: Record<string, string>) => ({
    id: row.ghl_contact_id || `db-${row.phone}`,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    businessName: row.business_name || "",
    phone: row.phone,
    email: row.email || "",
    pipelineId: row.pipeline_selection || "",
    pipelineStageId: row.opp_stage_selection || "",
    stageName: row.opp_stage_selection || stageKey,
    opportunityId: undefined,
    tags: row.tags ? row.tags.split(",").map((t: string) => t.trim()) : [],
    lastContactedAt: row.last_contacted || undefined,
    // Extra context for the dialer UI
    _monthlyRevenue: row.monthly_revenue || undefined,
    _industry: row.industry_dropdown || undefined,
    _yearsInBusiness: row.years_in_business || undefined,
    _amountRequested: row.amount_requested || undefined,
    _creditScore: row.personal_credit_score_range || undefined,
    _lastNote: row.last_note || undefined,
    _lastDisposition: row.call_disposition || undefined,
    _approvalLetter: row.approval_letter || undefined,
    _previouslyFunded: row.previously_funded || undefined,
    _currentPositions: row.current_positions_balances || undefined,
  }));
}

export async function getLeadsByRep(repName: string): Promise<Lead[]> {
  const result = await query(
    `SELECT ghl_contact_id, first_name, last_name, phone, email, business_name,
            opp_stage_selection, pipeline_selection, tags, last_note, last_contacted
     FROM dialer_contacts
     WHERE assigned_to = $1
       AND phone IS NOT NULL AND phone != ''
       AND (dnd IS NULL OR dnd = '' OR dnd = 'false')
     ORDER BY last_contacted ASC NULLS FIRST`,
    [repName]
  );

  return result.rows.map((row: Record<string, string>) => ({
    id: row.ghl_contact_id || `db-${row.phone}`,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    businessName: row.business_name || "",
    phone: row.phone,
    email: row.email || "",
    pipelineId: row.pipeline_selection || "",
    pipelineStageId: row.opp_stage_selection || "",
    stageName: row.opp_stage_selection || "All",
  }));
}

export async function getDbStageCount(stageKey: string): Promise<number> {
  const stageValues = DB_STAGE_MAP[stageKey];
  if (!stageValues) return 0;
  const placeholders = stageValues.map((_, i) => `$${i + 1}`).join(", ");
  const result = await query(
    `SELECT COUNT(*) FROM dialer_contacts
     WHERE opp_stage_selection IN (${placeholders})
       AND phone IS NOT NULL AND phone != ''
       AND (dnd IS NULL OR dnd = '' OR dnd = 'false')`,
    stageValues
  );
  return parseInt(result.rows[0].count, 10);
}

export { DB_STAGE_MAP };
