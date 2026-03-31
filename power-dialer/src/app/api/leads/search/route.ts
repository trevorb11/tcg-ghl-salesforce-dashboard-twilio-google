// GET /api/leads/search?q=construction+florida+revenue&rep=Dillon+LeBlanc
// Smart natural language lead search — parses rep-speak into database filters.
//
// Examples:
//   "construction guys in florida with revenue" → industry + state + revenue filter
//   "never called trucking leads" → trucking industry + never contacted
//   "west coast SBA leads" → CA,WA,OR + sba tag
//   "no answers from last week" → disposition filter
//   "top tier prospects with approvals" → tag + approval filter

import { NextRequest, NextResponse } from "next/server";
import { getLeadsByCriteria } from "@/lib/db";
import { parseLeadQuery, describeFilter } from "@/lib/query-parser";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const q = req.nextUrl.searchParams.get("q");
  const repName = req.nextUrl.searchParams.get("rep") || undefined;

  if (!q) {
    return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
  }

  const filters = parseLeadQuery(q, repName);
  const description = describeFilter(filters);

  // Must have at least one meaningful filter beyond assignedTo
  const hasRealFilter = filters.industry || filters.state || filters.tags?.length ||
    filters.lastDisposition || filters.neverContacted || filters.monthlyRevenueMin ||
    filters.hasApproval || filters.previouslyFunded || filters.hasSfRecord ||
    filters.sfOppStage || filters.areaCodes?.length;

  if (!hasRealFilter) {
    return NextResponse.json({
      error: `Couldn't understand "${q}". Try something like: "construction leads in Florida with revenue" or "never called trucking leads"`,
      parsed: filters,
      description,
    }, { status: 400 });
  }

  try {
    const leads = await getLeadsByCriteria(filters);
    return NextResponse.json({
      leads,
      count: leads.length,
      query: q,
      filters,
      description,
      source: "smart-search",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
