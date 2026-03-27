// ============================================================
// Persistent Session Store — Neon Postgres backed
// ============================================================
//
// Replaces the in-memory Map<string, DialerSession> with
// database-backed storage so sessions survive serverless
// cold starts and function recycling on Vercel.
//
// Usage: import { getSession, saveSession, deleteSession } from "@/lib/session-store";

import { query } from "./db";
import type { DialerSession } from "./types";

/**
 * Get a session by ID from the database.
 * Returns null if not found.
 */
export async function getSession(sessionId: string): Promise<DialerSession | null> {
  const result = await query(
    "SELECT data FROM dialer_sessions WHERE id = $1",
    [sessionId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].data as DialerSession;
}

/**
 * Save (upsert) a session to the database.
 * Call this after every mutation to session state.
 */
export async function saveSession(session: DialerSession): Promise<void> {
  await query(
    `INSERT INTO dialer_sessions (id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
    [session.id, JSON.stringify(session)]
  );
}

/**
 * Delete a session from the database.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await query("DELETE FROM dialer_sessions WHERE id = $1", [sessionId]);
}

/**
 * Find a session by rep ID (for reconnecting after page refresh).
 * Returns the most recent active session for the rep.
 */
export async function getActiveSessionForRep(repId: string): Promise<DialerSession | null> {
  const result = await query(
    `SELECT data FROM dialer_sessions
     WHERE data->>'repId' = $1
       AND data->>'status' != 'ended'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [repId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].data as DialerSession;
}

/**
 * Clean up old sessions (older than 24 hours).
 * Call periodically or on session start.
 */
export async function cleanupOldSessions(): Promise<number> {
  const result = await query(
    "DELETE FROM dialer_sessions WHERE updated_at < NOW() - INTERVAL '24 hours'"
  );
  return result.rowCount || 0;
}
