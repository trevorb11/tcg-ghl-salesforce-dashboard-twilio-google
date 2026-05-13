// GET /api/salesforce/oauth/authorize
// Redirects the admin to Salesforce's OAuth consent screen.
// After approval, Salesforce redirects back to /api/salesforce/oauth/callback
// with an authorization code that we exchange for tokens.

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizationUrl, isOAuthConfigured } from "@/lib/sf-auth";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  if (!isOAuthConfigured()) {
    return NextResponse.json({
      error: "SF_CLIENT_ID and SF_CLIENT_SECRET must be set in Vercel env vars",
      setup: [
        "1. In Salesforce: Setup → App Manager → New Connected App",
        "2. Enable OAuth Settings",
        "3. Add scopes: 'Full access (full)' or 'api' + 'refresh_token'",
        "4. Set callback URL to: https://power-dialer-ten.vercel.app/api/salesforce/oauth/callback",
        "5. Save and copy the Consumer Key (client_id) and Consumer Secret (client_secret)",
        "6. In Vercel: add SF_CLIENT_ID and SF_CLIENT_SECRET env vars",
        "7. Visit this endpoint again to start the OAuth flow",
      ],
    }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://power-dialer-ten.vercel.app";
  const callbackUrl = `${appUrl}/api/salesforce/oauth/callback`;
  const authUrl = getAuthorizationUrl(callbackUrl);

  if (!authUrl) {
    return NextResponse.json({ error: "Failed to build authorization URL" }, { status: 500 });
  }

  return NextResponse.redirect(authUrl);
}
