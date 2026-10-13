import type { Request, Response, NextFunction, Express } from "express";
import { isIP } from "node:net";

function trustedProxyAddresses(env: NodeJS.ProcessEnv): string[] {
  if (env.TRUST_PROXY && env.TRUST_PROXY !== "loopback")
    throw Error(
      "TRUST_PROXY only accepts loopback. Use TRUST_PROXY_IP for one exact trusted proxy address.",
    );
  const exact = env.TRUST_PROXY_IP;
  if (exact) {
    const family = isIP(exact);
    if (!family || exact.includes("%"))
      throw Error(
        "TRUST_PROXY_IP must be one literal IPv4 or IPv6 address; hostnames, lists and CIDR ranges are not allowed.",
      );
    const normalized =
      family === 6 ? new URL(`http://[${exact}]/`).hostname : exact;
    if (["0.0.0.0", "[::]", "[::ffff:0:0]"].includes(normalized))
      throw Error("TRUST_PROXY_IP cannot be an unspecified address.");
  }
  return [
    ...(env.TRUST_PROXY === "loopback" ? ["loopback"] : []),
    ...(exact ? [exact] : []),
  ];
}

/** Express compiles each validated literal as a host address, including IPv4-mapped peers. */
export function configureProxyTrust(
  app: Express,
  env: NodeJS.ProcessEnv = process.env,
) {
  const addresses = trustedProxyAddresses(env);
  app.set("trust proxy", addresses.length ? addresses : false);
}

/** Bounded process-local limiter. Multi-replica deployments need a shared limiter. */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  clock?: () => number;
}) {
  const buckets = new Map<string, { count: number; until: number }>();
  const clock = options.clock ?? Date.now;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = clock();
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= (options.maxKeys ?? 10_000)) {
        for (const [id, value] of buckets)
          if (value.until <= now) buckets.delete(id);
        // Do not evict active limits: new clients wait until capacity is available.
        if (buckets.size >= (options.maxKeys ?? 10_000) && !bucket) {
          res.setHeader("Retry-After", Math.ceil(options.windowMs / 1000));
          res
            .status(429)
            .json({
              error: { code: "RATE_LIMIT", message: "Please retry shortly." },
            });
          return;
        }
      }
      bucket = { count: 0, until: now + options.windowMs };
      buckets.set(key, bucket);
    }
    if (++bucket.count > options.limit) {
      res.setHeader(
        "Retry-After",
        Math.max(1, Math.ceil((bucket.until - now) / 1000)),
      );
      res
        .status(429)
        .json({
          error: {
            code: "RATE_LIMIT",
            message: "Too many requests. Please retry shortly.",
          },
        });
      return;
    }
    next();
  };
}

const publicLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });
const mutationLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
export function httpHardening(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'",
  );
  res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV === "production")
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.header("Origin");
    if (
      origin &&
      origin !== (process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173")
    ) {
      res
        .status(403)
        .json({
          error: {
            code: "ORIGIN_DENIED",
            message: "Request origin is not allowed.",
          },
        });
      return;
    }
    if (
      /^\/api\/v1\/(auth\/(login|signup|register|forgot-password|recover)|public\/(feedback|subscribe))/i.test(
        req.path,
      )
    ) {
      mutationLimiter(req, res, next);
      return;
    }
  }
  if (/^\/api\/v1\/(verify|track)\//i.test(req.path)) {
    publicLimiter(req, res, next);
    return;
  }
  next();
}

export function enforceRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  trustedProxyAddresses(env);
  if (env.NODE_ENV !== "production") return;
  let origin: URL;
  try {
    origin = new URL(env.PUBLIC_ORIGIN ?? "");
  } catch {
    throw Error("Production requires PUBLIC_ORIGIN as an HTTPS origin.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    env.PUBLIC_ORIGIN !== origin.origin
  )
    throw Error(
      "PUBLIC_ORIGIN must be an exact HTTPS origin without a trailing slash.",
    );
  if (!env.DATABASE_URL)
    throw Error("Production requires the restricted DATABASE_URL.");
  if (!env.DEMO_WEBHOOK_SECRET || env.DEMO_WEBHOOK_SECRET.length < 32)
    throw Error(
      "Production requires a unique DEMO_WEBHOOK_SECRET of at least 32 characters.",
    );
}
