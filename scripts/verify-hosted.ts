/**
 * Real hosted HTTP smoke test. Creates only dedicated synthetic QA offices.
 * PowerShell: $env:ASTRA_LIVE_URL='https://your-app.onrender.com'; npx tsx scripts/verify-hosted.ts
 * Required ignored file: .runtime/hosted/credentials.json { ownerEmail, ownerPassword, publicOrigin }
 * PDF rendering requires Python with pypdf and pypdfium2; set ASTRA_QA_PYTHON if needed.
 * Never retries mutations: after an ambiguous network failure inspect the saved run before rerunning.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import type { QRCode } from "jsqr";
import { getDemoPayload } from "@astra/shared-schemas";

const jsQR = createRequire(import.meta.url)("jsqr") as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts: string },
) => QRCode | null;
const supplied = process.env.ASTRA_LIVE_URL;
assert.ok(supplied, "Set ASTRA_LIVE_URL to the deployed HTTPS origin.");
const live = new URL(supplied);
assert.equal(live.protocol, "https:", "Hosted QA requires HTTPS.");
assert.equal(live.username + live.password + live.search + live.hash, "");
assert.equal(live.pathname, "/", "Use the origin without a path.");
const base = live.origin;
const privateDir = path.resolve(".runtime/hosted");
const credentials = JSON.parse(
  fs.readFileSync(path.join(privateDir, "credentials.json"), "utf8"),
);
assert.ok(
  typeof credentials.ownerEmail === "string" &&
    typeof credentials.ownerPassword === "string" &&
    typeof credentials.publicOrigin === "string",
  "Owner credentials or publicOrigin are missing from the ignored credentials file.",
);
assert.equal(
  base,
  credentials.publicOrigin,
  "ASTRA_LIVE_URL must match the authorized publicOrigin stored with these owner credentials.",
);
const bundled = path.join(
  process.env.USERPROFILE ?? "",
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe",
);
const python =
  process.env.ASTRA_QA_PYTHON ?? (fs.existsSync(bundled) ? bundled : "python");
// Fail locally before credentials are transmitted or synthetic accounts are created.
const pdfPreflight = spawnSync(
  python,
  ["-c", "import pypdf, pypdfium2; from PIL import Image"],
  { encoding: "utf8", timeout: 30_000, windowsHide: true },
);
assert.equal(
  pdfPreflight.status,
  0,
  "PDF prerequisites unavailable. Set ASTRA_QA_PYTHON to Python with pypdf, pypdfium2 and Pillow before running hosted QA.",
);
const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
const startedAt = new Date().toISOString();
fs.mkdirSync("execution", { recursive: true });
const resultFile = "execution/hosted-qa.json";
const result: any = {
  runId,
  baseUrl: base,
  startedAt,
  status: "RUNNING",
  mode: "SYNTHETIC_DEMO_ONLY",
  preflight: { authorizedOriginMatched: true, pdfPythonImports: true },
  checks: [],
  artifacts: {},
  limitations: [
    "Synthetic accounts and zero-money sandbox settlement only.",
    "No external identity, payment, email, SMS or official certificate authority was exercised.",
    "Created QA offices and immutable audit/ledger records are retained for inspection.",
  ],
};
const save = () =>
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
save();
type Session = { cookie: string; csrf: string; user: any };
type Response = { status: number; headers: Headers; body: any };
const sessions: Record<string, Session> = {};
const password = () => `${randomBytes(24).toString("base64url")}!Qa7`;
const roles = [
  "admin",
  "otheradmin",
  "reviewer",
  "approver",
  "finance",
  "citizen",
];
const qa: any = {
  runId,
  baseUrl: base,
  createdAt: startedAt,
  offices: {},
  accounts: Object.fromEntries(
    roles.map((role) => [
      role,
      { email: `hosted-${role}-${runId}@synthetic.test`, password: password() },
    ]),
  ),
};
const qaFile = path.join(privateDir, "qa-credentials.json");
const prior = fs.existsSync(qaFile)
  ? JSON.parse(fs.readFileSync(qaFile, "utf8"))
  : { runs: [] };
assert.ok(
  Array.isArray(prior.runs),
  "Existing QA credential file has an unexpected format; preserve it before proceeding.",
);
prior.runs.push(qa);
const savePrivate = () =>
  fs.writeFileSync(qaFile, JSON.stringify(prior, null, 2), { mode: 0o600 });
savePrivate();
async function request(
  method: string,
  route: string,
  data?: unknown,
  session?: Session,
  csrf = true,
): Promise<Response> {
  assert.ok(route.startsWith("/") && !route.startsWith("//"));
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
    headers: {
      Origin: base,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? {
            Cookie: session.cookie,
            ...(csrf ? { "X-CSRF-Token": session.csrf } : {}),
          }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
  };
}
function status(
  response: Response,
  expected: number | number[],
  label: string,
) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert.ok(
    allowed.includes(response.status),
    `${label}: HTTP ${response.status}; API code ${response.body?.error?.code ?? "none"}; expected ${allowed.join(" or ")}`,
  );
}
async function check(name: string, run: () => Promise<unknown>) {
  const start = Date.now();
  try {
    const evidence = await run();
    result.checks.push({
      name,
      status: "PASS",
      durationMs: Date.now() - start,
      ...(evidence ? { evidence } : {}),
    });
    save();
    console.log(`PASS ${name}`);
  } catch (error) {
    // Assertions contain only intentionally selected, non-secret evidence.
    const message =
      error instanceof Error ? error.message : "Unknown hosted QA error";
    result.checks.push({
      name,
      status: "FAIL",
      durationMs: Date.now() - start,
      message,
    });
    save();
    throw new Error(`${name}: ${message}`);
  }
}
async function login(key: string, email: string, pw: string) {
  const r = await request("POST", "/auth/login", { email, password: pw });
  status(r, 200, `${key} sign-in`);
  const cookie = r.headers.get("set-cookie");
  assert.ok(cookie, "Hosted login must return a session cookie.");
  assert.ok(
    cookie.includes("HttpOnly") &&
      cookie.includes("Secure") &&
      cookie.includes("SameSite=Strict"),
    "Hosted session cookie must be Secure, HttpOnly and SameSite=Strict.",
  );
  assert.ok(
    typeof r.body.csrfToken === "string" && r.body.csrfToken.length >= 32,
  );
  sessions[key] = {
    cookie: cookie.split(";")[0]!,
    csrf: r.body.csrfToken,
    user: r.body.user,
  };
  return r.body;
}
async function loginQa(key: string) {
  return login(key, qa.accounts[key].email, qa.accounts[key].password);
}
async function createOffice(kind: "primary" | "isolation", key: string) {
  const r = await request(
    "POST",
    "/owner/tenants",
    {
      slug: `hosted-qa-${kind === "primary" ? "a" : "b"}-${runId}`,
      nameBn: "হোস্টেড কিউএ পরীক্ষামূলক অফিস",
      nameEn: `HOSTED QA DEMO ${kind} ${runId}`,
      division: "DEMO Test Division",
      district: "DEMO Test District",
      upazila: "DEMO Test Upazila",
      officeType: "UNION",
      adminEmail: qa.accounts[key].email,
      adminName: "Hosted QA Synthetic Admin",
      adminPassword: qa.accounts[key].password,
    },
    sessions.owner,
  );
  status(r, 201, `Create ${kind} QA office`);
  qa.offices[kind] = { id: r.body.id, slug: r.body.slug };
  savePrivate();
  return r.body;
}
let primary: any,
  isolation: any,
  citizen: any,
  application: any,
  certificate: any;
let initialBalance = 0,
  cost = 3;
try {
  await check("01 HTTPS health, frontend and security headers", async () => {
    let health: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        health = await request("GET", "/health");
      } catch {
        /* Cold start: read-only retry. */
      }
      if (health?.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    assert.ok(health, "Hosted health did not respond.");
    status(health, 200, "PostgreSQL health");
    assert.equal(health.body.database, "PostgreSQL");
    assert.equal(health.body.mode, "DEMO_ONLY");
    const home = await fetch(base, {
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.ok(home.headers.get("strict-transport-security"));
    assert.ok(home.headers.get("content-security-policy"));
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    assert.match(await home.text(), /<script[^>]+type="module"/);
    return {
      database: "PostgreSQL",
      frontend: "HTML with module bundle",
      httpsHeaders: true,
    };
  });
  await check(
    "02 Public catalog and all 47 operational schemas respond",
    async () => {
      const catalog = await request("GET", "/services");
      status(catalog, 200, "Catalog");
      assert.equal(catalog.body.items.length, 47);
      const numbers = catalog.body.items
        .map((item: any) => item.service_no)
        .sort((a: number, b: number) => a - b);
      assert.deepEqual(
        numbers,
        Array.from({ length: 47 }, (_, index) => index + 1),
      );
      const versions: { serviceNo: number; version: number }[] = [];
      for (let start = 0; start < numbers.length; start += 4) {
        const schemas = await Promise.all(
          numbers.slice(start, start + 4).map(async (no: number) => {
            const schema = await request("GET", `/services/${no}/schema`);
            status(schema, 200, `Service ${no} schema`);
            assert.equal(schema.body.stage, "operational_demo");
            assert.equal(schema.body.serviceNo, no);
            assert.ok(
              Number.isInteger(schema.body.version) && schema.body.version > 0,
            );
            return { serviceNo: no, version: schema.body.version as number };
          }),
        );
        versions.push(...schemas);
      }
      return {
        services: 47,
        fetchedOperationalSchemas: versions.length,
        exercisedServiceNo: 45,
        schemaVersions: versions,
      };
    },
  );
  await check(
    "03 Owner onboarding starts isolated offices at zero and inactive subscription",
    async () => {
      const owner = await login(
        "owner",
        credentials.ownerEmail,
        credentials.ownerPassword,
      );
      assert.equal(owner.user.role, "owner");
      primary = await createOffice("primary", "admin");
      isolation = await createOffice("isolation", "otheradmin");
      await loginQa("admin");
      await loginQa("otheradmin");
      for (const key of ["admin", "otheradmin"]) {
        const wallet = await request(
          "GET",
          "/wallet",
          undefined,
          sessions[key],
        );
        status(wallet, 200, `${key} initial wallet`);
        assert.equal(wallet.body.balance, 0);
        assert.equal(wallet.body.subscription.status, "EXPIRED");
      }
      result.qaOfficeIds = [primary.id, isolation.id];
      save();
      return {
        primaryOfficeId: primary.id,
        isolationOfficeId: isolation.id,
        startingCredits: 0,
        subscription: "EXPIRED",
      };
    },
  );
  await check(
    "04 Admin provisions distinct roles and service configuration",
    async () => {
      for (const role of ["reviewer", "approver", "finance"]) {
        const r = await request(
          "POST",
          "/admin/users",
          { ...qa.accounts[role], displayName: `Hosted QA ${role}`, role },
          sessions.admin,
        );
        status(r, 201, `Create ${role}`);
        await loginQa(role);
        assert.equal(sessions[role]!.user.role, role);
      }
      const configured = await request(
        "PATCH",
        "/admin/services/45",
        { enabled: true, creditCost: cost },
        sessions.admin,
      );
      status(configured, 200, "Service cost");
      assert.equal(configured.body.creditCost, cost);
      return {
        roles: ["admin", "reviewer", "approver", "finance"],
        serviceCost: cost,
      };
    },
  );
  await check("05 Citizen signup and own profile persist", async () => {
    const r = await request("POST", "/auth/signup", {
      ...qa.accounts.citizen,
      displayName: "Hosted QA Synthetic Citizen",
      tenantId: primary.id,
      nameBn: "পরীক্ষামূলক নাগরিক",
      nameEn: "Hosted QA Synthetic Citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "কাল্পনিক পরীক্ষামূলক ঠিকানা",
      addressEn: "Synthetic hosted QA address only",
      syntheticReference: `DEMO-HOSTED-${runId}`,
    });
    status(r, 201, "Citizen signup");
    assert.equal(r.body.verificationState, "SYNTHETIC_DEMO");
    await loginQa("citizen");
    const profile = await request(
      "PATCH",
      "/profile",
      { displayName: "Hosted QA Profile Updated" },
      sessions.citizen,
    );
    status(profile, 200, "Save own profile");
    const saved = await request("GET", "/profile", undefined, sessions.citizen);
    status(saved, 200, "Read own profile");
    assert.equal(saved.body.displayName, "Hosted QA Profile Updated");
    const c = await request("GET", "/citizens", undefined, sessions.citizen);
    status(c, 200, "Own applicant");
    assert.equal(c.body.items.length, 1);
    citizen = c.body.items[0];
    return { citizenId: citizen.id, syntheticOnly: true };
  });
  await check(
    "06 Invalid schema, unauthorized billing and missing CSRF are rejected",
    async () => {
      status(
        await request(
          "POST",
          "/applications",
          { citizenId: citizen.id, serviceNo: 45, payload: {} },
          sessions.citizen,
        ),
        422,
        "Incomplete form",
      );
      status(
        await request(
          "POST",
          "/billing/orders",
          { kind: "topup", credits: 10 },
          sessions.citizen,
        ),
        403,
        "Citizen billing denied",
      );
      status(
        await request(
          "PATCH",
          "/profile",
          { displayName: "Must not save" },
          sessions.citizen,
          false,
        ),
        403,
        "Missing CSRF denied",
      );
      return { invalidForm: 422, unauthorizedBilling: 403, missingCsrf: 403 };
    },
  );
  await check("07 Valid dynamic form persists as a private draft", async () => {
    const r = await request(
      "POST",
      "/applications",
      { citizenId: citizen.id, serviceNo: 45, payload: getDemoPayload(45) },
      sessions.citizen,
    );
    status(r, 201, "Create application");
    application = r.body;
    assert.equal(application.state, "DRAFT");
    const saved = await request(
      "GET",
      `/applications/${application.id}`,
      undefined,
      sessions.citizen,
    );
    status(saved, 200, "Load draft");
    assert.deepEqual(saved.body.payload, getDemoPayload(45));
    status(
      await request("GET", `/track/${application.id}`),
      404,
      "Draft tracking hidden",
    );
    return {
      applicationId: application.id,
      state: "DRAFT",
      pinnedSchemaVersion: application.schemaVersion,
    };
  });
  await check(
    "08 Tenant isolation and unauthenticated private reads are denied",
    async () => {
      status(
        await request(
          "GET",
          `/applications/${application.id}`,
          undefined,
          sessions.otheradmin,
        ),
        404,
        "Cross-tenant application read",
      );
      status(
        await request("GET", `/applications/${application.id}`),
        401,
        "Anonymous application read",
      );
      const list = await request(
        "GET",
        `/applications?q=${application.id}`,
        undefined,
        sessions.otheradmin,
      );
      status(list, 200, "Other office list");
      assert.equal(list.body.items.length, 0);
      return { crossTenantRead: 404, anonymousRead: 401, isolatedListCount: 0 };
    },
  );
  const transition = (action: string, role: string) =>
    request(
      "POST",
      `/applications/${application.id}/transition`,
      { action },
      sessions[role],
    );
  await check(
    "09 Submit and review enforce state and role boundaries",
    async () => {
      status(
        await transition("review", "reviewer"),
        409,
        "Cannot review draft",
      );
      status(await transition("submit", "citizen"), 200, "Submit");
      status(
        await transition("review", "citizen"),
        403,
        "Citizen cannot review",
      );
      const reviewed = await transition("review", "reviewer");
      status(reviewed, 200, "Reviewer review");
      assert.equal(reviewed.body.state, "UNDER_REVIEW");
      status(
        await transition("approve", "approver"),
        403,
        "Ungrant approver denied",
      );
      return { resultingState: "UNDER_REVIEW", ungrantedApprover: 403 };
    },
  );
  await check(
    "10 Explicit service approval grant authorizes final approval",
    async () => {
      const grant = await request(
        "PUT",
        `/admin/authorizations/${sessions.approver!.user.id}/45`,
        {
          active: true,
          authorityNote:
            "Synthetic hosted QA authorization only; no official authority.",
        },
        sessions.admin,
      );
      status(grant, 200, "DEMO service approval grant");
      const approved = await transition("approve", "approver");
      status(approved, 200, "Approve latest payload");
      assert.equal(approved.body.state, "APPROVED");
      status(
        await request(
          "POST",
          `/applications/${application.id}/issue`,
          {},
          sessions.citizen,
        ),
        403,
        "Citizen cannot issue",
      );
      return {
        state: "APPROVED",
        approvedVersion: approved.body.approvedVersion,
        serviceSpecificGrant: true,
      };
    },
  );
  await check(
    "11 Inactive subscription blocks issuance without charging",
    async () => {
      const blocked = await request(
        "POST",
        `/applications/${application.id}/issue`,
        {},
        sessions.approver,
      );
      status(blocked, 402, "Inactive subscription issuance");
      assert.equal(blocked.body.error.code, "SUBSCRIPTION_INACTIVE");
      const wallet = await request(
        "GET",
        "/wallet",
        undefined,
        sessions.finance,
      );
      status(wallet, 200, "Wallet after blocked issuance");
      assert.equal(wallet.body.balance, 0);
      assert.equal(wallet.body.ledger.length, 0);
      const saved = await request(
        "GET",
        `/applications/${application.id}`,
        undefined,
        sessions.citizen,
      );
      status(saved, 200, "Approved application retained");
      assert.equal(saved.body.application.state, "APPROVED");
      return {
        status: 402,
        balance: 0,
        ledgerEntries: 0,
        applicationRetained: "APPROVED",
      };
    },
  );
  await check(
    "12 Sandbox subscription and top-up settle once and produce invoices",
    async () => {
      const billing = await request(
        "GET",
        "/billing",
        undefined,
        sessions.finance,
      );
      status(billing, 200, "Billing plans");
      const plan = billing.body.plans.find((p: any) => p.id === "demo-monthly");
      assert.ok(plan);
      assert.equal(plan.priceMinor, 0);
      for (const body of [
        { kind: "subscription", planId: "demo-monthly" },
        { kind: "topup", credits: 7 },
      ]) {
        const order = await request(
          "POST",
          "/billing/orders",
          body,
          sessions.finance,
        );
        status(order, 201, "Create zero-value sandbox order");
        assert.equal(order.body.amountMinor, 0);
        const settle = await request(
          "POST",
          `/billing/orders/${order.body.id}/demo-settle`,
          {},
          sessions.finance,
        );
        status(settle, 200, "Settle sandbox order");
        assert.equal(settle.body.replayed, false);
        const replay = await request(
          "POST",
          `/billing/orders/${order.body.id}/demo-settle`,
          {},
          sessions.finance,
        );
        status(replay, 200, "Replay sandbox settlement");
        assert.equal(replay.body.replayed, true);
      }
      const wallet = await request(
        "GET",
        "/wallet",
        undefined,
        sessions.finance,
      );
      status(wallet, 200, "Funded wallet");
      initialBalance = plan.grantCredits + 7;
      assert.equal(wallet.body.balance, initialBalance);
      assert.equal(wallet.body.ledger.length, 2);
      assert.equal(wallet.body.subscription.status, "ACTIVE");
      const saved = await request(
        "GET",
        "/billing",
        undefined,
        sessions.finance,
      );
      status(saved, 200, "Saved billing invoices");
      assert.equal(saved.body.invoices.length, 2);
      return {
        monetaryAmountMinor: 0,
        balance: initialBalance,
        ledgerEntries: 2,
        invoices: 2,
        replayedSettlement: true,
      };
    },
  );
  await check(
    "13 Concurrent issuance and retry return one certificate with exactly one debit",
    async () => {
      const attempts = await Promise.all(
        [1, 2].map(() =>
          request(
            "POST",
            `/applications/${application.id}/issue`,
            {},
            sessions.approver,
          ),
        ),
      );
      for (const r of attempts) status(r, [200, 201], "Concurrent issue");
      certificate = attempts[0]!.body;
      assert.equal(attempts[1]!.body.id, certificate.id);
      assert.equal(certificate.demo, true);
      const replay = await request(
        "POST",
        `/applications/${application.id}/issue`,
        {},
        sessions.approver,
      );
      status(replay, 200, "Issue retry");
      assert.equal(replay.body.id, certificate.id);
      const wallet = await request(
        "GET",
        "/wallet",
        undefined,
        sessions.finance,
      );
      status(wallet, 200, "Post-issuance wallet");
      const debits = wallet.body.ledger.filter(
        (entry: any) => entry.kind === "ISSUANCE",
      );
      assert.equal(debits.length, 1);
      assert.equal(debits[0].delta, -cost);
      assert.equal(wallet.body.balance, initialBalance - cost);
      return {
        certificateId: certificate.id,
        concurrentResponses: attempts.map((r) => r.status),
        replayStatus: replay.status,
        balanceBefore: initialBalance,
        balanceAfter: wallet.body.balance,
        issuanceEntries: 1,
        deductedCredits: cost,
      };
    },
  );
  await check(
    "14 Private PDF downloads; rendered QR resolves to minimal public verification",
    async () => {
      const route = certificate.pdfUrl.replace(/^\/api\/v1/, "");
      status(await request("GET", route), 401, "Anonymous PDF denied");
      status(
        await request("GET", route, undefined, sessions.otheradmin),
        404,
        "Other tenant PDF denied",
      );
      const pdf = await request("GET", route, undefined, sessions.citizen);
      status(pdf, 200, "Applicant PDF");
      assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);
      assert.ok(Buffer.isBuffer(pdf.body));
      assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.body.length > 10_000);
      const pdfPath = "execution/hosted-demo-certificate.pdf",
        pngPath = "execution/hosted-demo-certificate.png";
      fs.writeFileSync(pdfPath, pdf.body);
      const rendered = spawnSync(
        python,
        [
          "-c",
          "import sys,json; from pypdf import PdfReader; import pypdfium2 as p; r=PdfReader(sys.argv[1]); text='\\n'.join(x.extract_text() or '' for x in r.pages); assert 'DEMO / NOT OFFICIAL' in text; assert len(r.pages)==1; d=p.PdfDocument(sys.argv[1]); d[0].render(scale=2).to_pil().save(sys.argv[2]); print(json.dumps({'pages':len(r.pages),'watermark':True}))",
          pdfPath,
          pngPath,
        ],
        { encoding: "utf8", timeout: 60_000, windowsHide: true },
      );
      assert.equal(
        rendered.status,
        0,
        "PDF rendering/DEMO watermark check failed. Set ASTRA_QA_PYTHON to Python with pypdf and pypdfium2.",
      );
      const image = PNG.sync.read(fs.readFileSync(pngPath));
      const qr = jsQR(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height,
        { inversionAttempts: "dontInvert" },
      );
      assert.ok(qr, "QR in downloaded PDF must decode.");
      assert.equal(qr.data, certificate.verificationUrl);
      const target = new URL(qr.data);
      assert.equal(target.origin, base);
      assert.match(target.pathname, /^\/verify\/[a-f0-9]{64}$/);
      const verified = await request("GET", target.pathname);
      status(verified, 200, "Decoded QR verification");
      assert.equal(verified.body.status, "ISSUED");
      assert.equal(verified.body.serviceNo, 45);
      assert.equal(verified.body.demo, true);
      assert.deepEqual(
        Object.keys(verified.body).sort(),
        [
          "status",
          "officeBn",
          "officeEn",
          "serviceNo",
          "serviceBn",
          "serviceEn",
          "issuedAt",
          "demo",
        ].sort(),
      );
      result.artifacts.pdf = {
        path: pdfPath,
        bytes: pdf.body.length,
        sha256: createHash("sha256").update(pdf.body).digest("hex"),
      };
      result.artifacts.render = pngPath;
      result.verificationUrl = certificate.verificationUrl;
      return {
        pages: 1,
        demoWatermark: true,
        decodedQr: true,
        qrMatchesCertificateUrl: true,
        publicFields: Object.keys(verified.body),
        anonymousPdf: 401,
        otherTenantPdf: 404,
      };
    },
  );
  await check(
    "15 Public tracking is minimal and authorized state is durable",
    async () => {
      const tracked = await request("GET", `/track/${application.id}`);
      status(tracked, 200, "Public application tracking");
      assert.equal(tracked.body.status, "ISSUED");
      assert.deepEqual(
        Object.keys(tracked.body).sort(),
        [
          "status",
          "officeBn",
          "officeEn",
          "serviceNo",
          "serviceBn",
          "serviceEn",
          "createdAt",
          "demo",
        ].sort(),
      );
      const detail = await request(
        "GET",
        `/applications/${application.id}`,
        undefined,
        sessions.citizen,
      );
      status(detail, 200, "Final application read");
      assert.equal(detail.body.application.state, "ISSUED");
      assert.equal(detail.body.certificate.id, certificate.id);
      for (const action of ["create", "submit", "review", "approve", "issue"])
        assert.equal(
          detail.body.events.filter((e: any) => e.action === action).length,
          1,
        );
      const untouched = await request(
        "GET",
        "/wallet",
        undefined,
        sessions.otheradmin,
      );
      status(untouched, 200, "Isolation office remains untouched");
      assert.equal(untouched.body.balance, 0);
      return {
        state: "ISSUED",
        applicationEvents: detail.body.events.length,
        publicFields: Object.keys(tracked.body),
        isolationOfficeCredits: 0,
      };
    },
  );
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL";
  console.error(error instanceof Error ? error.message : "Hosted QA failed.");
  process.exitCode = 1;
} finally {
  // Keep role passwords in the ignored file for UI verification, but invalidate this script's sessions.
  for (const session of Object.values(sessions)) {
    try {
      await request("POST", "/auth/logout", {}, session);
    } catch {
      /* The remote server may be unavailable; no retry mutations. */
    }
  }
  result.finishedAt = new Date().toISOString();
  result.passed = result.checks.filter((c: any) => c.status === "PASS").length;
  result.failed = result.checks.filter((c: any) => c.status === "FAIL").length;
  qa.lastStatus = result.status;
  qa.applicationId = application?.id;
  qa.certificateId = certificate?.id;
  savePrivate();
  save();
  console.log(
    `${result.status}: ${result.passed} hosted checks passed; ${result.failed} failed. Safe evidence: ${resultFile}`,
  );
}
