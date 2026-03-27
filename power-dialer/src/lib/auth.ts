// ============================================================
// Simple API Key Auth — protects dashboard endpoints
// ============================================================
// Claude (and any client) authenticates with:
//   Header: X-Dialer-Key: <DIALER_API_KEY>
// or query param: ?key=<DIALER_API_KEY>
//
// Twilio webhooks are excluded (they use Twilio's own signature validation).

import { NextRequest, NextResponse } from "next/server";

export function requireAuth(req: NextRequest): NextResponse | null {
  const apiKey = process.env.DIALER_API_KEY;

  // If no key is configured, allow all requests (dev mode)
  if (!apiKey) return null;

  const headerKey = req.headers.get("x-dialer-key");
  const queryKey = req.nextUrl.searchParams.get("key");

  if (headerKey === apiKey || queryKey === apiKey) {
    return null; // Authenticated
  }

  return NextResponse.json(
    { error: "Unauthorized. Provide X-Dialer-Key header or ?key= param." },
    { status: 401 }
  );
}
