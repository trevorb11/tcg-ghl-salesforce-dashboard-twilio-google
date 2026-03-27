// POST /api/auth/verify-token — Verify an auto-login token
// Called by the frontend when page loads with ?token= param.
// Returns the same shape as /api/auth (rep info + dialerKey)
// so the frontend can skip the login screen.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";

export async function POST(req: NextRequest) {
  const { token } = await req.json();

  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  return NextResponse.json({
    id: payload.repId,
    name: payload.repName,
    email: payload.repEmail,
    phone: payload.repPhone,
    role: payload.repRole,
    sessionId: payload.sessionId || null,
    dialerKey: process.env.DIALER_API_KEY || "",
  });
}
