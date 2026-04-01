// GET /api/leads/ai-search?q=contacts+with+revenue+over+30k+in+construction&rep=Dillon+LeBlanc
// AI-powered natural language lead search using Claude Haiku
// Cost: ~$0.003 per search

import { NextRequest, NextResponse } from "next/server";
import { aiSearchLeads } from "@/lib/ai-search";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const q = req.nextUrl.searchParams.get("q");
  const repName = req.nextUrl.searchParams.get("rep") || undefined;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "200");

  if (!q) {
    return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
  }

  try {
    const result = await aiSearchLeads(q, repName, limit);
    return NextResponse.json({
      ...result,
      query: q,
      source: "ai-search",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "AI search failed";
    console.error("[AI Search] Error:", message);

    // If AI fails, fall back to the basic pattern-matching search
    try {
      const { parseLeadQuery } = await import("@/lib/query-parser");
      const { getLeadsByCriteria } = await import("@/lib/db");
      const filters = parseLeadQuery(q, repName);
      const leads = await getLeadsByCriteria(filters);
      return NextResponse.json({
        leads,
        count: leads.length,
        query: q,
        aiError: message,
        description: "Fallback search (AI unavailable)",
        source: "fallback",
      });
    } catch {
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
}
