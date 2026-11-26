import type { Auth } from "./app.js";
import { pool, audit, setActingUser, type DB } from "./db.js";
import { fail } from "./models.js";
import { createRateLimiter } from "./http-hardening.js";
import {
  accountScope,
  invalidateMfaChallenges,
  securityAudit,
} from "./security-audit.js";

/** All credential writers and login hold this account lock before touching sessions. */
export async function lockAccount(db: DB, userId: string) {
  const user = (
    await db.query("SELECT * FROM platform_users WHERE id=$1 FOR UPDATE", [
      userId,
    ])
  ).rows[0];
  if (!user || !user.active)
    fail(401, "SESSION_INACTIVE", "This account is inactive.");
  return user;
}

export async function accountTransaction<T>(
  actor: Auth,
  fn: (db: DB, user: any) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // A-013: sessions rows are visible only to their own user (migration 082).
    await setActingUser(db, actor.userId);
    const user = await lockAccount(db, actor.userId);
    // Middleware may have run before another request revoked this session.
    const current = await db.query(
      `SELECT s.expires_at FROM sessions s WHERE s.user_id=$1 AND s.csrf_token=$2
       AND s.expires_at>clock_timestamp() AND (
         (s.tenant_id IS NULL AND $3::text='owner') OR EXISTS (
           SELECT 1 FROM staff_memberships m JOIN tenants t ON t.id=m.tenant_id
           WHERE m.user_id=s.user_id AND m.tenant_id=s.tenant_id AND m.active AND t.status='ACTIVE'
         ))`,
      [actor.userId, actor.csrfToken, user.platform_role],
    );
    if (!current.rowCount)
      fail(
        401,
        "SESSION_INACTIVE",
        "This session or tenant membership is inactive.",
      );
    const result = await fn(db, user);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function consumeAccountRecoveryLinks(db: DB, userId: string) {
  await accountScope(db, userId);
  await invalidateMfaChallenges(db, userId);
  await db.query(
    "UPDATE account_mfa SET pending_secret=NULL,pending_expires_at=NULL WHERE user_id=$1",
    [userId],
  );
  // Recovery tokens are per-account: one SECURITY DEFINER call
  // (migration 075, A-012) consumes every unconsumed token of this user
  // in a single statement, instead of one set_config + UPDATE per
  // membership. A later password change must invalidate links issued
  // under every membership, so the UPDATE has no tenant filter by design.
  await db.query("SELECT consume_password_recovery_tokens($1)", [userId]);
}

export async function accountAudit(
  db: DB,
  actor: Auth,
  action: "PASSWORD_CHANGED" | "OTHER_SESSIONS_REVOKED",
  revokedSessions: number,
) {
  await securityAudit(db, actor.userId, action, { revokedSessions });
  if (!actor.tenantId) return;
  await db.query("SELECT set_config('astra.tenant_id',$1,true)", [
    actor.tenantId,
  ]);
  await audit(db, actor.tenantId, actor.userId, action, actor.userId, {
    revokedSessions,
  });
}

/** Owner actions have no tenant audit destination; emit only after successful commit. */
export function logOwnerAccountAction(
  actor: Auth,
  action: string,
  revokedSessions: number,
) {
  if (!actor.tenantId)
    console.info(
      JSON.stringify({
        event: "ACCOUNT_SECURITY",
        action,
        actorId: actor.userId,
        revokedSessions,
      }),
    );
}

// Account key is taken exclusively from authenticated middleware, never request input.
export const accountActionLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60_000,
  key: (req) => (req as typeof req & { auth: Auth }).auth.userId,
});
