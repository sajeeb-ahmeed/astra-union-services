/** Real HTTP API -> PostgreSQL -> PC worker -> ClamAV acceptance check.
 * Run only against a freshly initialized, seeded loopback astra_attachment_* DB.
 * It never connects to Render or supplies a payment merchant credential. */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../../apps/api/src/app.js";
import {
  pool,
  adminConnectionString,
  connectionString,
} from "../../apps/api/src/db.js";
import { closePdfBrowser } from "../../apps/api/src/pdf.js";
import { AttachmentWorker } from "./worker.js";
import { engineIdentity } from "./clamd.js";
import { antivirusPdfFixture } from "./fixtures.js";

for (const value of [adminConnectionString, connectionString]) {
  const url = new URL(value);
  assert.equal(url.hostname, "127.0.0.1");
  assert.match(url.pathname, /^\/astra_attachment_[a-z0-9_]+$/);
}
const db = new pg.Pool({ connectionString: adminConnectionString });
const secret = randomBytes(32).toString("hex");
process.env.ATTACHMENT_SCANNER_SECRET = secret;
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
type Session = { cookie: string; csrf: string };
const sessions: Record<string, Session> = {};
const evidence: any = {
  startedAt: new Date().toISOString(),
  kind: "REAL_CLAMAV_HTTP_POSTGRESQL",
  scope: "isolated loopback database; synthetic fixtures only",
  checks: [],
};
const pass = (name: string) => evidence.checks.push({ name, status: "PASS" });
async function request(
  method: string,
  path: string,
  body?: unknown,
  session?: Session,
) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
  };
}
function handle(file: any) {
  return {
    attachmentId: file.attachmentId,
    mimeType: file.mimeType,
    byteLength: file.byteLength,
  };
}
try {
  evidence.engine = await engineIdentity();
  for (const name of ["staff", "citizen", "reviewer", "approver", "foreign"]) {
    const r = await request("POST", "/auth/login", {
      email:
        name === "foreign" ? "staff@beta.demo.test" : `${name}@alpha.demo.test`,
      password: "Demo-Phase1!",
    });
    assert.equal(r.status, 200);
    sessions[name] = {
      cookie: r.headers.get("set-cookie")!.split(";")[0]!,
      csrf: r.body.csrfToken,
    };
  }
  const citizen = (
    await request("GET", "/citizens", undefined, sessions.citizen)
  ).body.items[0];
  const worker = new AttachmentWorker(
    { origin, secret, workerId: "real-local-qa", clamdPort: 3310 },
    true,
  );
  const safe = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
  );
  const unsafe = antivirusPdfFixture();
  const upload = async (bytes: Buffer) => {
    const r = await request(
      "POST",
      "/attachments",
      {
        citizenId: citizen.id,
        mimeType: "application/pdf",
        base64: bytes.toString("base64"),
      },
      sessions.staff,
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.scanState, "QUARANTINED");
    assert.equal(
      (
        await request(
          "GET",
          `/attachments/${r.body.attachmentId}`,
          undefined,
          sessions.staff,
        )
      ).status,
      409,
    );
    return r.body;
  };
  const clean = await upload(safe);
  pass(
    "Authenticated upload enters quarantine and authorized download is blocked before scan",
  );
  assert.deepEqual(await worker.once(), {
    state: "CLEAN",
    attachmentId: clean.attachmentId,
  });
  const downloaded = await request(
    "GET",
    `/attachments/${clean.attachmentId}`,
    undefined,
    sessions.citizen,
  );
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.body, safe);
  pass(
    "Actual worker claims exact bytes, actual ClamAV returns clean, matching-hash bytes download privately",
  );
  assert.equal(
    (
      await request(
        "GET",
        `/attachments/${clean.attachmentId}/status`,
        undefined,
        sessions.foreign,
      )
    ).status,
    404,
  );
  pass("Clean scan does not weaken cross-tenant privacy");
  const rejected = await upload(unsafe);
  unsafe.fill(0);
  assert.deepEqual(await worker.once(), {
    state: "REJECTED",
    attachmentId: rejected.attachmentId,
  });
  const state = await request(
    "GET",
    `/attachments/${rejected.attachmentId}/status`,
    undefined,
    sessions.staff,
  );
  assert.equal(state.body.scanState, "REJECTED");
  assert.equal(state.body.reasonCode, "UNSAFE_FILE");
  assert.equal(state.body.downloadAllowed, false);
  assert.equal(state.body.retryAllowed, false);
  assert.equal(
    (
      await request(
        "GET",
        `/attachments/${rejected.attachmentId}`,
        undefined,
        sessions.staff,
      )
    ).status,
    409,
  );
  pass(
    "Actual ClamAV detects EICAR in a valid EmbeddedFile PDF and API keeps it unreadable",
  );
  const draft = async (file: any) => {
    const r = await request(
      "POST",
      "/applications",
      {
        citizenId: citizen.id,
        serviceNo: 1,
        payload: {
          ...demoPayloads[1],
          supporting_documents: [
            { description: "Real scanner synthetic QA", file: handle(file) },
          ],
        },
      },
      sessions.staff,
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const blocked = await draft(rejected);
  const submit = await request(
    "POST",
    `/applications/${blocked.id}/transition`,
    { action: "submit" },
    sessions.staff,
  );
  assert.equal(submit.status, 409);
  assert.equal(submit.body.error.code, "ATTACHMENT_NOT_READY");
  pass(
    "Real infected-file verdict blocks application submission without changing its draft",
  );
  const approved = await draft(clean);
  for (const [action, role] of [
    ["submit", "staff"],
    ["review", "reviewer"],
    ["approve", "approver"],
  ]) {
    const r = await request(
      "POST",
      `/applications/${approved.id}/transition`,
      { action },
      sessions[role!],
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const issued = await request(
    "POST",
    `/applications/${approved.id}/issue`,
    {},
    sessions.approver,
  );
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  const replay = await request(
    "POST",
    `/applications/${approved.id}/issue`,
    {},
    sessions.approver,
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, issued.body.id);
  const ledger = (
    await db.query(
      "SELECT count(*)::int n,sum(delta)::int delta FROM credit_ledger WHERE certificate_id=$1",
      [issued.body.id],
    )
  ).rows[0];
  assert.deepEqual(ledger, { n: 1, delta: -1 });
  const pdf = await request(
    "GET",
    `/certificates/${issued.body.id}/pdf`,
    undefined,
    sessions.citizen,
  );
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  pass(
    "A real scanned file completes submit, review, authorized approval, PDF and exactly-once credit deduction",
  );
  const waiting = await upload(safe);
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => probe.once("listening", resolve));
  const closedPort = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const offline = new AttachmentWorker(
    { origin, secret, workerId: "real-offline-qa", clamdPort: closedPort },
    true,
  );
  await assert.rejects(offline.once());
  const unchanged = (
    await db.query(
      "SELECT scan_state,scan_attempts FROM attachments WHERE id=$1",
      [waiting.attachmentId],
    )
  ).rows[0];
  assert.deepEqual(unchanged, { scan_state: "QUARANTINED", scan_attempts: 0 });
  pass(
    "PC scanner unavailable leaves a new file waiting without claiming or releasing it",
  );
  assert.deepEqual(await worker.once(), {
    state: "CLEAN",
    attachmentId: waiting.attachmentId,
  });
  pass("Resuming the actual scanner processes the waiting file");
  const events = (
    await db.query(
      "SELECT event,count(*)::int count FROM attachment_scan_events GROUP BY event ORDER BY event",
    )
  ).rows;
  assert.ok(events.some((row) => row.event === "REJECTED"));
  assert.ok(events.some((row) => row.event === "CLEAN"));
  evidence.events = events;
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  evidence.error = error instanceof Error ? error.message : "REAL_FLOW_FAILURE";
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  fs.mkdirSync("execution", { recursive: true });
  fs.writeFileSync(
    "execution/attachment-real-flow-2026-10-24.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await db.end();
}
