# Session Hygiene (S-005)

- **Date:** 2026-11-26 (Phase 4 Stage 5 Batch B)
- **Code:** `apps/api/src/session-hygiene.ts` (policy + helpers),
  `apps/api/src/management.ts` (list / revoke endpoints),
  `db/migrations/078_session_hygiene.sql` (columns + audit action).

## Policy (decided for this batch)

| Rule | Value | Notes |
|---|---|---|
| Absolute lifetime | 8 h from creation | Unchanged. `sessions.created_at + 8 h` is the hard cap. |
| Idle timeout | 45 min | Inside the 30–60 min range in the register. A session idle longer than this is refused with `SESSION_IDLE` and expired, so it cannot be revived by a later request. |
| Touch throttle | 60 s | `last_seen_at` is rewritten only when older than 60 s, so ordinary navigation costs at most one cheap UPDATE per minute per session. |
| Per-session revoke | by public `id` | The id is a random UUID (`sessions.id`), never derived from the token hash. The current session cannot be revoked this way (`409 SESSION_CURRENT`) — sign-out ends it. |
| Cookie prefix | `__Host-astra_session` in production only | `__Host-` requires `Secure` + `Path=/` + no `Domain`. Local test/dev sign-in runs over plain HTTP, where a `Secure` cookie would never be sent back, so non-production keeps `astra_session`. |

## How it works

- `sessions` gained three columns (migration 072): `id` (public
  identifier), `created_at` (absolute-lifetime anchor), `last_seen_at`
  (idle anchor). Existing rows backfilled both timestamps to `now()`.
- On each authenticated request the auth middleware (see the merge patch
  below) checks `now - last_seen_at > 45 min` → `401 SESSION_IDLE` and
  expires the session; otherwise, when `last_seen_at` is older than 60 s,
  it touches the session: `last_seen_at = now`,
  `expires_at = LEAST(now + 45 min, created_at + 8 h)`. Activity slides
  expiry forward but never past the absolute cap.
- `GET /auth/sessions/list` returns the caller's active sessions with
  their public ids (`{sessions: [{id, current, expiresAt, lastSeenAt,
  createdAt}]}`). The aggregate summary on `GET /auth/sessions` is
  unchanged (its exact key set is pinned by a test).
- `POST /auth/sessions/revoke` (`{sessionId, currentPassword}`) revokes
  exactly one session. Same password re-authentication and
  `accountActionLimiter` as revoke-others. Responses: `200 {revoked: 1,
  remainingSessions}`, `404 SESSION_NOT_FOUND`, `409 SESSION_CURRENT`,
  `422 PASSWORD_MISMATCH`. Writes a `SESSION_REVOKED` row to the
  immutable account audit stream (and the tenant audit for office
  accounts; owner actions also write the durable platform stream, S-014).

## Merge patch (app.ts — NOT applied in this worktree)

The auth middleware and the cookie setter live in files this batch may
not edit (`app.ts`, `mfa.ts` `sendLogin`). The exact patch is in the
Stage 5 Batch B fragment
(`qa-audit/remediation/fragments/stage5-batch-b-security.md`, §S-005).
Until it is applied at merge:

- the idle timeout is **not enforced** by the running server (helpers +
  tests exist; the middleware call does not);
- the session cookie keeps the plain `astra_session` name in all
  environments (the `__Host-` prefix is not live).

Do not mark S-005 complete until the patch is applied and the
idle/cookie behaviour is verified against the running server.
