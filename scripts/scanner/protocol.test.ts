import assert from "node:assert/strict";
import { test } from "node:test";
import { daemon, version, healthyReply } from "./test-support.js";
import { command, parseVersion, parseVerdict, scanBytes, verifyEngine, antivirusTestBytes } from "./clamd.js";


test("clamd streams all exact bytes in bounded chunks, with no filesystem commands", async () => {
  const original = Buffer.alloc(200_003, 97); let observed: Buffer | undefined;
  const d = await daemon((cmd, bytes) => { assert.equal(cmd, "zINSTREAM"); observed = bytes; return "stream: OK"; });
  try { assert.equal(await command("INSTREAM", original, d), "stream: OK"); assert.deepEqual(observed, original); } finally { await d.close(); }
});
for (const [label, reply] of [
  ["truncated", Buffer.from("stream: OK")], ["multiple records", Buffer.from("stream: OK\0stream: malicious FOUND\0")],
  ["embedded newline", Buffer.from("stream: OK\n\0")], ["oversized", Buffer.alloc(9000, 97)], ["empty", Buffer.alloc(0)],
] as const) test(`clamd never releases ${label} response`, async () => {
  const d = await daemon(() => reply); try { assert.equal((await scanBytes(Buffer.from("harmless"), d)).verdict, "ERROR"); } finally { await d.close(); }
});
test("clamd deadline and refused connection fail closed", async () => {
  const d = await daemon(() => null); try { await assert.rejects(command("PING", undefined, { ...d, timeoutMs: 50 }), /TIMEOUT/); } finally { await d.close(); }
  assert.equal((await scanBytes(Buffer.from("harmless"), d)).verdict, "ERROR");
});
test("clamd rejects zero, oversized streams and invalid endpoint options", async () => {
  await assert.rejects(command("INSTREAM", Buffer.alloc(0)), /SIZE/);
  await assert.rejects(command("INSTREAM", Buffer.alloc(2_097_153)), /SIZE/);
  await assert.rejects(command("PING", undefined, { port: 0 }), /CONFIGURATION/);
});
test("only exact clean result passes; threats, limits and unknown results fail closed", () => {
  assert.deepEqual(parseVerdict("stream: OK"), { verdict: "CLEAN", reasonCode: "OK" });
  assert.equal(parseVerdict("stream: Eicar-Signature FOUND").verdict, "REJECTED");
  assert.deepEqual(parseVerdict("stream: Heuristics.Limits.Exceeded FOUND"), { verdict: "REJECTED", reasonCode: "SCAN_LIMIT" });
  for (const reply of ["OK", "stream: OK extra", "stream: access denied ERROR", "UNKNOWN COMMAND", "stream: OK\0"]) assert.equal(parseVerdict(reply).verdict, "ERROR");
  assert.equal(parseVerdict("INSTREAM size limit exceeded. ERROR").reasonCode, "SCAN_LIMIT");
});
test("definitions require identifiable fresh database and streaming support", () => {
  const now = Date.now(); assert.equal(parseVersion(version(new Date(now)), now).engineVersion, "ClamAV 1.4.6");
  for (const value of [version(new Date(now - 49 * 3600_000)), version(new Date(now + 6 * 60_000)), version(new Date(), "0"), "ClamAV 1.4.6", version().replace("INSTREAM", "SCAN")]) assert.throws(() => parseVersion(value, now));
});
test("definitions older than 48 h pass only while they are the newest ClamAV publishes, and never past 14 days", () => {
  const now = Date.now(), day = 24 * 3600_000;
  const threeDays = version(new Date(now - 3 * day), "28194");
  // ClamAV paused publishing: the loaded daily IS the newest published one.
  assert.equal(parseVersion(threeDays, now, 28194).signatureVersion, "28194");
  // A newer daily exists but was not installed: stale.
  assert.throws(() => parseVersion(threeDays, now, 28195), /SCANNER_DEFINITIONS_STALE/);
  // Unknown published version: the strict 48 h rule applies.
  assert.throws(() => parseVersion(threeDays, now, null), /SCANNER_DEFINITIONS_STALE/);
  // Backstop: even the newest published daily is refused after 14 days.
  assert.throws(() => parseVersion(version(new Date(now - 15 * day), "28194"), now, 28194), /SCANNER_DEFINITIONS_STALE/);
  // Within 48 h nothing else is needed.
  assert.equal(parseVersion(version(new Date(now - day), "28100"), now, 28194).signatureVersion, "28100");
});
test("readiness requires both clean and standard antivirus test outcomes", async () => {
  const healthy = await daemon(healthyReply); try { assert.equal((await verifyEngine(healthy)).engineVersion, "ClamAV 1.4.6"); } finally { await healthy.close(); }
  const broken = await daemon((cmd, bytes) => cmd === "zINSTREAM" ? "stream: OK" : healthyReply(cmd, bytes));
  try { await assert.rejects(verifyEngine(broken), /SELF_TEST/); } finally { await broken.close(); }
});
