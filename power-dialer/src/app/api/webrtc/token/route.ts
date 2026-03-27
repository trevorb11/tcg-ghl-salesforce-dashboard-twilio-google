// POST /api/webrtc/token — Generate a SignalWire Relay JWT for browser calling
// The browser uses this token to connect via WebRTC and receive calls.

import { NextRequest, NextResponse } from "next/server";
import { generateWebRTCToken } from "@/lib/carrier";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { repId } = await req.json();

  if (!repId) {
    return NextResponse.json({ error: "repId is required" }, { status: 400 });
  }

  try {
    const { token, resource, project } = await generateWebRTCToken(repId);
    return NextResponse.json({ token, resource, project });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate token";
    console.error("WebRTC token error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
