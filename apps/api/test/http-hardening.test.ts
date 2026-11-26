import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createRateLimiter,
  httpHardening,
  enforceRuntimeConfig,
  configureProxyTrust,
  createHttpsRedirect,
} from "../src/http-hardening.js";

test("Security: bounded limiter enforces per-IP budget, Retry-After and expiry", async () => {
  let now = 1000;
  const app = express();
  app.use(
    createRateLimiter({
      limit: 2,
      windowMs: 3000,
      maxKeys: 2,
      clock: () => now,
    }),
  );
  app.get("/", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    const limited = await fetch(url);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "3");
    now += 3001;
    assert.equal((await fetch(url)).status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("Security: headers and Origin check protect public login mutations as well as authenticated writes", async () => {
  const app = express();
  app.use(httpHardening);
  app.post("/api/v1/auth/login", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/v1/auth/login`;
    const rejected = await fetch(url, {
      method: "POST",
      headers: { Origin: "https://attacker.invalid" },
    });
    assert.equal(rejected.status, 403);
    assert.match(
      rejected.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    assert.equal(rejected.headers.get("x-content-type-options"), "nosniff");
    assert.equal(rejected.headers.get("cache-control"), "no-store");
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            Origin: process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173",
          },
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("Deployment: production rejects missing secrets, unsafe origins and broad proxy trust", () => {
  assert.doesNotThrow(() => enforceRuntimeConfig({ NODE_ENV: "test" }));
  const config = {
    NODE_ENV: "production",
    PUBLIC_ORIGIN: "https://demo.example.test",
    DATABASE_URL: "postgresql://astra_app@db/astra",
    DEMO_WEBHOOK_SECRET: "x".repeat(32),
    // S-009: the four crypto keys are required in production (fail fast).
    IDENTIFIER_SECRET: "test-identifier-secret-at-least-32-chars",
    CITIZEN_DATA_KEY: "11".repeat(32),
    MFA_ENCRYPTION_KEY: "22".repeat(32),
    MERCHANT_SECRET_KEY: "33".repeat(32),
  };
  assert.doesNotThrow(() => enforceRuntimeConfig(config));
  // A-021: production boot fails without the webhook secret — the
  // auto-generated .runtime/webhook-secret file is a dev/test convenience
  // only and must never satisfy a production boot.
  assert.throws(() =>
    enforceRuntimeConfig({ ...config, DEMO_WEBHOOK_SECRET: undefined }),
  );
  // S-009: production boot fails without each crypto key (and without a
  // well-formed one — the loaders reject short/ill-formed values, so the
  // validator must too). Non-production stays permissive: dev/test
  // auto-generate these keys into .runtime/*.
  for (const key of [
    "IDENTIFIER_SECRET",
    "CITIZEN_DATA_KEY",
    "MFA_ENCRYPTION_KEY",
    "MERCHANT_SECRET_KEY",
  ] as const)
    assert.throws(
      () => enforceRuntimeConfig({ ...config, [key]: undefined }),
      key,
    );
  assert.throws(() =>
    enforceRuntimeConfig({ ...config, IDENTIFIER_SECRET: "too-short" }),
  );
  for (const key of [
    "CITIZEN_DATA_KEY",
    "MFA_ENCRYPTION_KEY",
    "MERCHANT_SECRET_KEY",
  ] as const)
    assert.throws(
      () => enforceRuntimeConfig({ ...config, [key]: "not-64-hex" }),
      key,
    );
  assert.doesNotThrow(() =>
    enforceRuntimeConfig({ NODE_ENV: "development" }),
  );
  assert.doesNotThrow(() => enforceRuntimeConfig({ NODE_ENV: "test" }));
  for (const PUBLIC_ORIGIN of [
    "http://demo.example.test",
    "https://demo.example.test/",
    "https://demo.example.test/path",
    "https://user:pass@demo.example.test",
  ])
    assert.throws(() => enforceRuntimeConfig({ ...config, PUBLIC_ORIGIN }));
  assert.throws(() =>
    enforceRuntimeConfig({ ...config, DEMO_WEBHOOK_SECRET: "short" }),
  );
  assert.throws(() => enforceRuntimeConfig({ ...config, TRUST_PROXY: "true" }));
  for (const TRUST_PROXY_IP of [
    "172.29.250.0/24",
    "0.0.0.0/0",
    "::/0",
    "0.0.0.0",
    "::",
    "0:0:0:0:0:0:0:0",
    "::ffff:0.0.0.0",
    "proxy.example.test",
    "172.29.250.1,127.0.0.1",
    "fe80::1%eth0",
  ])
    assert.throws(
      () => enforceRuntimeConfig({ ...config, TRUST_PROXY_IP }),
      TRUST_PROXY_IP,
    );
  for (const TRUST_PROXY_IP of ["172.29.250.1", "2001:db8::1"])
    assert.doesNotThrow(() =>
      enforceRuntimeConfig({
        ...config,
        TRUST_PROXY_IP,
        TRUST_PROXY: "loopback",
      }),
    );
});

test("Security: HTTPS_STRICT=false restores the legacy pass-through (explicit opt-out only)", async () => {
  const env = {
    NODE_ENV: "production",
    PUBLIC_ORIGIN: "https://digitalunion.example",
    HTTPS_STRICT: "false",
  } as NodeJS.ProcessEnv;
  const app = express();
  app.use(createHttpsRedirect(env));
  app.all(/.*/, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    assert.equal((await fetch(`${url}/login`, { redirect: "manual" })).status, 200);
    const get = await fetch(`${url}/login`, {
      redirect: "manual",
      headers: { "X-Forwarded-Proto": "http" },
    });
    assert.equal(get.status, 301, "explicit http is still redirected even with the opt-out");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("Security: HSTS carries a one-year max-age with includeSubDomains in production", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const app = express();
  app.use(httpHardening);
  app.get("/", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as any).port}/`);
    assert.equal(
      res.headers.get("strict-transport-security"),
      "max-age=31536000; includeSubDomains",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("Security (S-013): CSP splits style handling — hashed inline <style> only, attributes stay unsafe-inline", async () => {
  const app = express();
  app.use(httpHardening);
  app.get("/", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const csp = (
      await fetch(`http://127.0.0.1:${(server.address() as any).port}/`)
    ).headers.get("content-security-policy")!;
    // No bare style-src 'unsafe-inline': an injected <style> element is
    // blocked. Only the known F-015 first-paint guard (apps/web/index.html
    // `body{margin:0}`) is allowed, by hash.
    assert.doesNotMatch(csp, /(^|; )style-src /);
    assert.match(
      csp,
      /style-src-elem 'self' 'sha256-IAdwN3biDCQ3brrgp1m8kBEsPQYyqfREKOEfeoREopc='/,
    );
    // React inline styles are style attributes; they still need
    // 'unsafe-inline' (documented residual, see docs/HTTP_HEADERS.md).
    assert.match(csp, /style-src-attr 'unsafe-inline'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("Security: mixed-case route aliases share public authentication and verification rate limits", async () => {
  const app = express();
  configureProxyTrust(app, { TRUST_PROXY_IP: "127.0.0.1" });
  app.use(httpHardening);
  app.post("/api/v1/auth/signup", (_req, res) => res.json({ ok: true }));
  app.get("/api/v1/verify/:token", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as any).port}`,
      headers = { "X-Forwarded-For": "203.0.113.51" };
    for (let n = 0; n < 60; n++)
      assert.equal(
        (
          await fetch(
            `${origin}${n % 2 ? "/API/V1/AuTh/SiGnUp" : "/api/v1/auth/signup"}`,
            { method: "POST", headers },
          )
        ).status,
        200,
      );
    assert.equal(
      (await fetch(`${origin}/API/V1/AUTH/SIGNUP`, { method: "POST", headers }))
        .status,
      429,
    );
    for (let n = 0; n < 120; n++)
      assert.equal(
        (
          await fetch(
            `${origin}${n % 2 ? "/API/V1/VeRiFy/demo" : "/api/v1/verify/demo"}`,
            { headers },
          )
        ).status,
        200,
      );
    assert.equal(
      (await fetch(`${origin}/API/V1/VERIFY/demo`, { headers })).status,
      429,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Deployment: exact proxy trust normalizes host addresses and never trusts a neighboring peer", () => {
  const app = express();
  configureProxyTrust(app, { TRUST_PROXY_IP: "172.29.250.1" });
  let trust = app.get("trust proxy fn");
  assert.equal(trust("172.29.250.1", 0), true);
  assert.equal(trust("::ffff:172.29.250.1", 0), true);
  assert.equal(trust("172.29.250.2", 0), false);
  assert.equal(trust("127.0.0.1", 0), false);
  configureProxyTrust(app, {
    TRUST_PROXY_IP: "2001:db8::1",
    TRUST_PROXY: "loopback",
  });
  trust = app.get("trust proxy fn");
  assert.equal(trust("2001:0db8:0:0:0:0:0:1", 0), true);
  assert.equal(trust("2001:db8::2", 0), false);
  assert.equal(trust("127.0.0.1", 0), true);
  configureProxyTrust(app, {});
  assert.equal(app.get("trust proxy fn")("127.0.0.1", 0), false);
});

test("Security: only a trusted immediate proxy separates forwarded clients into distinct rate buckets", async () => {
  for (const trusted of [true, false]) {
    const app = express();
    configureProxyTrust(app, {
      TRUST_PROXY_IP: trusted ? "127.0.0.1" : "172.29.250.1",
    });
    app.use(createRateLimiter({ limit: 1, windowMs: 60000 }));
    app.get("/", (req, res) => res.json({ ip: req.ip }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as any).port}`;
      const a = await fetch(url, {
        headers: { "X-Forwarded-For": "203.0.113.61" },
      });
      assert.equal(a.status, 200);
      assert.equal((await a.json()).ip, trusted ? "203.0.113.61" : "127.0.0.1");
      assert.equal(
        (await fetch(url, { headers: { "X-Forwarded-For": "203.0.113.61" } }))
          .status,
        429,
      );
      const b = await fetch(url, {
        headers: { "X-Forwarded-For": "198.51.100.250, 203.0.113.62" },
      });
      assert.equal(b.status, trusted ? 200 : 429);
      if (trusted)
        assert.equal(
          (await b.json()).ip,
          "203.0.113.62",
          "Untrusted earlier forwarded entries cannot override the nearest client",
        );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

test("Security: production redirects proxied plain-HTTP requests to the configured HTTPS origin", async () => {
  const env = { NODE_ENV: "production", PUBLIC_ORIGIN: "https://digitalunion.example" } as NodeJS.ProcessEnv;
  const app = express();
  app.use(createHttpsRedirect(env));
  app.all(/.*/, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    const get = await fetch(`${url}/login?next=%2Fapply`, {
      redirect: "manual",
      headers: { "X-Forwarded-Proto": "http", Host: "evil.example" },
    });
    assert.equal(get.status, 301);
    assert.equal(get.headers.get("location"), "https://digitalunion.example/login?next=%2Fapply");
    const post = await fetch(`${url}/api/v1/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "X-Forwarded-Proto": "HTTP, https" },
    });
    assert.equal(post.status, 308);
    assert.equal(post.headers.get("location"), "https://digitalunion.example/api/v1/auth/login");
    for (const headers of [{ "X-Forwarded-Proto": "https" }] as Record<string, string>[])
      assert.equal((await fetch(`${url}/login`, { redirect: "manual", headers })).status, 200);
    // S-008: no scheme reported and no direct TLS — fail closed instead of
    // silently serving the app over possibly-plain HTTP.
    const refused = await fetch(`${url}/login`, { redirect: "manual" });
    assert.equal(refused.status, 421);
    assert.equal((await refused.json()).error.code, "HTTPS_REQUIRED");
    assert.equal(refused.headers.get("cache-control"), "no-store");
    // The unauthenticated health probe is the one exception: it carries no
    // credentials, and local health checks hit the app directly without the
    // proxy header.
    assert.equal((await fetch(`${url}/api/v1/health`, { redirect: "manual" })).status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  for (const other of [
    { NODE_ENV: "development", PUBLIC_ORIGIN: "https://digitalunion.example" },
    { NODE_ENV: "production", PUBLIC_ORIGIN: "http://127.0.0.1:5173" },
  ] as NodeJS.ProcessEnv[]) {
    const passthrough = express();
    passthrough.use(createHttpsRedirect(other));
    passthrough.get("/", (_req, res) => res.json({ ok: true }));
    const s = passthrough.listen(0, "127.0.0.1");
    await new Promise<void>((r) => s.once("listening", r));
    try {
      const res = await fetch(`http://127.0.0.1:${(s.address() as any).port}/`, {
        redirect: "manual",
        headers: { "X-Forwarded-Proto": "http" },
      });
      assert.equal(res.status, 200);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  }
});
