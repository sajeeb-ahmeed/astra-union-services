/**
 * S-003 / A-004: production guard for the seed script.
 *
 * `scripts/seed.ts` creates 13 accounts that all share the published
 * password `Demo-Phase1!` (the platform owner plus 6 roles x alpha/beta
 * tenants). Those accounts exist so the local test suites and a developer
 * workstation have something to sign in with. They must NEVER be created
 * on, or left enabled in, a production database: anyone who knows the
 * published password would own the platform-owner account.
 *
 * Rule (fail loudly, no silent default): seeding runs only when the
 * environment is EXPLICITLY non-production — every set value of
 * NODE_ENV / APP_ENV must be one of `test`, `development`, `dev` or
 * `local`. Anything else refuses, including:
 *   - NODE_ENV=production / APP_ENV=production (the live case), and
 *   - neither variable set at all (an unset environment is not proof of
 *     a safe target; the operator must name it).
 * There is deliberately no override flag: a production seed is never a
 * legitimate operation, so there is nothing to override into.
 *
 * If a seed account is ever found on a live database, do NOT re-run the
 * seed to "fix" it — follow docs/SEED_ACCOUNTS.md (detect, disable,
 * rotate, audit). That procedure is documentation only; no live access
 * exists from this repository.
 */
const NON_PRODUCTION = new Set(["test", "development", "dev", "local"]);

export function seedAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const values = [env.NODE_ENV, env.APP_ENV]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim() !== "",
    )
    .map((value) => value.trim().toLowerCase());
  // No explicit environment, no seed: an unset NODE_ENV proves nothing
  // about the database the connection string points at.
  if (values.length === 0) return false;
  return values.every((value) => NON_PRODUCTION.has(value));
}

export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (seedAllowed(env)) return;
  throw new Error(
    "SEED_REFUSED: refusing to seed demo accounts because the environment " +
      `is not explicitly non-production (NODE_ENV=${env.NODE_ENV ?? "(unset)"}, ` +
      `APP_ENV=${env.APP_ENV ?? "(unset)"}). The seed creates 13 accounts sharing ` +
      "the published password Demo-Phase1! and must only ever run in test or " +
      "development. Set NODE_ENV=test (or development) and point the database " +
      "at a local/test database. If seed accounts are already present on a live " +
      "database, follow docs/SEED_ACCOUNTS.md — never re-run the seed there.",
  );
}
