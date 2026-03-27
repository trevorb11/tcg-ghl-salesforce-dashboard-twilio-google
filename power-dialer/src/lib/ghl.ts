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
