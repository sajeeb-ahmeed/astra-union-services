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
  key?: (req: Request) => string;
}) {
  const buckets = new Map<string, { count: number; until: number }>();
  const clock = options.clock ?? Date.now;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = clock();
    const key =
      options.key?.(req) ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= (options.maxKeys ?? 10_000)) {
        for (const [id, value] of buckets)
          if (value.until <= now) buckets.delete(id);
        // Do not evict active limits: new clients wait until capacity is available.
        if (buckets.size >= (options.maxKeys ?? 10_000) && !bucket) {
          res.setHeader("Retry-After", Math.ceil(options.windowMs / 1000));
          res.status(429).json({
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
      res.status(429).json({
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

/**
 * Production HTTP -> HTTPS redirect. The reverse proxy (Render, LiteSpeed/cPanel)
 * terminates TLS and reports the client's scheme in X-Forwarded-Proto. When that
 * header says "http", the request is redirected to PUBLIC_ORIGIN, never to the
 * client-supplied Host. GET/HEAD use 301; other methods use 308 so the method
 * and body are not silently changed.
 *
 * S-008: the old code silently passed the request through when the header was
 * absent, so a proxy that does not send it served the app — including the
 * sign-in form — over plain HTTP with no redirect and no error. That is now
 * fail-closed. In production (a declared HTTPS-only deployment) a request
 * with no X-Forwarded-Proto is refused with 421 Misdirected Request unless
 * it is a direct TLS connection (`req.secure`) or the unauthenticated
 * health probe (`GET /api/v1/health`, which carries no credentials and no
 * PII — local health checks hit the app directly over loopback without the
 * header). A misconfigured proxy must fail loudly instead of silently
 * serving cleartext; the operator fix is cPanel -> Domains -> Force HTTPS
 * Redirect (the defence-in-depth fallback the deploy checklist names) or
 * fixing the proxy to send X-Forwarded-Proto.
 *
 * Escape hatch: HTTPS_STRICT=false restores the old pass-through for a
 * deployment that knowingly serves plain HTTP behind a non-reporting
 * proxy. It is an explicit opt-out only — never set it on the live site.
 */
export function createHttpsRedirect(env: NodeJS.ProcessEnv = process.env) {
  let origin: string | null = null;
  if (env.NODE_ENV === "production") {
    try {
      const parsed = new URL(env.PUBLIC_ORIGIN ?? "");
      if (parsed.protocol === "https:") origin = parsed.origin;
    } catch { /* enforceRuntimeConfig reports the invalid origin */ }
  }
  const strict = env.HTTPS_STRICT !== "false";
  if (origin && !strict)
    console.warn(
      "[security] HTTPS_STRICT=false: plain-HTTP requests without " +
        "X-Forwarded-Proto will be served instead of refused. Do not use " +
        "on the live site.",
    );
  return (req: Request, res: Response, next: NextFunction) => {
    if (!origin) { next(); return; }
    const proto = req.header("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase();
    if (proto === "http") {
      res.redirect(["GET", "HEAD"].includes(req.method) ? 301 : 308, `${origin}${req.originalUrl}`);
      return;
    }
    if (proto !== undefined) { next(); return; }
    // S-008: no scheme reported. A direct TLS connection is fine, and the
    // health probe is safe to answer over loopback without the header.
    if (!strict || req.secure || (req.method === "GET" && req.path === "/api/v1/health")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(421).json({
      error: {
        code: "HTTPS_REQUIRED",
        message:
          "This service is HTTPS-only, but the proxy did not report the request scheme (X-Forwarded-Proto). The request was refused instead of being served over plain HTTP.",
      },
    });
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
    // S-013: style-src is split so an injected <style> element is blocked
    // while React inline styles (style attributes) keep working. The only
    // inline <style> block in the served app is the F-015 first-paint guard
    // in apps/web/index.html (`body{margin:0}`), allowed here by its SHA-256
    // hash — recompute the hash if that block ever changes. style-src-attr
    // stays 'unsafe-inline' because hashes/nonces cannot cover style
    // attributes (only 'unsafe-hashes' per attribute could, which is
    // infeasible for a React app); that residual is documented in
    // docs/HTTP_HEADERS.md. No inline <script> exists anywhere, so
    // script-src stays 'self'.
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src-elem 'self' 'sha256-IAdwN3biDCQ3brrgp1m8kBEsPQYyqfREKOEfeoREopc='; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'",
  );
  res.setHeader("Cache-Control", "no-store");
  // S-008: HSTS policy — one year, subdomains included. The header is only
  // meaningful over HTTPS (browsers ignore it over plain HTTP), which is
  // why the redirect above refuses to serve the app over unverified
  // transport instead of silently passing through. Preload is NOT claimed:
  // the domain is not on the preload list, and claiming it here would not
  // add it. The live value is checked by the deploy checklist
  // (docs/DEPLOY-CPANEL.md §6) via the readiness script's plain-HTTP check.
  if (process.env.NODE_ENV === "production")
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.header("Origin");
    // Phase 5c: SSLCommerz returns the payer with a form POST from its own site, only to this callback path.
    const gatewayReturn =
      /^\/api\/v1\/payments\/sslcommerz\/callback\/[a-f0-9]{64}$/.test(req.path) &&
      (origin === "https://sandbox.sslcommerz.com" || origin === "https://securepay.sslcommerz.com" || origin === "null");
    if (
      origin &&
      !gatewayReturn &&
      origin !== (process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173")
    ) {
      res.status(403).json({
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
  // S-009: the four crypto keys previously failed soft in production — the
  // server started and the features reported 503/unavailable
  // (identifiers.ts loadSecret, citizen-data.ts loadKey, mfa-crypto.ts
  // mfaAvailable, sslcommerz.ts merchantKey). A production boot with a key
  // missing is a misconfiguration, not a degraded mode: fail fast here,
  // with the same shape each loader accepts, so the failure is loud at
  // deploy time instead of silent at first use. Non-production behaviour
  // is untouched (dev/test auto-generate keys into .runtime/*).
  // ATTACHMENT_SCANNER_SECRET is deliberately NOT required here: the
  // internal scanner API already fails closed (401) without a valid 64-hex
  // secret (attachments.ts), so its absence cannot silently weaken
  // anything; see docs/KEY_MANAGEMENT.md.
  if (!env.IDENTIFIER_SECRET || env.IDENTIFIER_SECRET.length < 32)
    throw Error(
      "Production requires IDENTIFIER_SECRET of at least 32 characters.",
    );
  if (!/^[a-f0-9]{64}$/i.test(env.CITIZEN_DATA_KEY ?? ""))
    throw Error(
      "Production requires CITIZEN_DATA_KEY as 64 hexadecimal characters.",
    );
  if (!/^[a-f0-9]{64}$/i.test(env.MFA_ENCRYPTION_KEY ?? ""))
    throw Error(
      "Production requires MFA_ENCRYPTION_KEY as 64 hexadecimal characters.",
    );
  if (!/^[a-f0-9]{64}$/i.test(env.MERCHANT_SECRET_KEY ?? ""))
    throw Error(
      "Production requires MERCHANT_SECRET_KEY as 64 hexadecimal characters.",
    );
}
