// ============================================================
// Lightweight HMAC token for auto-login URLs
// ============================================================
// No external dependencies — uses Node's built-in crypto.
// Token format: base64url(payload).base64url(HMAC-SHA256)
//
// Claude generates a token via POST /api/auth/token, then opens:
//   https://dashboard.url/?token=TOKEN
// The dashboard verifies the token and skips the login screen.

import crypto from "crypto";

const SECRET = () => process.env.DIALER_API_KEY || "dev-secret";
const DEFAULT_TTL = 8 * 60 * 60; // 8 hours (covers a full shift)

interface TokenPayload {
  repId: string;
  repName: string;
  repEmail: string;
  repPhone: string;
  repRole: "rep" | "admin";
  sessionId?: string;
  exp: number;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function sign(payload: string): string {
  const hmac = crypto.createHmac("sha256", SECRET());
  hmac.update(payload);
  return hmac.digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createToken(opts: {
  repId: string;
  repName: string;
  repEmail: string;
  repPhone: string;
  repRole: "rep" | "admin";
  sessionId?: string;
  ttlSeconds?: number;
}): string {
  const payload: TokenPayload = {
    repId: opts.repId,
    repName: opts.repName,
    repEmail: opts.repEmail,
    repPhone: opts.repPhone,
    repRole: opts.repRole,
    sessionId: opts.sessionId,
    exp: Math.floor(Date.now() / 1000) + (opts.ttlSeconds || DEFAULT_TTL),
  };

  const payloadStr = base64urlEncode(JSON.stringify(payload));
  const signature = sign(payloadStr);
  return `${payloadStr}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadStr, sig] = parts;

  // Verify signature
  const expectedSig = sign(payloadStr);
  if (sig !== expectedSig) return null;

  // Decode payload
  try {
    const payload: TokenPayload = JSON.parse(base64urlDecode(payloadStr));

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
