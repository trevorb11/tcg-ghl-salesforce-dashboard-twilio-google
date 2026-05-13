// GET /api/salesforce/oauth/callback?code=xxx
// Salesforce redirects here after the admin approves the Connected App.
// Exchanges the authorization code for access + refresh tokens and stores them.

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, isOAuthConfigured } from "@/lib/sf-auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const errorDescription = req.nextUrl.searchParams.get("error_description");

  if (error) {
    return NextResponse.json({
      error: `Salesforce denied access: ${error}`,
      description: errorDescription,
    }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "No authorization code received" }, { status: 400 });
  }

  if (!isOAuthConfigured()) {
    return NextResponse.json({ error: "SF_CLIENT_ID and SF_CLIENT_SECRET not set" }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://power-dialer-ten.vercel.app";
  const callbackUrl = `${appUrl}/api/salesforce/oauth/callback`;

  try {
    await exchangeCodeForTokens(code, callbackUrl);

    // Return a simple success page
    return new NextResponse(
      `<!DOCTYPE html>
      <html><head><title>SF Connected</title></head>
      <body style="background:#0f172a;color:#e2e8f0;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">✅</div>
          <h1 style="margin:0 0 8px">Salesforce Connected</h1>
          <p style="color:#94a3b8;margin:0">OAuth tokens saved. The dialer will now auto-refresh when tokens expire.</p>
          <p style="color:#64748b;margin-top:16px;font-size:14px">You can close this tab.</p>
        </div>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
