-- Batch D / S-004, A-003: shared rate-limit buckets (DB-backed).
--
-- All rate limiters were process-local in-memory Maps. In a multi-process
-- deployment (two Node workers, a restart, or the cPanel app plus a
-- worker) each process kept its own budget, so an attacker could multiply
-- the login / public-verify budget by the number of processes. This table
-- is the shared state: one row per budget key, with a windowed counter
-- incremented atomically (INSERT ... ON CONFLICT ... DO UPDATE, single
-- statement — no read-then-write race between processes).
--
-- Deliberately NOT Redis: the deployment already runs PostgreSQL and has
-- no Redis dependency; adding one would be new infrastructure for a
-- counter. The in-memory limiter (apps/api/src/http-hardening.ts) stays
-- as the per-process fallback when the shared check cannot run (database
-- unreachable): the shared limiter falls back to it rather than failing
-- open. See apps/api/src/shared-rate-limit.ts.
--
-- No RLS: these buckets are platform-internal counters, not tenant data,
-- and the runtime role must read/write them without any tenant scope set.
-- Keys are namespaced by purpose (login:ip:, login:id:, public:,
-- lookup:) so budgets never collide across uses.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_buckets TO astra_app;
