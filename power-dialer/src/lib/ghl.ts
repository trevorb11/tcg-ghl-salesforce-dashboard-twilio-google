// ============================================================
// GoHighLevel API Client — Pull leads by pipeline stage
// ============================================================

import type { Lead } from "./types";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_KEY = process.env.GHL_API_KEY || "";
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || "n778xwOps9t8Q34eRPfM";

const GHL_HEADERS = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: "2021-07-28",
  "Content-Type": "application/json",
};

// Map friendly stage names to GHL pipeline/stage IDs
export const STAGE_MAP: Record<string, { pipelineId: string; stageId: string; label: string }> = {
  // App Sent (warm)
  new_opportunity:     { pipelineId: "pjjgB0kC9vAkneufgt9g", stageId: "2a213c3f-01f9-46c6-9193-f38e1c2307da", label: "New Opportunity" },
  waiting_for_app:     { pipelineId: "pjjgB0kC9vAkneufgt9g", stageId: "eb3cc53b-1b7b-47d7-9353-7a69ffff78e5", label: "Waiting for App/Statements" },
  second_attempt:      { pipelineId: "pjjgB0kC9vAkneufgt9g", stageId: "29c565c5-8c05-4b90-869f-540fb24f2f0c", label: "2nd Attempt" },
  // App Sent (cold) — "absent" leads
  missing_in_action:   { pipelineId: "bNRbE4dCbSxmpPQ4W0gu", stageId: "7147307c-260c-42c9-a6b0-ce19341ee225", label: "Missing In Action" },
  no_use_at_moment:    { pipelineId: "bNRbE4dCbSxmpPQ4W0gu", stageId: "ed8bf405-28bf-4e5d-8280-8e930129ff76", label: "No Use At The Moment" },
  low_revenue:         { pipelineId: "bNRbE4dCbSxmpPQ4W0gu", stageId: "f549f6de-9bbd-4513-8647-30b4a30de344", label: "Low Revenue" },
  // Hold
  hold:                { pipelineId: "RP9Z9EMA3UHNRGbrQEiU", stageId: "hold-stage", label: "Hold" },
  follow_up:           { pipelineId: "RP9Z9EMA3UHNRGbrQEiU", stageId: "follow-up-stage", label: "Follow Up Date Has Hit" },
  // Pipeline (warm deals)
  approved_moving:     { pipelineId: "jLsHCKE4gswjkxLu4EsV", stageId: "3b2c89c9-05b2-4b60-bec2-d52572507acf", label: "Approved - Moving Forward" },
  contracts_sent:      { pipelineId: "jLsHCKE4gswjkxLu4EsV", stageId: "395500e0-7496-4c75-94ea-cec2b39200e4", label: "Contracts Requested/Sent" },
  renewal:             { pipelineId: "jLsHCKE4gswjkxLu4EsV", stageId: "93dd89cd-06d8-4ae5-83f3-63ed15f51396", label: "Renewal Prospecting" },
  // Marketing Leads (admin)
  intake_form:             { pipelineId: "2ZuG0JXXga3RlZ7KvWmZ", stageId: "a2d67bc8-9106-4447-ae82-b8f825b54ce3", label: "Intake Form Submitted" },
  application_started:     { pipelineId: "2ZuG0JXXga3RlZ7KvWmZ", stageId: "86b428b0-f782-44e3-a93e-186c5033e1c0", label: "Application Started" },
  application_submitted:   { pipelineId: "2ZuG0JXXga3RlZ7KvWmZ", stageId: "18208225-029d-4eb6-9a80-0e67dcb3e221", label: "Application Submitted" },
  statements_submitted:    { pipelineId: "2ZuG0JXXga3RlZ7KvWmZ", stageId: "60378850-7811-4b3d-8826-63c74de95c4c", label: "Statements Submitted" },
  // Underwriting (admin)
  submitted_underwriting:  { pipelineId: "AWNQpZ8HuhqxAvoBlRQQ", stageId: "738d96bb-4b4d-4c33-9b20-3c53a2c35809", label: "Submitted to Underwriting" },
  sent_to_lenders:         { pipelineId: "AWNQpZ8HuhqxAvoBlRQQ", stageId: "7e7f3b9c-9b59-4715-91af-220eb8cc776e", label: "Sent to Lenders" },
  requested_more_info:     { pipelineId: "AWNQpZ8HuhqxAvoBlRQQ", stageId: "dfb7a5cf-f047-4f9a-bb3c-a9ecb9986cdd", label: "Requested More Information" },
  approved:                { pipelineId: "AWNQpZ8HuhqxAvoBlRQQ", stageId: "3fa7ca03-e0a7-4049-8874-1d563a3b3820", label: "Approved" },
  // Pipeline extended (admin)
  contracts_signed:        { pipelineId: "jLsHCKE4gswjkxLu4EsV", stageId: "dfee3d1b-603a-46cd-9581-b230454a40f4", label: "Contracts Signed" },
  additional_stips:        { pipelineId: "jLsHCKE4gswjkxLu4EsV", stageId: "16ea8e0f-445f-4636-a11d-9f74200532cc", label: "Additional Stips Needed" },
  final_underwriting:      { pipelineId: "jLsHCKE4gswjkxLu4EsV", stageId: "05c75c10-834f-43f2-b1a5-433446dd4217", label: "Final Underwriting / BV" },
  funded:                  { pipelineId: "jLsHCKE4gswjkxLu4EsV", stageId: "c4d7ea46-8450-4c5b-a5b0-d1cdc55e6665", label: "Funded" },
  // Cold / Graveyard (admin)
  unrealistic:             { pipelineId: "bNRbE4dCbSxmpPQ4W0gu", stageId: "81ed3074-3843-401d-a8c3-26ce829f6993", label: "Unrealistic" },
  funded_elsewhere:        { pipelineId: "cn5qN7tb99iFRAilrSnH", stageId: "ec5e14a4-87b6-4cdb-918d-6e51e2f837c2", label: "Funded Elsewhere" },
  dead_deal:               { pipelineId: "cn5qN7tb99iFRAilrSnH", stageId: "37e8137c-94c4-4012-a88b-61c670793148", label: "Killed In Final / Dead Deal" },
  declined:                { pipelineId: "cn5qN7tb99iFRAilrSnH", stageId: "9407450b-7362-4772-abaf-911bea5aa291", label: "Declined" },
  disconnected:            { pipelineId: "76zHAUBmcyJlVdH0g6bQ", stageId: "disconnected-stage", label: "Disconnected #" },
  do_not_contact:          { pipelineId: "76zHAUBmcyJlVdH0g6bQ", stageId: "do-not-contact-stage", label: "Do Not Contact" },
};

// Grouped for the UI dropdown
export const STAGE_GROUPS = [
  {
    label: "Absent / Cold Leads",
    stages: ["missing_in_action", "no_use_at_moment", "low_revenue"],
  },
  {
    label: "App Sent (Warm)",
    stages: ["new_opportunity", "waiting_for_app", "second_attempt"],
  },
  {
    label: "Pipeline (Active Deals)",
    stages: ["approved_moving", "contracts_sent", "renewal"],
  },
  {
    label: "Hold / Follow-Up",
    stages: ["hold", "follow_up"],
  },
];

interface GHLOpportunity {
  id: string;
  name: string;
  contact: {
    id: string;
    name: string;
    email: string;
    phone: string;
    tags?: string[];
  };
  pipelineId: string;
  pipelineStageId: string;
  assignedTo?: string;
  lastStatusChangeAt?: string;
}

// Search opportunities in a specific pipeline stage
export async function getLeadsByStage(
  stageKey: string,
  assignedToEmail?: string
): Promise<Lead[]> {
  const stage = STAGE_MAP[stageKey];
  if (!stage) throw new Error(`Unknown stage: ${stageKey}`);

  const leads: Lead[] = [];
  let hasMore = true;
  let startAfterId = "";
  const pageLimit = 50;

  while (hasMore) {
    const params = new URLSearchParams({
      location_id: GHL_LOCATION_ID,
      pipeline_id: stage.pipelineId,
      pipeline_stage_id: stage.stageId,
      limit: String(pageLimit),
    });
    if (startAfterId) params.set("startAfterId", startAfterId);

    const res = await fetch(`${GHL_BASE}/opportunities/search?${params}`, {
      headers: GHL_HEADERS,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const opps: GHLOpportunity[] = data.opportunities || [];

    for (const opp of opps) {
      if (!opp.contact?.phone) continue; // Skip leads without phone numbers

      leads.push({
        id: opp.contact.id,
        name: opp.contact.name || opp.name,
        businessName: opp.name,
        phone: opp.contact.phone,
        email: opp.contact.email || "",
        pipelineId: opp.pipelineId,
        pipelineStageId: opp.pipelineStageId,
        stageName: stage.label,
        opportunityId: opp.id,
        tags: opp.contact.tags,
        lastContactedAt: opp.lastStatusChangeAt,
      });
    }

    // GHL pagination
    if (opps.length < pageLimit) {
      hasMore = false;
    } else {
      startAfterId = opps[opps.length - 1].id;
    }
  }

  return leads;
}

// Search for a specific contact
export async function searchContact(query: string) {
  const res = await fetch(`${GHL_BASE}/contacts/search`, {
    method: "POST",
    headers: GHL_HEADERS,
    body: JSON.stringify({
      locationId: GHL_LOCATION_ID,
      query,
      pageLimit: 10,
    }),
  });

  if (!res.ok) throw new Error(`GHL search error: ${res.status}`);
  return res.json();
}

// Add a note to a contact
export async function addContactNote(contactId: string, body: string) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: "POST",
    headers: GHL_HEADERS,
    body: JSON.stringify({ body, locationId: GHL_LOCATION_ID }),
  });

  if (!res.ok) throw new Error(`GHL note error: ${res.status}`);
  return res.json();
}
