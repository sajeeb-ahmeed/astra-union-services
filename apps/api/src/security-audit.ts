import type { DB } from "./db.js";
import { digest } from "./security.js";

export type SecurityAction =
  | "SIGNED_IN"
  | "PASSWORD_CHANGED"
  | "OTHER_SESSIONS_REVOKED"
  | "SESSION_REVOKED"
  | "PASSWORD_RECOVERY_COMPLETED"
  | "MFA_ENROLLMENT_STARTED"
  | "MFA_ENABLED"
  | "MFA_DISABLED"
  | "MFA_RECOVERY_CODES_ROTATED"
  | "MFA_CHALLENGE_CREATED"
  | "MFA_LOGIN_SUCCEEDED"
  | "MFA_RECOVERY_CODE_USED"
  | "MFA_CODE_REJECTED"
  | "SIGN_IN_IDENTIFIER_SET"
  | "SIGN_IN_IDENTIFIER_REMOVED";
export async function accountScope(db: DB, userId: string) {
  await db.query("SELECT set_config('astra.account_id',$1,true)", [userId]);
}
export async function securityAudit(
  db: DB,
  userId: string,
  action: SecurityAction,
  metadata: {
    revokedSessions?: number;
    remainingCodes?: number;
    sessionId?: string;
  } = {},
) {
  await accountScope(db, userId);
  await db.query(
    "INSERT INTO account_security_events(user_id,action,metadata) VALUES($1,$2,$3)",
    [userId, action, JSON.stringify(metadata)],
  );
}

/**
 * S-014: durable, append-only, owner-scoped audit stream
 * (platform_security_events, migration 073). Owner actions and
 * authentication failures previously existed only as stdout JSON lines.
 *
 * Privacy: the client IP is stored only as a SHA-256 hash, never raw —
 * enough to correlate repeated failures from one source during incident
 * response, never enough to recover the address from the table alone.
 * Passwords and tokens are never logged here; the caller passes only the
 * identifier kind (mobile vs email vs NID vs birth registration), never
 * the identifier value.
 */
export type PlatformSecurityAction =
  | "OWNER_PASSWORD_CHANGED"
  | "OWNER_SESSIONS_REVOKED"
  | "OWNER_SESSION_REVOKED"
  | "TENANT_CREATED"
  | "TENANT_STATUS_UPDATED"
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED_OUT"
  | "PUBLIC_DATA_PURGED";

export type IdentifierKind =
  | "email"
  | "mobile"
  | "nid"
  | "birth_reg"
  | "unknown";

export function hashClientIp(ip: string): string {
  return digest(ip);
}

type PlatformPoolLike = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export async function logPlatformSecurityEvent(
  pool: PlatformPoolLike,
  event: {
    actorId?: string | null;
    actorRole?: string | null;
    action: PlatformSecurityAction;
    identifierKind?: IdentifierKind;
    ip?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await pool.query(
    `INSERT INTO platform_security_events(actor_id,actor_role,action,identifier_kind,ip_hash,metadata)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      event.actorId ?? null,
      event.actorRole ?? null,
      event.action,
      event.identifierKind ?? null,
      event.ip ? hashClientIp(event.ip) : null,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}
export async function invalidateMfaChallenges(db: DB, userId: string) {
  await db.query(
    "UPDATE mfa_login_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL",
    [userId],
  );
}
