// GET /api/salesforce/health — Quick check if SF connection is working
// Returns token status, OAuth config status, and attempts a simple API call

import { NextRequest, NextResponse } from "next/server";
import { getValidToken, handleTokenExpiry, isOAuthConfigured } from "@/lib/sf-auth";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const token = await getValidToken();

  if (!token) {
    return NextResponse.json({
      status: "disconnected",
      oauthConfigured: isOAuthConfigured(),
      message: "No Salesforce credentials found. Visit /api/salesforce/oauth/authorize to connect.",
    });
  }

  // Try a lightweight API call to verify the token works
  try {
    const res = await fetch(`${token.instanceUrl}/services/data/v59.0/limits`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    if (res.ok) {
      return NextResponse.json({
        status: "connected",
        instanceUrl: token.instanceUrl,
        oauthConfigured: isOAuthConfigured(),
        message: "Salesforce connection is healthy",
      });
    }

    if (res.status === 401) {
      // Try refresh
      const refreshed = await handleTokenExpiry();
      if (refreshed) {
        return NextResponse.json({
          status: "connected",
          instanceUrl: refreshed.instanceUrl,
          oauthConfigured: isOAuthConfigured(),
          message: "Token was expired but auto-refreshed successfully",
        });
      }
      return NextResponse.json({
        status: "expired",
        oauthConfigured: isOAuthConfigured(),
        message: isOAuthConfigured()
          ? "Token expired and refresh failed. Re-authorize at /api/salesforce/oauth/authorize"
          : "Token expired. Set SF_CLIENT_ID + SF_CLIENT_SECRET for auto-refresh, or update SF_ACCESS_TOKEN.",
      });
    }

    return NextResponse.json({
      status: "error",
      httpStatus: res.status,
      message: `SF API returned ${res.status}`,
    });
  } catch (err) {
    return NextResponse.json({
      status: "error",
      message: err instanceof Error ? err.message : "Connection failed",
    });
  }
}
