// ============================================================
// Salesforce OAuth 2.0 Token Management
// ============================================================
//
// Manages the SF access token lifecycle:
// 1. Stores access_token + refresh_token in the database
// 2. On every API call, checks if the token is still valid
// 3. On 401 (expired), uses the refresh_token to get a new access_token
// 4. Falls back to static SF_ACCESS_TOKEN env var if no OAuth tokens exist
//
// Setup flow:
//   1. Create a Connected App in Salesforce (Setup → App Manager → New Connected App)
//      - Enable OAuth, add "Full access" or "api refresh_token" scopes
//      - Set callback URL to https://power-dialer-ten.vercel.app/api/salesforce/oauth/callback
//   2. Set env vars: SF_CLIENT_ID, SF_CLIENT_SECRET, SF_INSTANCE_URL
//   3. Visit https://power-dialer-ten.vercel.app/api/salesforce/oauth/authorize to start the flow
//   4. After callback, tokens are stored in the database and auto-refresh forever

import { query } from "./db";

const SF_CLIENT_ID = process.env.SF_CLIENT_ID || "";
const SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET || "";
const SF_INSTANCE_URL = process.env.SF_INSTANCE_URL || "";
// Fallback: static token from env (legacy, expires)
const SF_STATIC_TOKEN = process.env.SF_ACCESS_TOKEN || "";

interface TokenRecord {
  access_token: string;
  refresh_token: string;
  instance_url: string;
  issued_at: string;
}

// In-memory cache so we don't hit the DB on every API call
let _cachedToken: TokenRecord | null = null;
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000; // Re-check DB every 60s

/**
 * Ensure the sf_oauth_tokens table exists
 */
async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS sf_oauth_tokens (
      id TEXT PRIMARY KEY DEFAULT 'default',
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      instance_url TEXT NOT NULL,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Get the current token record from DB (with in-memory cache)
 */
async function getTokenRecord(): Promise<TokenRecord | null> {
  if (_cachedToken && Date.now() - _cacheLoadedAt < CACHE_TTL_MS) {
    return _cachedToken;
  }

  try {
    const result = await query(
      "SELECT access_token, refresh_token, instance_url, issued_at::text FROM sf_oauth_tokens WHERE id = 'default'"
    );
    if (result.rows.length > 0) {
      _cachedToken = result.rows[0] as TokenRecord;
      _cacheLoadedAt = Date.now();
      return _cachedToken;
    }
  } catch {
    // Table may not exist yet
    await ensureTable();
  }

  return null;
}

/**
 * Save tokens to the database (upsert)
 */
export async function saveTokens(accessToken: string, refreshToken: string, instanceUrl: string): Promise<void> {
  await ensureTable();
  await query(
    `INSERT INTO sf_oauth_tokens (id, access_token, refresh_token, instance_url, issued_at, updated_at)
     VALUES ('default', $1, $2, $3, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       access_token = $1,
       refresh_token = $2,
       instance_url = $3,
       updated_at = NOW()`,
    [accessToken, refreshToken, instanceUrl]
  );
  // Update cache immediately
  _cachedToken = { access_token: accessToken, refresh_token: refreshToken, instance_url: instanceUrl, issued_at: new Date().toISOString() };
  _cacheLoadedAt = Date.now();
}

/**
 * Use the refresh token to get a new access token from Salesforce
 */
async function refreshAccessToken(refreshToken: string, instanceUrl: string): Promise<{ access_token: string; instance_url: string }> {
  // Salesforce token endpoint — use login.salesforce.com for production, test.salesforce.com for sandbox
  const isSandbox = instanceUrl.includes("sandbox") || instanceUrl.includes("--dev") || instanceUrl.includes("test.salesforce");
  const tokenUrl = isSandbox
    ? "https://test.salesforce.com/services/oauth2/token"
    : "https://login.salesforce.com/services/oauth2/token";

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SF token refresh failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    instance_url: data.instance_url || instanceUrl,
  };
}

/**
 * Get a valid access token + instance URL.
 * Tries OAuth tokens first, falls back to static env var.
 * Returns null if nothing is configured.
 */
export async function getValidToken(): Promise<{ accessToken: string; instanceUrl: string } | null> {
  // Try OAuth tokens from DB first
  const record = await getTokenRecord();
  if (record) {
    return {
      accessToken: record.access_token,
      instanceUrl: record.instance_url || SF_INSTANCE_URL,
    };
  }

  // Fallback to static env var (legacy)
  if (SF_STATIC_TOKEN && SF_INSTANCE_URL) {
    return {
      accessToken: SF_STATIC_TOKEN,
      instanceUrl: SF_INSTANCE_URL,
    };
  }

  return null;
}

/**
 * Handle a 401 by refreshing the token and retrying.
 * Returns the new token or null if refresh fails.
 */
export async function handleTokenExpiry(): Promise<{ accessToken: string; instanceUrl: string } | null> {
  const record = await getTokenRecord();
  if (!record?.refresh_token) {
    console.error("[SF Auth] No refresh token available — cannot auto-refresh. Re-authorize at /api/salesforce/oauth/authorize");
    return null;
  }

  if (!SF_CLIENT_ID || !SF_CLIENT_SECRET) {
    console.error("[SF Auth] SF_CLIENT_ID / SF_CLIENT_SECRET not set — cannot refresh token");
    return null;
  }

  try {
    console.log("[SF Auth] Access token expired, refreshing...");
    const newTokens = await refreshAccessToken(record.refresh_token, record.instance_url);
    await saveTokens(newTokens.access_token, record.refresh_token, newTokens.instance_url);
    console.log("[SF Auth] Token refreshed successfully");
    return {
      accessToken: newTokens.access_token,
      instanceUrl: newTokens.instance_url,
    };
  } catch (err) {
    console.error("[SF Auth] Token refresh failed:", err);
    // Invalidate cache so next call retries from DB
    _cachedToken = null;
    _cacheLoadedAt = 0;
    return null;
  }
}

/**
 * Build the Salesforce OAuth authorization URL
 */
export function getAuthorizationUrl(callbackUrl: string): string | null {
  if (!SF_CLIENT_ID) return null;

  const isSandbox = SF_INSTANCE_URL.includes("sandbox") || SF_INSTANCE_URL.includes("--dev") || SF_INSTANCE_URL.includes("test.salesforce");
  const baseUrl = isSandbox
    ? "https://test.salesforce.com"
    : "https://login.salesforce.com";

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SF_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: "api refresh_token",
    prompt: "consent", // Always show consent to ensure refresh_token is returned
  });

  return `${baseUrl}/services/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens
 */
export async function exchangeCodeForTokens(code: string, callbackUrl: string): Promise<void> {
  const isSandbox = SF_INSTANCE_URL.includes("sandbox") || SF_INSTANCE_URL.includes("--dev") || SF_INSTANCE_URL.includes("test.salesforce");
  const tokenUrl = isSandbox
    ? "https://test.salesforce.com/services/oauth2/token"
    : "https://login.salesforce.com/services/oauth2/token";

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
    redirect_uri: callbackUrl,
    code,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SF token exchange failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  await saveTokens(data.access_token, data.refresh_token, data.instance_url);
}

/**
 * Check if OAuth is properly configured
 */
export function isOAuthConfigured(): boolean {
  return !!(SF_CLIENT_ID && SF_CLIENT_SECRET);
}
