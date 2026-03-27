// GET /api/leads?stage=missing_in_action
// Fetches leads from GHL for a specific pipeline stage

import { NextRequest, NextResponse } from "next/server";
import { getLeadsByStage, STAGE_MAP } from "@/lib/ghl";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const stage = req.nextUrl.searchParams.get("stage");

  if (!stage || !STAGE_MAP[stage]) {
    return NextResponse.json(
      {
        error: "Invalid stage. Valid stages: " + Object.keys(STAGE_MAP).join(", "),
      },
      { status: 400 }
    );
  }

  try {
    const leads = await getLeadsByStage(stage);
    return NextResponse.json({ leads, count: leads.length, stage });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to fetch leads:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
