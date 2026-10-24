import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { AttachmentWorker, decodeJob, validateOrigin, workerConfiguration } from "./worker.js";
import { antivirusTestBytes } from "./clamd.js";
import { daemon, healthyReply, version } from "./test-support.js";

const secret = "a".repeat(64);
const clean = Buffer.from("%PDF-1.4\nAstra harmless synthetic document.\n%%EOF");
function job(bytes = clean) { return { attachmentId: randomUUID(), tenantId: randomUUID(), mimeType: "application/pdf", byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64"), leaseToken: "b".repeat(64), leaseExpiresAt: new Date(Date.now() + 120_000).toISOString() }; }
async function api(handler: (req: http.IncomingMessage, body: any, res: http.ServerResponse) => void) {
  const server = http.createServer(async (req, res) => { let input = ""; for await (const chunk of req) input += chunk; res.setHeader("Content-Type", "application/json"); handler(req, JSON.parse(input), res); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  return { origin, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } };
}
test("worker config cannot send credentials to HTTP, URL credentials or a path", () => {
  assert.equal(validateOrigin("https://example.com/"), "https://example.com");
  for (const value of ["http://example.com/", "https://user:pass@example.com/", "https://example.com/other", "https://example.com/?token=a", "https://example.com/#x", "file:///test"]) assert.throws(() => validateOrigin(value));
  assert.throws(() => validateOrigin("http://localhost/", true));
  assert.throws(() => workerConfiguration.parse({ origin: "https://example.com", secret, workerId: "ok", extra: true }));
});
test("worker binds exact canonical bytes, hash, length, lease and accepted MIME", () => {
  assert.deepEqual(decodeJob(job()).bytes, clean);
  const invalid = [{ sha256: "0".repeat(64) }, { byteLength: clean.length + 1 }, { base64: clean.toString("base64") + "\n" }, { leaseExpiresAt: new Date(Date.now() - 1).toISOString() }, { mimeType: "text/html" }, { attachmentId: "../../file" }, { url: "https://elsewhere/file" }];
  for (const changes of invalid) assert.throws(() => decodeJob({ ...job(), ...changes }));
});
for (const [label, bytes, verdict] of [["clean", clean, "CLEAN"], ["threat", Buffer.concat([clean, antivirusTestBytes()]), "REJECTED"]] as const) test(`worker ${label} goes through claim, exact scan and bound finish`, async () => {
  const d = await daemon(healthyReply), claimed = job(bytes); let finish: any;
  const a = await api((req, body, res) => {
    assert.equal(req.headers.authorization, `Bearer ${secret}`); assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.origin, undefined);
    if (req.url?.endsWith("claim")) { assert.equal(body.workerId, "synthetic-test"); res.end(JSON.stringify({ job: claimed })); }
    else { finish = body; res.end('{"accepted":true}'); }
  });
  try {
    const result = await new AttachmentWorker({ origin: a.origin, secret, workerId: "synthetic-test", clamdPort: d.port }, true).once();
    assert.equal(result.state, verdict); assert.equal(finish.attachmentId, claimed.attachmentId); assert.equal(finish.tenantId, claimed.tenantId); assert.equal(finish.sha256, claimed.sha256); assert.equal(finish.leaseToken, claimed.leaseToken); assert.equal(finish.verdict, verdict);
    assert.equal(finish.base64, undefined);
  } finally { await a.close(); await d.close(); }
});
test("worker does not follow API redirects or forward its credential", async () => {
  const d = await daemon(healthyReply); let received = false;
  const target = await api((_req, _body, res) => { received = true; res.end('{}'); });
  const redirect = await api((_req, _body, res) => { res.statusCode = 307; res.setHeader("Location", target.origin); res.end('{}'); });
  try { await assert.rejects(new AttachmentWorker({ origin: redirect.origin, secret, workerId: "test", clamdPort: d.port }, true).once()); assert.equal(received, false); }
  finally { await redirect.close(); await target.close(); await d.close(); }
});
test("engine changes during scan produce ERROR tied to original lease identity", async () => {
  let reloaded = false, finish: any;
  const timestamp = new Date();
  const engine = await daemon((cmd, bytes) => {
    if (cmd === "zVERSIONCOMMANDS") return version(timestamp, reloaded ? "27001" : "27000");
    if (cmd === "zINSTREAM" && bytes.equals(clean)) reloaded = true;
    return healthyReply(cmd, bytes);
  });
  const a = await api((req, body, res) => { if (req.url?.endsWith("claim")) res.end(JSON.stringify({ job: job() })); else { finish = body; res.end('{"accepted":true}'); } });
  try { assert.equal((await new AttachmentWorker({ origin: a.origin, secret, workerId: "test", clamdPort: engine.port }, true).once()).state, "ERROR"); assert.equal(finish.signatureVersion, "27000"); assert.equal(finish.reasonCode, "SCAN_FAILED"); }
  finally { await a.close(); await engine.close(); }
});
test("stale engine cannot claim files; malformed or rejected API responses cannot finish", async () => {
  const d = await daemon((cmd, bytes) => cmd === "zVERSIONCOMMANDS" ? version(new Date(Date.now()-49*3600_000)) : healthyReply(cmd, bytes));
  let calls = 0; const a = await api((_req, _body, res) => { calls++; res.end('{}'); });
  try { await assert.rejects(new AttachmentWorker({ origin: a.origin, secret, workerId: "test", clamdPort: d.port }, true).once()); assert.equal(calls, 0); }
  finally { await a.close(); await d.close(); }
  const healthy = await daemon(healthyReply); let finishes = 0;
  const bad = await api((req, _body, res) => { if (req.url?.endsWith("finish")) finishes++; res.end(JSON.stringify({ job: { ...job(), sha256: "0".repeat(64) } })); });
  try { await assert.rejects(new AttachmentWorker({ origin: bad.origin, secret, workerId: "test", clamdPort: healthy.port }, true).once()); assert.equal(finishes, 0); }
  finally { await bad.close(); await healthy.close(); }
});
