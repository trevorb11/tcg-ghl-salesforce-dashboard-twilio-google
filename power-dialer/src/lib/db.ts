// ============================================================
// Database client for dialer_contacts table (Neon Postgres)
// ============================================================

import type { Lead } from "./types";
import pg from "pg";
const { Pool } = pg;

const DB_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "";

let _pool: InstanceType<typeof Pool> | null = null;

function getPool() {
  if (!_pool && DB_URL) {
    _pool = new Pool({ connectionString: DB_URL, max: 5 });
    _pool.on("error", (err) => console.error("[DB Pool] Error:", err.message));
  }
  return _pool;
}

async function query(sql: string, params: unknown[] = []) {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");
  return pool.query(sql, params);
}

// Map stage keys to ALL matching opp_stage_selection values in DB
// Includes clean names AND prefixed variants (e.g. "open 2. App Sent (Cold) Missing In Action")
const DB_STAGE_MAP: Record<string, string[]> = {
  // App Sent (warm) — pipeline "1. App Sent"
  new_opportunity: [
    "New Opportunity",
    "open 1. App Sent New Opportunity",
    "abandoned 1. App Sent New Opportunity",
  ],
  waiting_for_app: [
    "Waiting for App / Statements",
    "open 1. App Sent Waiting for App / Statements",
    "abandoned 1. App Sent Waiting for App / Statements",
  ],
  second_attempt: ["2nd Attempt"],
  follow_up_30: [
    "open 1. App Sent Follow Up 30 days",
    "abandoned 1. App Sent Follow Up 30 days",
  ],
  // App Sent (cold) — pipeline "2. App Sent (Cold)"
  missing_in_action: [
    "Missing In Action",
    "open 2. App Sent (Cold) Missing In Action",
    "abandoned 2. App Sent (Cold) Missing In Action",
  ],
  no_use_at_moment: [
    "No Use At The Moment",
    "open 2. App Sent (Cold) No Use At The Moment",
  ],
  low_revenue: [
    "Low Revenue",
    "open 2. App Sent (Cold) Low Revenue",
  ],
  unrealistic: [
    "Unrealistic",
    "open 2. App Sent (Cold) Unrealistic",
    "open 5. Pipeline (Cold) Unrealistic",
    "abandoned 2. App Sent (Cold) Unrealistic",
  ],
  default_cold: [
    "Default",
    "open 2. App Sent (Cold) Default",
    "open 5. Pipeline (Cold) Default",
  ],
  // Hold
  hold: [
    "Hold",
    "open Hold Hold",
  ],
  follow_up: ["Follow Up Date Has Hit", "2nd Follow Up"],
  // Marketing Leads — pipeline "0. Marketing Leads"
  intake_form: ["Intake Form Submitted", "intake form submitted"],
  application_started: ["Application Started"],
  application_submitted: ["Application Submitted"],
  statements_submitted: ["Statements Submitted"],
  // Underwriting — pipeline "3. Underwriting" and "6. Underwriting"
  submitted_underwriting: [
    "Submitted to Underwriting",
    "Submitted To Underwriting",
  ],
  sent_to_lenders: [
    "Sent to Lenders",
    "New Submission - Need To Shop",
    "open 6. Underwriting New Submission - Need To Shop",
  ],
  requested_more_info: ["Requested More Information"],
  approved: [
    "Approved",
    "open 6. Underwriting Approved",
  ],
  // Pipeline (active deals) — pipeline "4. Pipeline" and "3. Pipeline"
  approved_moving: [
    "Approved - Moving Forward",
    "open 3. Pipeline Approved - Moving Forward",
  ],
  contracts_sent: ["Contracts Requested / Sent"],
  contracts_signed: ["Contracts Signed"],
  additional_stips: ["Additional Stips Needed"],
  final_underwriting: ["Final Underwriting / BV"],
  funded: [
    "Funded",
    "open 3. Pipeline Funded",
  ],
  renewal: ["Renewal Prospecting"],
  // Pipeline (cold) — pipeline "5. Pipeline (Cold)"
  unqualified: [
    "Unqualified",
    "open 5. Pipeline (Cold) Unqualified",
  ],
  funded_elsewhere: [
    "Funded Elsewhere",
    "open 5. Pipeline (Cold) Funded Elsewhere",
    "abandoned 5. Pipeline (Cold) Funded Elsewhere",
  ],
  dead_deal: [
    "Killed In Final / Dead Deal",
    "open 5. Pipeline (Cold) Killed In Final / Dead Deal",
  ],
  declined: ["Declined"],
  balances_too_high: [
    "Balances Too High",
    "open 5. Pipeline (Cold) Balances Too High",
  ],
  // SBA
  sba_referral: [
    "Referral In",
    "open 4. Pipeline SBA- 7a Referral In",
  ],
  sba_prequalified: ["Prequalified"],
  // Graveyard
  disconnected: ["Disconnected #"],
  do_not_contact: ["Do Not Contact"],
};

const LEAD_SELECT = `
  SELECT ghl_contact_id, first_name, last_name, phone, email, business_name,
         opp_stage_selection, pipeline_selection, tags, assigned_to,
         monthly_revenue, industry_dropdown, years_in_business,
         amount_requested, personal_credit_score_range, last_note,
         last_contacted, call_disposition, approval_letter,
         previously_funded, current_positions_balances,
         sf_lead_id, sf_contact_id, sf_opportunity_id, sf_account_id,
         sf_lead_status, sf_opp_stage, sf_opp_amount, sf_owner_name,
         sf_last_activity_date, sf_last_activity_type, sf_engagement_score,
         sf_lead_score, sf_funding_type_interest, sf_amount_requested AS sf_amount_requested_val,
         sf_follow_up_date, sf_notes
  FROM dialer_contacts
`;

function rowToLead(row: Record<string, string>, fallbackStage?: string): Lead & Record<string, unknown> {
  return {
    id: row.ghl_contact_id || `db-${row.phone}`,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    businessName: row.business_name || "",
    phone: row.phone,
    email: row.email || "",
    pipelineId: row.pipeline_selection || "",
    pipelineStageId: row.opp_stage_selection || "",
    stageName: row.opp_stage_selection || fallbackStage || "Custom List",
    opportunityId: undefined,
    tags: row.tags ? row.tags.split(",").map((t: string) => t.trim()) : [],
    lastContactedAt: row.last_contacted || undefined,
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
    // Salesforce IDs — used for SF record links
    _salesforceId: row.sf_opportunity_id || row.sf_lead_id || row.sf_contact_id || undefined,
    _salesforceType: row.sf_opportunity_id ? "Opportunity" : row.sf_lead_id ? "Lead" : row.sf_contact_id ? "Contact" : undefined,
    // Extra SF context for reps
    _sfLeadStatus: row.sf_lead_status || undefined,
    _sfOppStage: row.sf_opp_stage || undefined,
    _sfOppAmount: row.sf_opp_amount || undefined,
    _sfOwner: row.sf_owner_name || undefined,
    _sfLastActivity: row.sf_last_activity_date || undefined,
    _sfEngagementScore: row.sf_engagement_score || undefined,
    _sfLeadScore: row.sf_lead_score || undefined,
    _sfFollowUpDate: row.sf_follow_up_date || undefined,
    _sfNotes: row.sf_notes || undefined,
  };
}

export async function getLeadsFromDb(stageKey: string): Promise<Lead[]> {
  const stageValues = DB_STAGE_MAP[stageKey];
  if (!stageValues) throw new Error(`Unknown stage: ${stageKey}`);

  const placeholders = stageValues.map((_, i) => `$${i + 1}`).join(", ");
  const result = await query(
    `${LEAD_SELECT}
     WHERE opp_stage_selection IN (${placeholders})
       AND phone IS NOT NULL AND phone != ''
       AND (dnd IS NULL OR dnd = '' OR dnd = 'false')
     ORDER BY last_contacted ASC NULLS FIRST`,
    stageValues
  );

  return result.rows.map((row: Record<string, string>) => rowToLead(row, stageKey));
}

// Custom criteria query — build WHERE clauses from filter object
export interface LeadFilter {
  tags?: string[];           // ANY of these tags present (OR)
  tagsAll?: string[];        // ALL of these tags present (AND)
  assignedTo?: string;       // Assigned rep name
  industry?: string;         // Industry dropdown value (partial match)
  monthlyRevenueMin?: string; // Not empty
  amountRequestedMin?: string; // Not empty
  previouslyFunded?: string;  // "Yes" or "No"
  creditScore?: string;       // Partial match
  pipeline?: string;          // Pipeline name (partial match)
  stage?: string;             // Stage name (partial match)
  hasApproval?: boolean;      // Has approval letter
  hasPhone?: boolean;         // Has phone (default true)
  excludeDnd?: boolean;       // Exclude DND (default true)
  limit?: number;             // Max results (default 500)
  // Geographic
  state?: string;             // Comma-separated state codes or names (e.g. "CA,WA,OR")
  city?: string;              // City partial match
  areaCodes?: string[];       // Phone area codes (e.g. ["213","310","818"])
  // Activity/status
  lastDisposition?: string;   // Exact match (e.g. "No Answer", "Interested")
  neverContacted?: boolean;   // Only leads with no last_contacted
  contactedBefore?: string;   // Last contacted before this date
  contactedAfter?: string;    // Last contacted after this date
  // Salesforce
  sfOppStage?: string;        // SF opportunity stage (partial match)
  hasSfRecord?: boolean;      // Has any Salesforce ID
  sfFollowUpBefore?: string;  // SF follow-up date before
}

export async function getLeadsByCriteria(filters: LeadFilter): Promise<Lead[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  // Always require phone by default
  if (filters.hasPhone !== false) {
    conditions.push("phone IS NOT NULL AND phone != ''");
  }

  // Exclude DND by default
  if (filters.excludeDnd !== false) {
    conditions.push("(dnd IS NULL OR dnd = '' OR dnd = 'false')");
  }

  // Tags — any match (OR)
  if (filters.tags && filters.tags.length > 0) {
    const tagConditions = filters.tags.map((tag) => {
      params.push(`%${tag}%`);
      return `tags ILIKE $${paramIdx++}`;
    });
    conditions.push(`(${tagConditions.join(" OR ")})`);
  }

  // Tags — all match (AND)
  if (filters.tagsAll && filters.tagsAll.length > 0) {
    for (const tag of filters.tagsAll) {
      params.push(`%${tag}%`);
      conditions.push(`tags ILIKE $${paramIdx++}`);
    }
  }

  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`assigned_to = $${paramIdx++}`);
  }

  if (filters.industry) {
    params.push(`%${filters.industry}%`);
    conditions.push(`industry_dropdown ILIKE $${paramIdx++}`);
  }

  if (filters.monthlyRevenueMin) {
    conditions.push("monthly_revenue IS NOT NULL AND monthly_revenue != ''");
  }

  if (filters.amountRequestedMin) {
    conditions.push("amount_requested IS NOT NULL AND amount_requested != ''");
  }

  if (filters.previouslyFunded) {
    params.push(filters.previouslyFunded);
    conditions.push(`previously_funded = $${paramIdx++}`);
  }

  if (filters.creditScore) {
    params.push(`%${filters.creditScore}%`);
    conditions.push(`personal_credit_score_range ILIKE $${paramIdx++}`);
  }

  if (filters.pipeline) {
    params.push(`%${filters.pipeline}%`);
    conditions.push(`pipeline_selection ILIKE $${paramIdx++}`);
  }

  if (filters.stage) {
    params.push(`%${filters.stage}%`);
    conditions.push(`opp_stage_selection ILIKE $${paramIdx++}`);
  }

  if (filters.hasApproval) {
    conditions.push("approval_letter IS NOT NULL AND approval_letter != ''");
  }

  // Geographic filters
  if (filters.state) {
    const states = filters.state.split(",").map(s => s.trim()).filter(Boolean);
    if (states.length > 0) {
      const stateConditions = states.map(s => {
        params.push(`%${s}%`);
        const idx = paramIdx++;
        return `(state ILIKE $${idx} OR tags ILIKE $${idx})`;
      });
      conditions.push(`(${stateConditions.join(" OR ")})`);
    }
  }

  if (filters.city) {
    params.push(`%${filters.city}%`);
    conditions.push(`city ILIKE $${paramIdx++}`);
  }

  if (filters.areaCodes && filters.areaCodes.length > 0) {
    const acConditions = filters.areaCodes.map(ac => {
      params.push(`%${ac}%`);
      return `phone LIKE $${paramIdx++}`;
    });
    conditions.push(`(${acConditions.join(" OR ")})`);
  }

  // Activity/status filters
  if (filters.lastDisposition) {
    params.push(`%${filters.lastDisposition}%`);
    conditions.push(`call_disposition ILIKE $${paramIdx++}`);
  }

  if (filters.neverContacted) {
    conditions.push("(last_contacted IS NULL OR last_contacted = '')");
  }

  if (filters.contactedBefore) {
    params.push(filters.contactedBefore);
    conditions.push(`last_contacted < $${paramIdx++}`);
  }

  if (filters.contactedAfter) {
    params.push(filters.contactedAfter);
    conditions.push(`last_contacted > $${paramIdx++}`);
  }

  // Salesforce filters
  if (filters.sfOppStage) {
    params.push(`%${filters.sfOppStage}%`);
    conditions.push(`sf_opp_stage ILIKE $${paramIdx++}`);
  }

  if (filters.hasSfRecord) {
    conditions.push("(sf_contact_id IS NOT NULL OR sf_lead_id IS NOT NULL OR sf_opportunity_id IS NOT NULL)");
  }

  if (filters.sfFollowUpBefore) {
    params.push(filters.sfFollowUpBefore);
    conditions.push(`sf_follow_up_date <= $${paramIdx++}`);
  }

  const limit = Math.min(filters.limit || 500, 2000);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query(
    `${LEAD_SELECT} ${whereClause}
     ORDER BY last_contacted ASC NULLS FIRST
     LIMIT ${limit}`,
    params
  );

  return result.rows.map((row: Record<string, string>) => rowToLead(row, "Custom List"));
}

export async function getLeadsByRep(repName: string): Promise<Lead[]> {
  const result = await query(
    `${LEAD_SELECT}
     WHERE assigned_to = $1
       AND phone IS NOT NULL AND phone != ''
       AND (dnd IS NULL OR dnd = '' OR dnd = 'false')
     ORDER BY last_contacted ASC NULLS FIRST`,
    [repName]
  );

  return result.rows.map((row: Record<string, string>) => rowToLead(row, "All"));
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

export { DB_STAGE_MAP, query };
