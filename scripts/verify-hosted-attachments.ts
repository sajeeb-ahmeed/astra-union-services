/** Release 0.9 hosted attachment acceptance, explicitly split around the PC worker.
 * Run prepare ONLY while the worker is paused; start the real worker, then verify.
 * ASTRA_LIVE_URL=https://authorized-origin node --import tsx scripts/verify-hosted-attachments.ts prepare|verify
 * New domain records: one clearly synthetic citizen and two private PDF uploads in
 * the existing orders-QA office. Existing accounts/policies/apps/payments/credits are
 * read-only. No scanner secret is read, no scanner finish/verdict is fabricated.
 * The harmless antivirus PDF is constructed in memory and never written/rendered.
 * IDs and mutation-attempt records stay in ignored .runtime/hosted. Logs and public
 * evidence contain only sanitized checks/counts. An ambiguous POST is never retried.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { antivirusPdfFixture } from "./scanner/fixtures.js";
import { qaOutput } from "./qa-output.js";

type Session = {
  cookie: string;
  csrf: string;
  user: { role: string; tenantId: string };
};
type Reply = { status: number; body: any; headers: Headers };
type Handle = { attachmentId: string; mimeType: string; byteLength: number };
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fixtureFile = path.resolve(".runtime/hosted/attachment-qa-current.json");
const read = (filename: string) =>
  JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
const sessions: Record<string, Session> = {};
let fixture: any,
  base = "",
  stage = "Validate private configuration",
  output = "";
const phase = process.argv[2];
const evidence: any = {
  release: "0.9.0",
  phase,
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  scope:
    "Existing synthetic QA offices only. One new synthetic citizen and two private test uploads; existing business records remain read-only. Real PC scanner results only; no payment provider call or scanner attestation override.",
  checks: [],
  limitations: [
    "The synthetic citizen, private uploads and immutable audit events are retained for inspection.",
    "A harmless standard antivirus fixture tests detection; it does not prove detection of every possible threat.",
    "Hosted checks exercise HTTP boundaries and actual PC scanning. Database tamper/concurrency and bilingual mobile component checks are covered by the local suite.",
  ],
};
function save() {
  if (output)
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
}
function savePrivate() {
  assert.ok(fixture && fixture.baseUrl === base);
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2) + "\n", {
    mode: 0o600,
  });
}
function status(response: Reply, expected: number) {
  assert.equal(response.status, expected);
}
async function check(name: string, operation: () => Promise<void>) {
  stage = name;
  try {
    await operation();
    evidence.checks.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch {
    evidence.checks.push({ name, status: "FAIL" });
    throw Error("Hosted attachment check failed; sensitive response withheld.");
  } finally {
    save();
  }
}
function allowed(method: string, route: string, body: any, role?: string) {
  if (["/auth/login", "/auth/logout"].includes(route) && method === "POST")
    return;
  if (method === "POST" && route === "/internal/attachment-scans/claim") return;
  if (
    method === "GET" &&
    ["/auth/me", "/wallet", "/payments/configuration"].includes(route)
  )
    return;
  if (
    method === "GET" &&
    /^\/geography\/wards\?parentCode=[A-Za-z0-9_-]+$/.test(route)
  )
    return;
  if (
    method === "GET" &&
    [
      `/applications/${fixture.baselineApplicationId}`,
      `/certificates/${fixture.baselineCertificateId}/pdf`,
    ].includes(route)
  )
    return;
  const handles = Object.values(fixture.files ?? {}) as any[];
  if (
    handles.some(
      (file) =>
        method === "GET" &&
        [
          `/attachments/${file.attachmentId}`,
          `/attachments/${file.attachmentId}/status`,
        ].includes(route),
    )
  )
    return;
  if (
    phase === "verify" &&
    method === "POST" &&
    route === `/attachments/${fixture.files?.threat?.attachmentId}/retry` &&
    Object.keys(body ?? {}).length === 0 &&
    role === "staff"
  )
    return;
  if (phase === "prepare" && role === "staff") {
    if (
      method === "POST" &&
      route === "/citizens" &&
      body.syntheticReference === fixture.syntheticReference &&
      !fixture.citizenId
    )
      return;
    if (
      method === "POST" &&
      route === "/attachments" &&
      body.citizenId === fixture.citizenId &&
      body.mimeType === "application/pdf"
    )
      return;
  }
  throw Error("Hosted attachment request is outside the reviewed scope.");
}
async function request(
  method: string,
  route: string,
  role?: string,
  body?: unknown,
  scannerHeaders?: Record<string, string>,
): Promise<Reply> {
  allowed(method, route, body, role);
  const s = role ? sessions[role] : undefined;
  const scanner = route === "/internal/attachment-scans/claim";
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(45000),
    headers: {
      ...(scanner ? {} : { Origin: base }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(s ? { Cookie: s.cookie, "X-CSRF-Token": s.csrf } : {}),
      ...scannerHeaders,
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
async function login(
  role: string,
  account: any,
  expectedRole: string,
  expectedTenant: string,
) {
  assert.ok(
    typeof account?.email === "string" && typeof account?.password === "string",
  );
  const r = await request("POST", "/auth/login", undefined, {
    email: account.email,
    password: account.password,
  });
  status(r, 200);
  assert.equal(r.body.user.role, expectedRole);
  assert.equal(r.body.user.tenantId, expectedTenant);
  const cookie = r.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  sessions[role] = {
    cookie: cookie.split(";")[0]!,
    csrf: r.body.csrfToken,
    user: r.body.user,
  };
}
function cleanPdf() {
  const stream =
    "BT /F1 12 Tf 20 60 Td (Astra synthetic attachment QA only.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
async function baseline() {
  const wallet = await request("GET", "/wallet", "admin");
  status(wallet, 200);
  const application = await request(
    "GET",
    `/applications/${fixture.baselineApplicationId}`,
    "admin",
  );
  status(application, 200);
  const pdf = await request(
    "GET",
    `/certificates/${fixture.baselineCertificateId}/pdf`,
    "admin",
  );
  status(pdf, 200);
  assert.ok(Buffer.isBuffer(pdf.body));
  return {
    wallet: hash(JSON.stringify(wallet.body)),
    application: hash(JSON.stringify(application.body)),
    pdf: hash(pdf.body),
  };
}
async function paymentsDisabled() {
  const r = await request("GET", "/payments/configuration", "admin");
  status(r, 200);
  assert.equal(r.body.available, false);
  assert.equal(r.body.configured, false);
  assert.equal(r.body.environment, "DISABLED");
  assert.equal(r.body.bankSettlement, "NOT_CONNECTED");
  assert.equal(r.body.nagad.configured, false);
}
async function boundaries() {
  for (const file of Object.values(fixture.files) as Handle[]) {
    for (const suffix of ["", "/status"]) {
      status(
        await request("GET", `/attachments/${file.attachmentId}${suffix}`),
        401,
      );
      status(
        await request(
          "GET",
          `/attachments/${file.attachmentId}${suffix}`,
          "foreign",
        ),
        404,
      );
    }
  }
  // A session cookie is deliberately tested without Origin so rejection proves
  // it cannot replace the isolated scanner capability. Never call finish.
  status(
    await request("POST", "/internal/attachment-scans/claim", undefined, {}),
    401,
  );
  status(
    await request("POST", "/internal/attachment-scans/claim", "staff", {}),
    401,
  );
  status(
    await request(
      "POST",
      "/internal/attachment-scans/claim",
      undefined,
      {},
      { Authorization: `Bearer ${"0".repeat(64)}` },
    ),
    401,
  );
}
async function upload(label: "clean" | "threat", bytes: Buffer) {
  assert.ok(!fixture.files[label]);
  fixture.attempts.push({
    operation: `upload-${label}`,
    at: new Date().toISOString(),
  });
  savePrivate();
  const r = await request("POST", "/attachments", "staff", {
    citizenId: fixture.citizenId,
    mimeType: "application/pdf",
    base64: bytes.toString("base64"),
  });
  status(r, 201);
  assert.match(r.body.attachmentId, uuid);
  assert.equal(r.body.mimeType, "application/pdf");
  assert.equal(r.body.byteLength, bytes.length);
  fixture.files[label] = {
    attachmentId: r.body.attachmentId,
    mimeType: r.body.mimeType,
    byteLength: r.body.byteLength,
    sha256: hash(bytes),
  };
  savePrivate();
  assert.equal(r.body.scanState, "QUARANTINED");
  assert.equal(r.body.downloadAllowed, false);
  assert.equal(r.body.retryAllowed, false);
}
async function prepare() {
  await check("Create exactly one named synthetic citizen", async () => {
    const me = await request("GET", "/auth/me", "staff");
    status(me, 200);
    let geography: any;
    if (me.body.tenant?.divisionCode) {
      const t = me.body.tenant;
      assert.ok(t.unionCode);
      const wards = await request(
        "GET",
        `/geography/wards?parentCode=${encodeURIComponent(t.unionCode)}`,
      );
      status(wards, 200);
      assert.ok(wards.body.items.length);
      geography = {
        divisionCode: t.divisionCode,
        districtCode: t.districtCode,
        upazilaCode: t.upazilaCode,
        unionCode: t.unionCode,
        wardCode: wards.body.items[0].code,
      };
    }
    fixture.attempts.push({
      operation: "create-synthetic-citizen",
      at: new Date().toISOString(),
    });
    savePrivate();
    const r = await request("POST", "/citizens", "staff", {
      nameBn: "সংযুক্তি পরীক্ষার নমুনা নাগরিক",
      nameEn: "Synthetic Attachment QA Citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "শুধুমাত্র নিরাপত্তা পরীক্ষার কাল্পনিক ঠিকানা",
      addressEn: "Synthetic security test address only",
      syntheticReference: fixture.syntheticReference,
      ...(geography ? { geography } : {}),
    });
    status(r, 201);
    assert.match(r.body.id, uuid);
    fixture.citizenId = r.body.id;
    savePrivate();
  });
  await check(
    "Upload clean and embedded antivirus PDFs directly into quarantine",
    async () => {
      const clean = cleanPdf(),
        threat = antivirusPdfFixture();
      try {
        await upload("clean", clean);
        await upload("threat", threat);
      } finally {
        clean.fill(0);
        threat.fill(0);
      }
    },
  );
  await check(
    "Paused scanner leaves both private files quarantined and downloads denied",
    async () => {
      for (const file of Object.values(fixture.files) as Handle[]) {
        const state = await request(
          "GET",
          `/attachments/${file.attachmentId}/status`,
          "staff",
        );
        status(state, 200);
        assert.equal(state.body.scanState, "QUARANTINED");
        assert.equal(state.body.downloadAllowed, false);
        const download = await request(
          "GET",
          `/attachments/${file.attachmentId}`,
          "staff",
        );
        status(download, 409);
        assert.equal(download.body.error.code, "ATTACHMENT_NOT_READY");
      }
    },
  );
  fixture.preparedAt = new Date().toISOString();
  fixture.preparationStatus = "PREPARED";
  evidence.status = "PREPARED";
  evidence.nextStep =
    "Start the authorized real PC scanner, then run this script with verify. No scanner capability is used by this verifier.";
}
async function verify() {
  await check(
    "Actual PC scanner releases clean bytes and rejects the embedded antivirus fixture",
    async () => {
      const seconds = Number(
        process.env.ASTRA_ATTACHMENT_WAIT_SECONDS ?? "300",
      );
      assert.ok(Number.isInteger(seconds) && seconds >= 0 && seconds <= 900);
      const deadline = Date.now() + seconds * 1000;
      let lastProgress = 0;
      for (;;) {
        const states: Record<string, any> = {};
        for (const label of ["clean", "threat"] as const) {
          const r = await request(
            "GET",
            `/attachments/${fixture.files[label].attachmentId}/status`,
            "staff",
          );
          status(r, 200);
          states[label] = r.body;
          assert.equal(r.body.attachmentId, fixture.files[label].attachmentId);
          assert.equal(r.body.mimeType, fixture.files[label].mimeType);
          assert.equal(r.body.byteLength, fixture.files[label].byteLength);
          assert.ok(
            ["QUARANTINED", "SCANNING", "CLEAN", "REJECTED", "ERROR"].includes(
              r.body.scanState,
            ),
          );
        }
        assert.notEqual(states.clean.scanState, "REJECTED");
        assert.notEqual(states.threat.scanState, "CLEAN");
        if (
          states.clean.scanState === "CLEAN" &&
          states.threat.scanState === "REJECTED"
        ) {
          assert.equal(states.clean.downloadAllowed, true);
          assert.equal(states.threat.downloadAllowed, false);
          assert.equal(states.threat.retryAllowed, false);
          assert.equal(states.threat.reasonCode, "UNSAFE_FILE");
          assert.ok(states.clean.scannedAt && states.threat.scannedAt);
          break;
        }
        if (Date.now() >= deadline)
          throw Error(
            "Real worker results not ready within the allowed verification window.",
          );
        if (Date.now() - lastProgress > 30000) {
          console.log(
            "Waiting for the real PC scanner; files remain protected.",
          );
          lastProgress = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      const clean = await request(
        "GET",
        `/attachments/${fixture.files.clean.attachmentId}`,
        "staff",
      );
      status(clean, 200);
      assert.ok(Buffer.isBuffer(clean.body));
      assert.equal(hash(clean.body), fixture.files.clean.sha256);
      assert.equal(clean.body.length, fixture.files.clean.byteLength);
      assert.match(clean.headers.get("cache-control") ?? "", /no-store/);
      assert.equal(clean.headers.get("x-content-type-options"), "nosniff");
      assert.match(
        clean.headers.get("content-disposition") ?? "",
        /^attachment;/,
      );
      clean.body.fill(0);
      const denied = await request(
        "GET",
        `/attachments/${fixture.files.threat.attachmentId}`,
        "staff",
      );
      status(denied, 409);
      assert.equal(denied.body.error.code, "ATTACHMENT_NOT_READY");
      const retry = await request(
        "POST",
        `/attachments/${fixture.files.threat.attachmentId}/retry`,
        "staff",
        {},
      );
      status(retry, 409);
      assert.equal(retry.body.error.code, "ATTACHMENT_RETRY_DENIED");
      const rejected = await request(
        "GET",
        `/attachments/${fixture.files.threat.attachmentId}/status`,
        "staff",
      );
      status(rejected, 200);
      assert.equal(rejected.body.scanState, "REJECTED");
    },
  );
  fixture.verifiedAt = new Date().toISOString();
  evidence.status = "PASS";
}
async function main() {
  assert.ok(
    phase === "prepare" || phase === "verify",
    "Usage: verify-hosted-attachments.ts prepare|verify",
  );
  const target = new URL(process.env.ASTRA_LIVE_URL ?? "");
  assert.equal(target.protocol, "https:");
  assert.equal(target.pathname, "/");
  assert.equal(
    target.username + target.password + target.search + target.hash,
    "",
  );
  base = target.origin;
  assert.equal(read(".runtime/hosted/credentials.json").publicOrigin, base);
  const source = read("execution/hosted-orders-qa.json"),
    original = read("execution/hosted-qa.json"),
    runs = read(".runtime/hosted/qa-credentials.json").runs;
  assert.equal(source.status, "PASS");
  assert.equal(original.status, "PASS");
  const primary = runs.find((r: any) => r.runId === source.runId),
    foreign = runs.find((r: any) => r.runId === original.runId);
  assert.equal(primary.kind, "HOSTED_ORDERS_QA");
  for (const run of [primary, foreign]) {
    assert.equal(run.baseUrl, base);
    assert.equal(run.lastStatus, "PASS");
  }
  assert.ok(foreign.accounts.otheradmin && foreign.offices.isolation);
  assert.notEqual(primary.offices.primary.id, foreign.offices.isolation.id);
  if (phase === "prepare") {
    assert.ok(
      !fs.existsSync(fixtureFile),
      "A private attachment QA run already exists. Preserve and review it before any new prepare run; mutations are never retried automatically.",
    );
    const id = `${Date.now()}-${randomBytes(3).toString("hex")}`;
    fixture = {
      kind: "HOSTED_ATTACHMENT_QA",
      baseUrl: base,
      runId: id,
      sourceRunId: primary.runId,
      foreignRunId: foreign.runId,
      syntheticReference: `REF-ATT-${id}`,
      tenantId: primary.offices.primary.id,
      baselineApplicationId: primary.applications.positive,
      baselineCertificateId: primary.certificateId,
      files: {},
      attempts: [],
      preparationStatus: "RUNNING",
    };
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  } else {
    fixture = read(fixtureFile);
    assert.equal(fixture.kind, "HOSTED_ATTACHMENT_QA");
    assert.equal(fixture.baseUrl, base);
    assert.equal(fixture.sourceRunId, primary.runId);
    assert.equal(fixture.foreignRunId, foreign.runId);
    assert.equal(fixture.preparationStatus, "PREPARED");
    for (const label of ["clean", "threat"])
      assert.match(fixture.files[label].attachmentId, uuid);
  }
  output = qaOutput(
    phase === "prepare"
      ? "attachments-hosted-prepare.json"
      : "attachments-hosted-qa.json",
  );
  fs.mkdirSync("execution", { recursive: true });
  evidence.baseUrl = base;
  save();
  await check(
    "Authenticate only existing synthetic QA staff, admin and foreign admin",
    async () => {
      await login(
        "staff",
        primary.accounts.staff,
        "staff",
        primary.offices.primary.id,
      );
      await login(
        "admin",
        primary.accounts.admin,
        "admin",
        primary.offices.primary.id,
      );
      await login(
        "foreign",
        foreign.accounts.otheradmin,
        "admin",
        foreign.offices.isolation.id,
      );
    },
  );
  if (phase === "prepare") {
    fixture.baseline = await baseline();
    savePrivate();
  } else assert.deepEqual(await baseline(), fixture.baseline);
  await check(
    "Payment gateways remain disabled and no provider is called",
    paymentsDisabled,
  );
  if (phase === "prepare") await prepare();
  else await verify();
  await check(
    "Unauthenticated, foreign-tenant and cookie-only scanner access are denied",
    boundaries,
  );
  await check(
    "Existing QA application, PDF and wallet remain unchanged",
    async () => assert.deepEqual(await baseline(), fixture.baseline),
  );
  evidence.syntheticRecords = {
    citizens: 1,
    privateUploads: 2,
    newApplications: 0,
    paymentAttempts: 0,
    certificates: 0,
    creditDebits: 0,
  };
}
try {
  await main();
} catch {
  evidence.status = "FAIL";
  evidence.failedStage = stage;
  process.exitCode = 1;
  console.error(
    "Hosted attachment verification failed; credentials, IDs, fixture bytes and response values were withheld. Inspect sanitized evidence and the private run record; do not automatically repeat preparation.",
  );
} finally {
  let closed = 0;
  for (const role of Object.keys(sessions))
    try {
      const r = await request("POST", "/auth/logout", role, {});
      if ([200, 401].includes(r.status)) closed++;
    } catch {
      /* No automatic mutation retry. */
    }
  evidence.sessionsClosed = closed;
  evidence.sessionsOpened = Object.keys(sessions).length;
  if (closed !== Object.keys(sessions).length) {
    evidence.status = "FAIL";
    evidence.cleanup = "SESSION_CLEANUP_REQUIRES_REVIEW";
    process.exitCode = 1;
  }
  if (fixture) {
    fixture.lastPhase = phase;
    fixture.lastStatus = evidence.status;
    savePrivate();
  }
  evidence.finishedAt = new Date().toISOString();
  save();
}
