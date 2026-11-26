/**
 * S-004 / A-003: shared, database-backed rate limiting.
 *
 * The process-local limiter in http-hardening.ts (`createRateLimiter`)
 * keeps one budget per Node process. In a multi-process deployment the
 * budget multiplies by the process count, so a login / public-verify
 * budget of 60/min is really 60/min *per process*. This module is the
 * shared replacement: budgets live in `rate_limit_buckets` (migration
 * 061) and are incremented atomically in a single statement, so any
 * number of server processes share exactly one budget.
 *
 * Why PostgreSQL and not Redis: the deployment already runs PostgreSQL
 * and has no Redis dependency; a counter does not justify new
 * infrastructure. The in-memory limiter stays as the per-process
 * fallback ONLY when the shared check cannot run (the database query
 * throws): the shared limiter then enforces the same budget from a
 * local Map and logs a warning, instead of failing open.
 *
 * Activation: shared limits are ON in production and OFF elsewhere
 * unless `SHARED_RATE_LIMITS=on` is set explicitly. The test suite
 * shares one seeded database across ~60 test files in separate
 * processes and signs in hundreds of times from 127.0.0.1; a shared
 * per-IP login budget would 429 legitimate test logins across files
 * (each file today gets a fresh in-memory budget). The shared path is
 * verified directly against the database by
 * apps/api/test/shared-rate-limit.test.ts (two limiter instances sharing
 * one budget, plus a cross-instance middleware test), and the
 * production default is enforced by `enforceRuntimeConfig`'s
 * production-only checks elsewhere — do not "simplify" this to
 * always-on without solving the shared-test-DB interference first.
 */
import type { Request, Response, NextFunction } from "express";

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
};

export function sharedRateLimitsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "production" || env.SHARED_RATE_LIMITS === "on";
}

type PoolLike = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
};

/**
 * One atomic increment-or-reset. `windowStart` is the start of the
 * current window (computed by the caller from its clock); a stored row
 * from an older window resets to 1 instead of incrementing. A single
 * statement, so concurrent processes cannot both read-then-write the
 * same count.
 */
const INCREMENT_SQL = `
  INSERT INTO rate_limit_buckets(key, window_start, count, updated_at)
  VALUES ($1, $2, 1, now())
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN rate_limit_buckets.window_start < $2 THEN $2 ELSE rate_limit_buckets.window_start END,
    count = CASE WHEN rate_limit_buckets.window_start < $2 THEN 1 ELSE rate_limit_buckets.count + 1 END,
    updated_at = now()
  RETURNING count, window_start
`;

export type SharedRateLimiterOptions = {
  pool: PoolLike;
  limit: number;
  windowMs: number;
  keyPrefix?: string;
  /**
   * When false the limiter enforces the same budget from a per-process
   * Map and never touches the database (the non-production default —
   * see sharedRateLimitsEnabled). The caller keeps one code path; only
   * the backing store changes.
   */
  shared?: boolean;
  /** Test seam: replaces Date.now for window computation. */
  clock?: () => number;
  /** Test seam: replaces console.warn for fallback logging. */
  onFallback?: (error: unknown) => void;
};

export type SharedRateLimiter = {
  /** Atomically consume one unit of `key`'s budget. */
  consume: (key: string) => Promise<RateLimitResult>;
  /** Current count in the live window, without consuming (0 if none/expired). */
  peek: (key: string) => Promise<number>;
  /** Clear `key`'s budget (successful login / successful lookup). */
  reset: (key: string) => Promise<void>;
  /** Express middleware enforcing this budget per client IP. */
  middleware: () => (req: Request, res: Response, next: NextFunction) => void;
  /** Whether the last consume fell back to the in-memory limiter. */
  fallbackUsed: () => boolean;
};

export function createSharedRateLimiter(
  options: SharedRateLimiterOptions,
): SharedRateLimiter {
  const clock = options.clock ?? Date.now;
  const prefix = options.keyPrefix ?? "";
  const shared = options.shared ?? true;
  // Per-process fallback, used ONLY when the shared check cannot run.
  const fallbackBuckets = new Map<string, { count: number; until: number }>();
  let fallbackWarned = false;
  let fallbackUsedFlag = false;
  const noteFallback = (error: unknown) => {
    fallbackUsedFlag = true;
    if (!fallbackWarned) {
      fallbackWarned = true;
      if (options.onFallback) options.onFallback(error);
      else
        console.warn(
          "[rate-limit] shared (DB) check failed, using per-process in-memory fallback:",
          error instanceof Error ? error.message : error,
        );
    }
  };
  const windowStart = (now: number) =>
    new Date(Math.floor(now / options.windowMs) * options.windowMs);
  const fullKey = (key: string) => `${prefix}${key}`;

  // In-memory consume with the same window semantics, for fallback only.
  function fallbackConsume(key: string, now: number): RateLimitResult {
    const k = fullKey(key);
    let bucket = fallbackBuckets.get(k);
    if (!bucket || bucket.until <= now) {
      bucket = { count: 0, until: now + options.windowMs };
      fallbackBuckets.set(k, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= options.limit,
      count: bucket.count,
      retryAfterMs: Math.max(0, bucket.until - now),
    };
  }

  async function consume(key: string): Promise<RateLimitResult> {
    const now = clock();
    const start = windowStart(now);
    if (!shared) return fallbackConsume(key, now);
    try {
      const rows = (
        await options.pool.query(INCREMENT_SQL, [fullKey(key), start])
      ).rows;
      const count = rows[0]?.count ?? 1;
      return {
        allowed: count <= options.limit,
        count,
        retryAfterMs:
          count <= options.limit
            ? 0
            : Math.max(0, start.getTime() + options.windowMs - now),
      };
    } catch (error) {
      noteFallback(error);
      return fallbackConsume(key, now);
    }
  }

  async function peek(key: string): Promise<number> {
    const now = clock();
    const start = windowStart(now);
    if (!shared) {
      const bucket = fallbackBuckets.get(fullKey(key));
      return bucket && bucket.until > now ? bucket.count : 0;
    }
    try {
      const rows = (
        await options.pool.query(
          "SELECT count FROM rate_limit_buckets WHERE key=$1 AND window_start >= $2",
          [fullKey(key), start],
        )
      ).rows;
      return rows[0]?.count ?? 0;
    } catch (error) {
      noteFallback(error);
      const bucket = fallbackBuckets.get(fullKey(key));
      return bucket && bucket.until > now ? bucket.count : 0;
    }
  }

  async function reset(key: string): Promise<void> {
    if (shared) {
      try {
        await options.pool.query(
          "DELETE FROM rate_limit_buckets WHERE key=$1",
          [fullKey(key)],
        );
      } catch (error) {
        noteFallback(error);
      }
    }
    fallbackBuckets.delete(fullKey(key));
  }

  function middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // consume() falls back to the in-memory budget when the DB check
      // fails, so a down database never means "no limit at all". The
      // .catch is only a backstop against a limiter bug wedging the
      // route — the in-memory limiter in httpHardening has already run
      // for these paths by the time this middleware sees the request.
      void consume(req.ip ?? req.socket.remoteAddress ?? "unknown")
        .then((result) => {
          if (result.allowed) {
            next();
            return;
          }
          res.setHeader(
            "Retry-After",
            Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
          );
          res.status(429).json({
            error: {
              code: "RATE_LIMIT",
              message: "Too many requests. Please retry shortly.",
            },
          });
        })
        .catch(() => next());
    };
  }

  return {
    consume,
    peek,
    reset,
    middleware,
    fallbackUsed: () => fallbackUsedFlag,
  };
}

/**
 * A budget that is consumed only on failure and cleared on success —
 * the shape login-per-identifier (S-004) and public-lookup-per-number
 * (S-006) need. When shared limits are off, the same behaviour runs
 * from a per-process Map so existing tests keep their current budgets.
 */
export type FailureBudget = {
  /** True when the key already exhausted its failure budget. */
  blocked: (key: string) => Promise<boolean>;
  /** Record one failure against the key. */
  recordFailure: (key: string) => Promise<RateLimitResult>;
  /** Clear the key's failures (success). */
  clear: (key: string) => Promise<void>;
};

export function createFailureBudget(options: {
  pool: PoolLike;
  limit: number;
  windowMs: number;
  keyPrefix: string;
  shared: boolean;
  clock?: () => number;
}): FailureBudget {
  if (!options.shared) {
    const buckets = new Map<string, { count: number; until: number }>();
    const now = () => options.clock?.() ?? Date.now();
    return {
      async blocked(key) {
        const b = buckets.get(key);
        return Boolean(b && b.until > now() && b.count >= options.limit);
      },
      async recordFailure(key) {
        const at = now();
        let b = buckets.get(key);
        if (!b || b.until <= at) {
          b = { count: 0, until: at + options.windowMs };
          buckets.set(key, b);
        }
        b.count += 1;
        return {
          allowed: b.count <= options.limit,
          count: b.count,
          retryAfterMs: Math.max(0, b.until - at),
        };
      },
      async clear(key) {
        buckets.delete(key);
      },
    };
  }
  const limiter = createSharedRateLimiter({
    pool: options.pool,
    limit: options.limit,
    windowMs: options.windowMs,
    keyPrefix: options.keyPrefix,
    clock: options.clock,
  });
  return {
    blocked: async (key) => (await limiter.peek(key)) >= options.limit,
    recordFailure: (key) => limiter.consume(key),
    clear: (key) => limiter.reset(key),
  };
}
