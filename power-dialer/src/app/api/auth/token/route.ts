// POST /api/auth/token — Generate an auto-login token for a rep
// Called by Claude after starting a dialer session. Returns a URL
// the rep can open (or Claude opens via browser) to jump straight
// into the dashboard with no login screen.
//
// Required headers: X-Dialer-Key (standard API auth)
// Body: { email, phone, sessionId? }

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { REP_DIRECTORY } from "@/lib/types";
import { createToken } from "@/lib/token";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { email, phone, sessionId } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const rep = REP_DIRECTORY.find(
    (r) => r.email.toLowerCase() === email.toLowerCase()
  );

  if (!rep) {
    return NextResponse.json({ error: "Rep not found" }, { status: 404 });
  }

  // Normalize phone
  let normalizedPhone = (phone || "").replace(/\D/g, "");
  if (normalizedPhone.length === 10) normalizedPhone = "1" + normalizedPhone;
  if (normalizedPhone && !normalizedPhone.startsWith("+")) normalizedPhone = "+" + normalizedPhone;

  const token = createToken({
    repId: rep.id,
    repName: rep.name,
    repEmail: rep.email,
    repPhone: normalizedPhone || rep.phone,
    repRole: rep.role,
    sessionId: sessionId || undefined,
  });

  // Build the full auto-login URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.DASHBOARD_URL || "";
  const params = new URLSearchParams({ token });
  if (sessionId) params.set("sessionId", sessionId);
  const loginUrl = baseUrl ? `${baseUrl}?${params}` : `?${params}`;

  return NextResponse.json({
    token,
    url: loginUrl,
    expiresIn: "8 hours",
    rep: {
      id: rep.id,
      name: rep.name,
      email: rep.email,
    },
  });
}
