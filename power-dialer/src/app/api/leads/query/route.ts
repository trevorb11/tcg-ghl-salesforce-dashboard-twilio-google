// POST /api/leads/query — Load leads by custom criteria from the database
// Used by: dashboard custom list builder, Claude Code for dynamic list generation
//
// Body: { tags?: string[], tagsAll?: string[], assignedTo?: string,
//         industry?: string, monthlyRevenueMin?: string, previouslyFunded?: string,
//         creditScore?: string, pipeline?: string, stage?: string,
//         hasApproval?: boolean, limit?: number }

import { NextRequest, NextResponse } from "next/server";
import { getLeadsByCriteria, type LeadFilter } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const filters: LeadFilter = await req.json();

  // Must have at least one filter
  const hasFilter = filters.tags?.length || filters.tagsAll?.length ||
    filters.assignedTo || filters.industry || filters.monthlyRevenueMin ||
    filters.amountRequestedMin || filters.previouslyFunded || filters.creditScore ||
    filters.pipeline || filters.stage || filters.hasApproval;

  if (!hasFilter) {
    return NextResponse.json(
      { error: "At least one filter is required. Available: tags, tagsAll, assignedTo, industry, monthlyRevenueMin, amountRequestedMin, previouslyFunded, creditScore, pipeline, stage, hasApproval" },
      { status: 400 }
    );
  }

  try {
    const leads = await getLeadsByCriteria(filters);
    return NextResponse.json({
      leads,
      count: leads.length,
      source: "db",
      filters,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Custom query failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
