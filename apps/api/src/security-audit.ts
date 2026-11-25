import type { DB } from "./db.js";

export type SecurityAction =
  | "SIGNED_IN"
  | "PASSWORD_CHANGED"
  | "OTHER_SESSIONS_REVOKED"
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
  metadata: { revokedSessions?: number; remainingCodes?: number } = {},
) {
  await accountScope(db, userId);
  await db.query(
    "INSERT INTO account_security_events(user_id,action,metadata) VALUES($1,$2,$3)",
    [userId, action, JSON.stringify(metadata)],
  );
}
export async function invalidateMfaChallenges(db: DB, userId: string) {
  await db.query(
    "UPDATE mfa_login_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL",
    [userId],
  );
}
