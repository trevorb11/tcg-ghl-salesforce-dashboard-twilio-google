// ============================================================
// AI-Powered Lead Search — Claude Haiku converts natural
// language into SQL WHERE clauses for dialer_contacts
// ============================================================

import { query } from "./db";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const TABLE_SCHEMA = `
Table: dialer_contacts
Key columns (use these for filtering):
- first_name TEXT, last_name TEXT — contact name
- phone TEXT — phone number (E.164 format like +15551234567)
- email TEXT
- business_name TEXT — company name
- assigned_to TEXT — rep name (e.g. "Dillon LeBlanc")
- tags TEXT — comma-separated tags (e.g. "sba, ucc leads, top tier prospects, industry-construction, cali")
- monthly_revenue TEXT — format varies: "$35,000", "$35K", "35000", "$25,000 - $50,000" etc.
- industry_dropdown TEXT — e.g. "Construction", "Trucking", "Restaurant", "Healthcare"
- amount_requested TEXT — funding amount requested, similar format to revenue
- personal_credit_score_range TEXT — e.g. "700-749", "650+", "600-649"
- years_in_business TEXT — e.g. "5", "10", "2"
- previously_funded TEXT — "Yes" or "No"
- current_positions_balances TEXT — existing MCA positions
- call_disposition TEXT — last call result: "No Answer", "Interested", "Callback", "Not Interested", "Voicemail", "Wrong Number", "Disconnected"
- last_contacted TEXT — date string like "Feb 06 2026" or "Mar 15 2026"
- last_note TEXT — last CRM note
- opp_stage_selection TEXT — GHL pipeline stage
- pipeline_selection TEXT — GHL pipeline name
- state TEXT — state abbreviation or name
- city TEXT — city name
- dnd TEXT — "true" if Do Not Contact
- approval_letter TEXT — URL if has approval
- source TEXT — lead source
- lead_batch TEXT — batch identifier
- sf_opportunity_id TEXT — Salesforce Opportunity ID (not null = has SF record)
- sf_opp_stage TEXT — Salesforce stage like "Application & Docs", "Underwriting"
- sf_lead_id TEXT — Salesforce Lead ID
- sf_contact_id TEXT — Salesforce Contact ID

IMPORTANT format notes:
- monthly_revenue is TEXT with inconsistent formats: "$117,098", "$35K", "35000", "$25,000 - $50,000", "$50k+", etc.
- To filter by revenue amount, use pattern matching or CAST with error handling
- For "revenue over $30k", match: monthly_revenue IS NOT NULL AND monthly_revenue != '' and then use REPLACE to strip $ and , before casting
- phone always has country code prefix like +1
- tags is a single TEXT field with comma-separated values, use ILIKE '%tag%'
- dnd should always be excluded: (dnd IS NULL OR dnd = '' OR dnd = 'false')
- Always include: phone IS NOT NULL AND phone != ''
`;

export async function aiSearchLeads(
  naturalQuery: string,
  repName?: string,
  limit: number = 200
): Promise<{ leads: unknown[]; count: number; sql: string; description: string }> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const repFilter = repName ? `The rep is "${repName}" — filter by assigned_to = '${repName}'.` : "";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `You are a SQL query builder for a sales dialer. Convert this natural language request into a PostgreSQL WHERE clause for the dialer_contacts table.

${TABLE_SCHEMA}

${repFilter}

RULES:
- Always exclude DND: (dnd IS NULL OR dnd = '' OR dnd = 'false')
- Always require phone: phone IS NOT NULL AND phone != ''
- For revenue comparisons, use: CAST(REGEXP_REPLACE(REPLACE(REPLACE(monthly_revenue, '$', ''), ',', ''), '[^0-9.]', '', 'g') AS NUMERIC)
- Wrap revenue CAST in a CASE WHEN to handle non-numeric values
- Use ILIKE for text matching (case insensitive)
- Return ONLY a JSON object with two fields:
  - "where": the WHERE clause (without the word WHERE)
  - "description": a brief human-readable description of what the query finds

User request: "${naturalQuery}"

Return ONLY valid JSON, nothing else.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || "";

  // Parse the JSON response
  let parsed: { where: string; description: string };
  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Failed to parse AI response: ${content.substring(0, 200)}`);
  }

  if (!parsed.where) {
    throw new Error("AI returned empty WHERE clause");
  }

  // Safety check — prevent destructive queries (match SQL keywords as statements, not substrings)
  const whereLower = parsed.where.toLowerCase();
  if (/\b(drop|delete|truncate|alter)\b/i.test(whereLower) ||
      /\b(insert\s+into|update\s+\w+\s+set)\b/i.test(whereLower) ||
      whereLower.includes(";")) {
    throw new Error("Invalid query detected");
  }

  const sql = `SELECT ghl_contact_id, first_name, last_name, phone, email, business_name,
    opp_stage_selection, pipeline_selection, tags, assigned_to,
    monthly_revenue, industry_dropdown, years_in_business,
    amount_requested, personal_credit_score_range, last_note,
    last_contacted, call_disposition, approval_letter,
    previously_funded, current_positions_balances,
    sf_lead_id, sf_contact_id, sf_opportunity_id, sf_account_id,
    sf_opp_stage, sf_opp_amount
  FROM dialer_contacts
  WHERE ${parsed.where}
  ORDER BY last_contacted ASC NULLS FIRST
  LIMIT ${Math.min(limit, 2000)}`;

  const result = await query(sql);

  // Map rows to lead format
  const leads = result.rows.map((row: Record<string, string>) => ({
    id: row.ghl_contact_id || `db-${row.phone}`,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    businessName: row.business_name || "",
    phone: row.phone,
    email: row.email || "",
    pipelineId: row.pipeline_selection || "",
    pipelineStageId: row.opp_stage_selection || "",
    stageName: row.opp_stage_selection || "AI Search",
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
    _salesforceId: row.sf_opportunity_id || row.sf_lead_id || row.sf_contact_id || undefined,
    _salesforceType: row.sf_opportunity_id ? "Opportunity" : row.sf_lead_id ? "Lead" : row.sf_contact_id ? "Contact" : undefined,
  }));

  return {
    leads,
    count: leads.length,
    sql,
    description: parsed.description,
  };
}
