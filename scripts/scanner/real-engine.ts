/** Mandatory real ClamAV evidence. Never substituted with mocked attestations. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyEngine, scanBytes, antivirusTestBytes, command } from "./clamd.js";
import { antivirusPdfFixture } from "./fixtures.js";

const evidence: any = { startedAt: new Date().toISOString(), kind: "REAL_CLAMAV", checks: [] };
const check = (name: string) => evidence.checks.push({ name, status: "PASS" });
try {
  const identity = await verifyEngine(); evidence.engine = identity;
  check("Fresh official engine answers PING and supports INSTREAM; clean and EICAR readiness probes pass");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8WQAAAAASUVORK5CYII=", "base64");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
  for (const [label, bytes] of [["synthetic PDF", pdf], ["synthetic PNG", png]] as const) {
    assert.equal((await scanBytes(bytes)).verdict, "CLEAN"); check(`${label}: no threat detected`);
  }
  // Embedded EICAR remains in memory only, including its PDF wrapper.
  const wrapped = antivirusPdfFixture();
  assert.equal((await scanBytes(wrapped)).verdict, "REJECTED"); wrapped.fill(0);
  check("Valid PDF containing EmbeddedFile antivirus fixture rejected by actual signatures");
  await assert.rejects(command("INSTREAM", Buffer.alloc(2_097_153)), /SIZE/);
  check("Client stream ceiling rejects more than 2 MiB");
  evidence.status = "PASS";
} catch (error) { evidence.status = "FAIL"; evidence.error = error instanceof Error ? error.message : "REAL_ENGINE_FAILURE"; process.exitCode = 1; }
evidence.finishedAt = new Date().toISOString();
fs.mkdirSync("execution", { recursive: true });
fs.writeFileSync("execution/attachment-real-engine.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
