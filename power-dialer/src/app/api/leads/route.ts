// GET /api/leads?stage=missing_in_action&source=db|ghl
// Fetches leads from local database (default) or GHL as fallback

import { NextRequest, NextResponse } from "next/server";
import { getLeadsByStage, STAGE_MAP } from "@/lib/ghl";
import { getLeadsFromDb, DB_STAGE_MAP } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const stage = req.nextUrl.searchParams.get("stage");
  const source = req.nextUrl.searchParams.get("source") || "db";
  const rep = req.nextUrl.searchParams.get("rep") || undefined;

  if (!stage) {
    return NextResponse.json({ error: "stage parameter is required" }, { status: 400 });
  }

  // Force GHL if requested or if stage isn't in DB map
  const useGhl = source === "ghl" || (!DB_STAGE_MAP[stage] && STAGE_MAP[stage]);

  if (useGhl) {
    if (!STAGE_MAP[stage]) {
      return NextResponse.json(
        { error: "Invalid stage. Valid stages: " + Object.keys(STAGE_MAP).join(", ") },
        { status: 400 }
      );
    }

    try {
      const leads = await getLeadsByStage(stage);
      return NextResponse.json({ leads, count: leads.length, source: "ghl", stage });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("GHL lead fetch error:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Default: pull from database
  if (!DB_STAGE_MAP[stage]) {
    return NextResponse.json(
      { error: "Invalid stage. Valid stages: " + Object.keys({ ...DB_STAGE_MAP, ...STAGE_MAP }).join(", ") },
      { status: 400 }
    );
  }

  try {
    const leads = await getLeadsFromDb(stage, rep);
    return NextResponse.json({ leads, count: leads.length, source: "db", stage, filteredByRep: !!rep });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("DB lead fetch error:", message);

    // Fallback to GHL if DB fails and stage exists there
    if (STAGE_MAP[stage]) {
      try {
        console.log("Falling back to GHL for stage:", stage);
        const leads = await getLeadsByStage(stage);
        return NextResponse.json({ leads, count: leads.length, source: "ghl_fallback", stage });
      } catch (ghlErr: unknown) {
        const ghlMessage = ghlErr instanceof Error ? ghlErr.message : "Unknown error";
        return NextResponse.json({ error: `DB failed: ${message}. GHL fallback failed: ${ghlMessage}` }, { status: 500 });
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
