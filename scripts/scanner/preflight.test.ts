/** Regression tests for the T-002 scanner readiness preflight.
 * The decision function is pure (no database, no daemon) except for the
 * engine probe, which runs against the in-memory fake daemon from
 * test-support.ts. Nothing here needs a live ClamAV or a database, so
 * this file stays runnable by test:scanner on its own. */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  decideScannerVerdictPath,
  fixtureSecretValid,
  probeFixtureSecret,
  resolveScannerVerdictPath,
} from "./preflight.js";
import { daemon, healthyReply } from "./test-support.js";

const VALID_SECRET = "a".repeat(64);

test("preflight: a valid 64-hex fixture secret selects the fixture path", () => {
  assert.equal(fixtureSecretValid(VALID_SECRET), true);
  assert.equal(fixtureSecretValid("not-a-secret"), false);
  assert.equal(fixtureSecretValid(undefined), false);
  const path = decideScannerVerdictPath({ secret: VALID_SECRET, engineUp: false });
  assert.equal(path.mode, "fixture");
});

test("preflight: a malformed secret is a failure, not a silent skip", () => {
  const path = decideScannerVerdictPath({ secret: "deadbeef", engineUp: false });
  assert.equal(path.mode, "none");
  assert.match(path.detail, /not 64 lowercase hexadecimal/);
});

test("preflight: no secret and no engine means no verdict path", () => {
  const path = decideScannerVerdictPath({ engineUp: false });
  assert.equal(path.mode, "none");
  assert.match(path.detail, /No scanner verdict path/);
});

test("preflight: engine up but no worker heartbeat means no verdict path", () => {
  const path = decideScannerVerdictPath({
    engineUp: true,
    engineDetail: "ClamAV 1.5.4 signatures 28194",
    heartbeatSeenAt: null,
  });
  assert.equal(path.mode, "none");
  assert.match(path.detail, /no scanner worker heartbeat/);
});

test("preflight: engine up with a stale heartbeat means no verdict path", () => {
  const now = new Date();
  const path = decideScannerVerdictPath({
    engineUp: true,
    heartbeatSeenAt: new Date(now.getTime() - 16 * 60_000),
    now,
  });
  assert.equal(path.mode, "none");
  assert.match(path.detail, /no scanner worker heartbeat/);
});

test("preflight: engine up with a fresh heartbeat selects the real path", () => {
  const now = new Date();
  const path = decideScannerVerdictPath({
    engineUp: true,
    engineDetail: "ClamAV 1.5.4 signatures 28194",
    heartbeatSeenAt: new Date(now.getTime() - 60_000),
    now,
  });
  assert.equal(path.mode, "real-clamd");
});

test("preflight: a live fake engine reaches the heartbeat branch (no database, so no verdict path)", async () => {
  const fake = await daemon(healthyReply);
  try {
    const path = await resolveScannerVerdictPath(
      // Empty env: no fixture secret and no database to read a heartbeat
      // from, so the resolver must reach the worker-heartbeat branch and
      // report "none" — proving the engine probe ran and passed.
      {},
      fake.port,
    );
    assert.equal(path.mode, "none");
    assert.match(path.detail, /no scanner worker heartbeat/);
  } finally {
    await fake.close();
  }
});

test("preflight: a live fake engine is not mistaken for a verdict path when the secret is absent and the port is closed", async () => {
  const probe = await daemon(healthyReply);
  const closedPort = probe.port;
  await probe.close();
  const path = await resolveScannerVerdictPath(
    { ATTACHMENT_SCANNER_SECRET: undefined },
    closedPort,
  );
  assert.equal(path.mode, "none");
  assert.match(path.detail, /no ClamAV daemon answered/);
});

test("preflight: probe accepts the secret the API holds, rejects any other", async () => {
  const server = http.createServer((req, res) => {
    // Mimics the scanner-auth middleware: 401 unless the bearer matches.
    if (req.headers.authorization !== `Bearer ${VALID_SECRET}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "SCANNER_AUTH_REQUIRED" } }));
      return;
    }
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "INPUT_INVALID" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {
    assert.equal(await probeFixtureSecret(origin, VALID_SECRET), true);
    assert.equal(await probeFixtureSecret(origin, "b".repeat(64)), false);
    assert.equal(await probeFixtureSecret(origin, "not-a-secret"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("preflight: probe returns false when the API is unreachable", async () => {
  const probe = await daemon(healthyReply);
  const closedPort = probe.port;
  await probe.close();
  assert.equal(
    await probeFixtureSecret(`http://127.0.0.1:${closedPort}`, VALID_SECRET),
    false,
  );
});
