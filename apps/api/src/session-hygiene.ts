/**
 * S-005: session hygiene — idle timeout, absolute lifetime cap, per-session
 * revoke, and the `__Host-` cookie prefix.
 *
 * The auth middleware itself lives inline in app.ts (~line 917), which this
 * batch may not edit: the middleware change (idle check + touch + cookie
 * name) is supplied as an exact patch in the Stage 5 Batch B fragment
 * (qa-audit/remediation/fragments/stage5-batch-b-security.md) for the
 * parent to apply at merge. Everything testable without that patch lives
 * here: the policy constants, the pure idle/expiry math, the cookie
 * builders, and the database operations (touch, list, revoke-one).
 *
 * Policy (decided for this batch, see docs/SESSION_HYGIENE.md):
 * - Idle timeout 45 minutes (inside the 30–60 min range in the register).
 *   A session idle longer than that is refused with SESSION_IDLE and
 *   expired, so it cannot be revived by a later request.
 * - Absolute lifetime 8 h from creation (unchanged): activity slides
 *   expires_at forward, but never past created_at + 8 h.
 * - The touch is throttled: last_seen_at is rewritten only when it is
 *   older than 60 s, so ordinary navigation costs one cheap UPDATE per
 *   minute per session at most, not one per request.
 * - Per-session revoke refuses the caller's own current session with
 *   SESSION_CURRENT (409) — sign-out is the way to end the current
 *   session; revoking it mid-request would leave the response unauthenticated.
 * - `__Host-` prefix applies in production only: it requires Secure +
 *   Path=/ + no Domain, and local test/dev sign-in runs over plain HTTP,
 *   where a Secure cookie would never be sent back.
 */
export const SESSION_IDLE_TIMEOUT_MS = 45 * 60_000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 8 * 60 * 60_000;
export const SESSION_ABSOLUTE_LIFETIME_SECONDS = 8 * 60 * 60;
export const SESSION_TOUCH_STALE_MS = 60_000;

type PoolLike = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export function sessionCookieName(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production"
    ? "__Host-astra_session"
    : "astra_session";
}

/** The Set-Cookie value sendLogin issues (see the fragment for the patch). */
export function buildSessionCookie(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName(env)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_ABSOLUTE_LIFETIME_SECONDS}${secure}`;
}

/** The Set-Cookie value sign-out issues to clear the session cookie. */
export function clearSessionCookie(env: NodeJS.ProcessEnv = process.env) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName(env)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

export type SessionRow = {
  id: string;
  created_at: string | Date;
  last_seen_at: string | Date;
  expires_at: string | Date;
};

export function isSessionIdle(
  session: Pick<SessionRow, "last_seen_at">,
  now: Date = new Date(),
) {
  return (
    now.getTime() - new Date(session.last_seen_at).getTime() >
    SESSION_IDLE_TIMEOUT_MS
  );
}

/** The expires_at a touch would set: idle window from now, capped at the absolute lifetime. */
export function sessionExpiryAfterTouch(
  session: Pick<SessionRow, "created_at">,
  now: Date = new Date(),
) {
  const absoluteEnd =
    new Date(session.created_at).getTime() + SESSION_ABSOLUTE_LIFETIME_MS;
  return new Date(Math.min(now.getTime() + SESSION_IDLE_TIMEOUT_MS, absoluteEnd));
}

/**
 * Record activity on a session: last_seen_at = now, expires_at slid
 * forward but never past created_at + 8 h. The caller (auth middleware)
 * only calls this when last_seen_at is older than SESSION_TOUCH_STALE_MS.
 * Returns the number of sessions touched (0 when already expired).
 */
export async function touchSession(
  pool: PoolLike,
  tokenHash: string,
  now: Date = new Date(),
) {
  const result = await pool.query(
    `UPDATE sessions SET last_seen_at=$2,
       expires_at=LEAST($2::timestamptz + interval '45 minutes',
                        created_at + interval '8 hours')
     WHERE token_hash=$1 AND expires_at>$2`,
    [tokenHash, now.toISOString()],
  );
  return result.rowCount ?? 0;
}

/** Expire a session immediately (used when the middleware finds it idle). */
export async function expireSession(pool: PoolLike, tokenHash: string) {
  const result = await pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp() WHERE token_hash=$1 AND expires_at>clock_timestamp()",
    [tokenHash],
  );
  return result.rowCount ?? 0;
}

export type ListedSession = {
  id: string;
  current: boolean;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
};

/**
 * The caller's own active sessions, newest first. The filter mirrors GET
 * /auth/sessions: an owner session (tenant_id NULL) or a session whose
 * tenant membership is still active. The csrf_token is never returned —
 * the public id is the only identifier a client needs to revoke one.
 */
export async function listSessions(
  pool: PoolLike,
  userId: string,
  currentCsrfToken: string,
  platformRole: string,
): Promise<ListedSession[]> {
  const rows = (
    await pool.query(
      `SELECT s.id, s.csrf_token=$2 AS current, s.expires_at, s.last_seen_at, s.created_at
         FROM sessions s
        WHERE s.user_id=$1 AND s.expires_at>clock_timestamp() AND (
          (s.tenant_id IS NULL AND $3::text='owner') OR EXISTS (
            SELECT 1 FROM staff_memberships m JOIN tenants t ON t.id=m.tenant_id
            WHERE m.user_id=s.user_id AND m.tenant_id=s.tenant_id AND m.active AND t.status='ACTIVE'))
        ORDER BY s.created_at DESC, s.id`,
      [userId, currentCsrfToken, platformRole],
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    current: row.current,
    expiresAt: new Date(row.expires_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export type RevokeSessionResult =
  | { revoked: 1; reason: null }
  | { revoked: 0; reason: "NOT_FOUND" | "CURRENT" };

/**
 * Expire exactly one of the caller's sessions, identified by its public id.
 * The caller's own current session is refused (CURRENT) — sign-out ends
 * it. A session that is not the caller's, or already expired, is NOT_FOUND.
 */
export async function revokeSession(
  pool: PoolLike,
  userId: string,
  sessionId: string,
  currentCsrfToken: string,
): Promise<RevokeSessionResult> {
  const row = (
    await pool.query(
      "SELECT csrf_token FROM sessions WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp()",
      [sessionId, userId],
    )
  ).rows[0];
  if (!row) return { revoked: 0, reason: "NOT_FOUND" };
  if (row.csrf_token === currentCsrfToken)
    return { revoked: 0, reason: "CURRENT" };
  await pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp() WHERE id=$1 AND user_id=$2",
    [sessionId, userId],
  );
  return { revoked: 1, reason: null };
}
