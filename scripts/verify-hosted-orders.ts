/**
 * Authorized hosted order-flow QA. Creates ONE NEW synthetic tenant per invocation.
 * PowerShell: $env:ASTRA_LIVE_URL='https://your-app.onrender.com'; npx tsx scripts/verify-hosted-orders.ts
 * Uses ignored .runtime/hosted/credentials.json, bound to its exact publicOrigin.
 * Appends this run's generated secrets to qa-credentials.json; never reuses old QA tenants.
 * Mutations: one office/admin, three staff-role accounts, one synthetic citizen,
 * one service cost/grant, one zero-money subscription settlement, two fee policies,
 * two applications and their review/approval events, one DEMO certificate/debit.
 * Denied requests may append security audit events. Sessions are logged out at the end.
 * Only intentional concurrent issuance/retry tests repeat a domain mutation. No automatic
 * mutation retry: after an ambiguous failure inspect this run before starting another.
 * No live payment, statutory receipt, provider call, or changes to existing QA offices.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDemoPayload } from "@astra/shared-schemas";

const supplied = process.env.ASTRA_LIVE_URL;
assert.ok(supplied, "Set ASTRA_LIVE_URL to the authorized HTTPS origin.");
const target = new URL(supplied);
assert.equal(target.protocol, "https:", "Hosted QA requires HTTPS.");
assert.ok(
  !(target.username || target.password || target.search || target.hash),
  "The hosted origin must not contain credentials, query parameters or a fragment.",
);
assert.equal(target.pathname, "/", "Supply the origin without a path.");
const base = target.origin;
const privateDir = path.resolve(".runtime/hosted");
function readPrivateJson(file: string) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error("Private QA configuration could not be read or parsed; its contents were not printed."); }
}
const credentials = readPrivateJson(path.join(privateDir, "credentials.json"));
assert.ok(
  typeof credentials.ownerEmail === "string" &&
    typeof credentials.ownerPassword === "string" &&
    typeof credentials.publicOrigin === "string",
  "Missing credentials or bound publicOrigin in the ignored credentials file.",
);
assert.equal(
  base,
  credentials.publicOrigin,
  "The requested origin must exactly match the origin bound to the owner credentials.",
);

const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
const startedAt = new Date().toISOString();
const serviceNo = 45;
const creditCost = 3;
const tenantSlug = `hosted-orders-${runId}`;
const qaFile = path.join(privateDir, "qa-credentials.json");
const resultFile = "execution/hosted-orders-qa.json";
const archiveFile = `execution/hosted-orders-qa-${runId}.json`;
type Role = "owner" | "admin" | "staff" | "reviewer" | "approver";
type Session = { cookie: string; csrf: string; user: any };
type Response = { status: number; headers: Headers; body: any };
const sessions: Partial<Record<Role, Session>> = {};
const createdApplications = new Set<string>();
const createdBillingOrders = new Set<string>();
const qa: any = {
  kind: "HOSTED_ORDERS_QA",
  runId,
  baseUrl: base,
  createdAt: startedAt,
  lastStatus: "PREPARED",
  offices: {},
  applications: {},
  accounts: Object.fromEntries(
    ["admin", "staff", "reviewer", "approver"].map((role) => [
      role,
      {
        email: `hosted-orders-${role}-${runId}@synthetic.test`,
        password: `${randomBytes(24).toString("base64url")}!Qa7`,
      },
    ]),
  ),
};
const result: any = {
  runId,
  baseUrl: base,
  startedAt,
  status: "RUNNING",
  mode: "SYNTHETIC_DEMO_ONLY",
  scope: "New dedicated synthetic order-QA tenant only; no existing tenant policies or records are modified.",
  expectedRecords: {
    newTenants: 1,
    newAccounts: 4,
    newCitizenProfiles: 1,
    newFeePolicies: 2,
    newApplications: 2,
    newCertificates: 1,
    newIssuanceDebits: 1,
    sandboxSubscriptionOrders: 1,
    realMoneyCollected: false,
  },
  checks: [],
  mutationAttempts: [],
  cleanup: [],
  limitations: [
    "Synthetic citizen and DEMO certificate only; no original reference-site records are used.",
    "Subscription settlement is a zero-money local sandbox event, not citizen payment verification.",
    "Positive-fee issuance is expected to remain blocked and unpaid.",
    "HTTP evidence verifies persisted API-visible state; direct database tampering and RLS constraints belong to local integration tests.",
    "The new QA tenant and immutable records are deliberately retained; sessions are invalidated at the end where reachable.",
  ],
};
fs.mkdirSync("execution", { recursive: true });
function save() {
  const json = JSON.stringify(result, null, 2);
  fs.writeFileSync(resultFile, json);
  fs.writeFileSync(archiveFile, json);
}
// Re-read each time and replace only this run. The lock and atomic rename protect
// cooperating QA writers; existing runs and unrelated top-level metadata survive.
function savePrivate() {
  const lockPath = `${qaFile}.lock`;
  const tempPath = `${qaFile}.${runId}.tmp`;
  const lock = fs.openSync(lockPath, "wx", 0o600);
  try {
    const prior = fs.existsSync(qaFile) ? readPrivateJson(qaFile) : { runs: [] };
    assert.ok(
      Array.isArray(prior.runs),
      "Existing QA credentials have an unexpected format; no remote request is allowed until preserved/repaired.",
    );
    const index = prior.runs.findIndex((entry: any) => entry.runId === runId);
    if (index === -1) prior.runs.push(qa);
    else prior.runs[index] = qa;
    fs.writeFileSync(tempPath, JSON.stringify(prior, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(tempPath, qaFile);
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}
savePrivate(); // Persist new passwords before the first remote account creation.
save();

function ensure(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}
function equals(actual: unknown, expected: unknown, label: string) {
  ensure(JSON.stringify(actual) === JSON.stringify(expected), label);
}
function apiCode(response: Response) {
  const value = response.body?.error?.code;
  return typeof value === "string" && /^[A-Z0-9_]{1,80}$/.test(value)
    ? value
    : "NONE";
}
function status(response: Response, expected: number | number[], label: string) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  ensure(
    allowed.includes(response.status),
    `${label}: HTTP ${response.status}, code ${apiCode(response)}; expected ${allowed.join(" or ")}.`,
  );
}
function code(response: Response, expected: string, label: string) {
  ensure(apiCode(response) === expected, `${label}: unexpected API error code.`);
}
function uuid(value: unknown, label: string): asserts value is string {
  ensure(
    typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    label,
  );
}
function mutationAllowed(method: string, route: string, data: any, role?: Role) {
  if (method === "GET" || route === "/auth/login") return;
  if (route === "/auth/logout") return;
  if (role === "owner") {
    ensure(
      method === "POST" &&
        route === "/owner/tenants" &&
        data?.slug === tenantSlug &&
        !qa.offices.primary,
      "Owner mutations are limited to creating this run's new QA tenant.",
    );
    return;
  }
  ensure(
    role &&
      qa.offices.primary?.id &&
      sessions[role]?.user.tenantId === qa.offices.primary.id,
    "Every domain request must use a session belonging to this run's new tenant.",
  );
  const fixed = new Set([
    "POST /admin/users",
    "POST /citizens",
    "POST /applications",
    "POST /billing/orders",
    `PATCH /admin/services/${serviceNo}`,
    `POST /admin/services/${serviceNo}/order-policies`,
    `POST /services/${serviceNo}/order-quote`,
  ]);
  if (fixed.has(`${method} ${route}`)) return;
  if (
    method === "PUT" &&
    route === `/admin/authorizations/${sessions.approver?.user.id}/${serviceNo}`
  ) return;
  const application = route.match(/^\/applications\/([^/]+)\/(transition|issue)$/);
  if (method === "POST" && application && createdApplications.has(application[1]!)) return;
  const order = route.match(/^\/billing\/orders\/([^/]+)\/demo-settle$/);
  if (method === "POST" && order && createdBillingOrders.has(order[1]!)) return;
  throw new Error("Mutation is outside the dedicated hosted-orders QA allowlist.");
}
async function request(
  method: "GET" | "POST" | "PUT" | "PATCH",
  route: string,
  data?: unknown,
  role?: Role,
  operation = "Read-only request",
): Promise<Response> {
  ensure(route.startsWith("/") && !route.startsWith("//"), "Invalid API route.");
  mutationAllowed(method, route, data, role);
  if (role && role !== "owner") {
    ensure(
      sessions[role]?.user.tenantId === qa.offices.primary?.id,
      "Session is not scoped to the newly created QA tenant.",
    );
  }
  const session = role ? sessions[role] : undefined;
  const mutation = method !== "GET" && !route.endsWith("/order-quote")
    ? { operation, outcome: "PENDING", httpStatus: 0 }
    : null;
  if (mutation) {
    result.mutationAttempts.push(mutation);
    save();
  }
  try {
    const response = await fetch(`${base}/api/v1${route}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(180_000),
      headers: {
        Accept: "application/json",
        Origin: base,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body = response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    if (mutation) {
      mutation.httpStatus = response.status;
      mutation.outcome = response.ok ? "ACCEPTED" : "REJECTED";
      save();
    }
    return { status: response.status, headers: response.headers, body };
  } catch {
    if (mutation) {
      mutation.outcome = "AMBIGUOUS_NETWORK_FAILURE";
      save();
    }
    // Never print fetch causes, response bodies, cookies or credential values.
    throw new Error(`${operation}: network/response failure; inspect the recorded run before retrying mutations.`);
  }
}
async function check(name: string, run: () => Promise<unknown>) {
  const started = Date.now();
  try {
    const evidence = await run();
    result.checks.push({ name, status: "PASS", durationMs: Date.now() - started, evidence });
    save();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hosted orders check failed.";
    result.checks.push({ name, status: "FAIL", durationMs: Date.now() - started, message });
    save();
    throw new Error(`${name}: ${message}`);
  }
}
async function login(role: Role) {
  const account = role === "owner"
    ? { email: credentials.ownerEmail, password: credentials.ownerPassword }
    : qa.accounts[role];
  const response = await request("POST", "/auth/login", account, undefined, `Sign in ${role}`);
  status(response, 200, `Sign in ${role}`);
  const cookie = response.headers.get("set-cookie");
  ensure(typeof cookie === "string", "Hosted sign-in must return a session cookie.");
  ensure(
    cookie.includes("Secure") && cookie.includes("HttpOnly") && cookie.includes("SameSite=Strict"),
    "Hosted session must use Secure, HttpOnly and SameSite=Strict cookies.",
  );
  ensure(typeof response.body.csrfToken === "string" && response.body.csrfToken.length >= 32, "Missing CSRF token.");
  equals(response.body.user.role, role, "Unexpected authenticated role.");
  if (role !== "owner") equals(response.body.user.tenantId, qa.offices.primary.id, "Account belongs to a different tenant.");
  sessions[role] = { cookie: cookie.split(";")[0]!, csrf: response.body.csrfToken, user: response.body.user };
}
const zeroPolicy = {
  expectedVersion: 0,
  reason: "Synthetic hosted order QA; explicit zero fees, not an official tariff",
  statutoryFeeMinor: 0,
  processingFeeMinor: 0,
  emergencySurchargeMinor: 0,
  deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
  deliveryModes: ["office_collection", "digital_copy"],
  urgencies: ["normal", "urgent"],
};
const positivePolicy = {
  ...zeroPolicy,
  expectedVersion: 1,
  reason: "Synthetic hosted order QA; positive amounts will not be collected",
  statutoryFeeMinor: 12101,
  processingFeeMinor: 2302,
  emergencySurchargeMinor: 703,
  deliveryFeesMinor: { office_collection: 205, digital_copy: 104 },
};
const preferences = {
  addressBasis: "registered_profile",
  certificateLanguage: "bn",
  deliveryMode: "office_collection",
  urgency: "normal",
};
const positivePreferences = { ...preferences, certificateLanguage: "en", deliveryMode: "digital_copy", urgency: "urgent" };
const payload = (language = "bn") => ({ ...getDemoPayload(serviceNo), delivery_language: language });
async function detail(id: string) {
  ensure(createdApplications.has(id), "Only this run's applications may be read.");
  const response = await request("GET", `/applications/${id}`, undefined, "staff");
  status(response, 200, "Read QA application");
  return response.body;
}
async function wallet() {
  const response = await request("GET", "/wallet", undefined, "admin");
  status(response, 200, "Read QA wallet");
  return response.body;
}
async function createApplication(kind: "zero" | "positive", version: number, selected: typeof preferences) {
  const response = await request("POST", "/applications", {
    citizenId: qa.citizenId,
    serviceNo,
    payload: payload(selected.certificateLanguage),
    order: { policyVersion: version, preferences: selected },
  }, "staff", `Create ${kind}-fee QA application`);
  status(response, 201, `Create ${kind}-fee application`);
  uuid(response.body.id, "Created application ID is invalid.");
  createdApplications.add(response.body.id);
  qa.applications[kind] = response.body.id;
  savePrivate();
  equals(response.body.state, "DRAFT", "New application must be a draft.");
  equals(response.body.orderMode, "POLICY", "New configured application must retain POLICY origin.");
  return response.body.id as string;
}
async function transition(id: string, action: string, role: Role) {
  return request("POST", `/applications/${id}/transition`, { action }, role, `${role} ${action} QA application`);
}
async function approve(id: string) {
  status(await transition(id, "submit", "staff"), 200, "Staff submit");
  status(await transition(id, "review", "reviewer"), 200, "Separate reviewer begins review");
  const denied = await transition(id, "approve", "staff");
  status(denied, 403, "Staff cannot approve");
  const approved = await transition(id, "approve", "approver");
  status(approved, 200, "Separate authorized approver approves");
  equals(approved.body.state, "APPROVED", "Application must be approved by the approver.");
}

let zeroId = "";
let positiveId = "";
let certificateId = "";
let zeroSnapshot: any;
let initialBalance = 0;
try {
  qa.lastStatus = "RUNNING";
  savePrivate();
  await check("01 Authorized HTTPS DEMO endpoint and order routes are available", async () => {
    let health: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { health = await request("GET", "/health"); } catch { /* Read-only cold-start retry. */ }
      if (health?.status === 200) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    ensure(health, "No health response.");
    status(health, 200, "Health");
    equals(health.body.database, "PostgreSQL", "Hosted database must be PostgreSQL.");
    equals(health.body.mode, "DEMO_ONLY", "Verifier must only run against DEMO_ONLY mode.");
    await login("owner");
    const route = await request("GET", `/services/${serviceNo}/order-options`, undefined, "owner");
    status(route, 403, "Owner is denied tenant order options; route exists");
    code(route, "ROLE_DENIED", "Order route availability");
    return { authorizedOriginMatched: true, demoOnly: true, orderRoutePresent: true };
  });
  await check("02 A new dedicated office and separate role accounts are provisioned", async () => {
    const created = await request("POST", "/owner/tenants", {
      slug: tenantSlug,
      nameBn: "অর্ডার কিউএ পরীক্ষামূলক অফিস",
      nameEn: `HOSTED ORDER QA DEMO ${runId}`,
      division: "DEMO Test Division",
      district: "DEMO Test District",
      upazila: "DEMO Test Upazila",
      officeType: "UNION",
      adminEmail: qa.accounts.admin.email,
      adminName: "Synthetic Order QA Administrator",
      adminPassword: qa.accounts.admin.password,
    }, "owner", "Create one dedicated synthetic QA office/admin");
    status(created, 201, "Create dedicated QA office");
    uuid(created.body.id, "Created office ID is invalid.");
    equals(created.body.slug, tenantSlug, "Created office slug does not match this run.");
    qa.offices.primary = { id: created.body.id, slug: tenantSlug };
    savePrivate();
    await login("admin");
    const before = await wallet();
    equals(before.balance, 0, "New tenant wallet should be empty.");
    equals(before.ledger.length, 0, "New tenant must have no prior ledger entries.");
    for (const role of ["staff", "reviewer", "approver"] as const) {
      const response = await request("POST", "/admin/users", {
        ...qa.accounts[role], displayName: `Synthetic Order QA ${role}`, role,
      }, "admin", `Create separate QA ${role} account`);
      status(response, 201, `Create ${role}`);
      await login(role);
    }
    const citizen = await request("POST", "/citizens", {
      nameBn: "অর্ডার কিউএ নমুনা নাগরিক",
      nameEn: "Synthetic Order QA Citizen",
      dateOfBirth: "1998-02-03",
      addressBn: "শুধুমাত্র পরীক্ষার কাল্পনিক ঠিকানা",
      addressEn: "Synthetic address for order QA only",
      syntheticReference: `DEMO-ORDER-${runId}`,
    }, "staff", "Register one synthetic QA citizen profile");
    status(citizen, 201, "Create synthetic citizen");
    uuid(citizen.body.id, "Citizen ID is invalid.");
    qa.citizenId = citizen.body.id;
    savePrivate();
    return { newTenants: 1, newAccounts: 4, separateRoles: ["admin", "staff", "reviewer", "approver"], syntheticCitizenProfiles: 1 };
  });
  await check("03 Service authority and zero-money sandbox credits are configured", async () => {
    status(await request("PATCH", `/admin/services/${serviceNo}`, { enabled: true, creditCost }, "admin", "Configure QA service credit cost"), 200, "Set service cost");
    status(await request("PUT", `/admin/authorizations/${sessions.approver!.user.id}/${serviceNo}`, {
      active: true, authorityNote: "Synthetic hosted QA grant only; no official appointment or authority",
    }, "admin", "Grant QA approver explicit service authority"), 200, "Grant service authority");
    const billing = await request("GET", "/billing", undefined, "admin");
    status(billing, 200, "Read sandbox plans");
    ensure(billing.body.sandbox === true, "Billing must explicitly be sandbox.");
    const plan = billing.body.plans.find((value: any) => value.id === "demo-monthly");
    ensure(plan && plan.priceMinor === 0 && plan.grantCredits >= creditCost, "Requires the existing zero-money demo plan with enough credits.");
    const order = await request("POST", "/billing/orders", { kind: "subscription", planId: plan.id }, "admin", "Create zero-money QA subscription order");
    status(order, 201, "Create sandbox order");
    equals(order.body.amountMinor, 0, "QA must not settle a priced order.");
    uuid(order.body.id, "Sandbox order ID is invalid.");
    createdBillingOrders.add(order.body.id);
    qa.subscriptionOrderId = order.body.id;
    savePrivate();
    status(await request("POST", `/billing/orders/${order.body.id}/demo-settle`, {}, "admin", "Settle zero-money sandbox subscription"), 200, "Sandbox settlement");
    const funded = await wallet();
    equals(funded.balance, plan.grantCredits, "Only the plan's sandbox credits should be granted.");
    equals(funded.subscription.status, "ACTIVE", "QA subscription must be active.");
    equals(funded.ledger.length, 1, "One plan credit grant must exist.");
    initialBalance = funded.balance;
    return { monetaryAmountMinor: 0, grantedCredits: initialBalance, issuanceCreditCost: creditCost, separateApproverGrant: true };
  });
  await check("04 Admin publishes explicit zero fees; staff cannot publish; quotes are read-only", async () => {
    const unconfigured = await request("GET", `/services/${serviceNo}/order-options`, undefined, "staff");
    status(unconfigured, 200, "Initial order policy");
    equals(unconfigured.body.configured, false, "This new tenant must start unconfigured.");
    const denied = await request("POST", `/admin/services/${serviceNo}/order-policies`, zeroPolicy, "staff", "Reject staff tariff publication");
    status(denied, 403, "Staff cannot publish policies");
    const published = await request("POST", `/admin/services/${serviceNo}/order-policies`, zeroPolicy, "admin", "Publish explicit zero-fee QA policy version 1");
    status(published, 201, "Publish zero policy");
    equals(published.body.policy.version, 1, "First policy must be version 1.");
    const before = await request("GET", "/applications", undefined, "staff");
    status(before, 200, "Applications before quote");
    const priorWallet = await wallet();
    const quotes = await Promise.all([1, 2].map(() => request("POST", `/services/${serviceNo}/order-quote`, { preferences }, "staff")));
    for (const quote of quotes) {
      status(quote, 200, "Zero-fee quote");
      equals(quote.body.policyVersion, 1, "Quote must use version 1.");
      equals(quote.body.totalMinor, 0, "Explicit zero policy must quote zero.");
      equals(quote.body.paymentStatus, "NOT_COLLECTED", "Zero quote must not claim payment.");
    }
    const after = await request("GET", "/applications", undefined, "staff");
    status(after, 200, "Applications after repeated quotes");
    equals(after.body.total, before.body.total, "Quotes must not create applications.");
    equals((await wallet()).ledger, priorWallet.ledger, "Quotes must not change the wallet ledger.");
    zeroId = await createApplication("zero", 1, preferences);
    const saved = await detail(zeroId);
    ensure(saved.order, "Created application needs an order snapshot.");
    equals(saved.order.totalMinor, 0, "Persisted order must retain explicit zero fees.");
    zeroSnapshot = saved.order;
    return { policyVersion: 1, zeroTotalMinor: 0, staffPublicationStatus: 403, repeatedQuotesCreatedApplications: 0, quoteLedgerUnchanged: true, snapshotStored: true };
  });
  await check("05 New positive tariff rejects stale requests and preserves the old snapshot", async () => {
    const published = await request("POST", `/admin/services/${serviceNo}/order-policies`, positivePolicy, "admin", "Publish positive-fee QA policy version 2");
    status(published, 201, "Publish positive policy");
    equals(published.body.policy.version, 2, "Next policy must be version 2.");
    const stalePolicy = await request("POST", `/admin/services/${serviceNo}/order-policies`, zeroPolicy, "admin", "Reject stale policy publication");
    status(stalePolicy, 409, "Stale policy update");
    code(stalePolicy, "ORDER_POLICY_STALE", "Stale policy update");
    const staleApplication = await request("POST", "/applications", {
      citizenId: qa.citizenId, serviceNo, payload: payload(), order: { policyVersion: 1, preferences },
    }, "staff", "Reject stale order on new application");
    status(staleApplication, 409, "Stale application order");
    code(staleApplication, "ORDER_POLICY_STALE", "Stale application order");
    const missing = await request("POST", "/applications", { citizenId: qa.citizenId, serviceNo, payload: payload() }, "staff", "Reject new configured application without order");
    status(missing, 409, "Missing order");
    code(missing, "ORDER_REQUIRED", "Missing order");
    const tampered = await request("POST", `/services/${serviceNo}/order-quote`, { preferences: positivePreferences, totalMinor: 0 }, "staff");
    status(tampered, 422, "Caller supplied quote total must fail strict parsing");
    const quote = await request("POST", `/services/${serviceNo}/order-quote`, { preferences: positivePreferences }, "staff");
    status(quote, 200, "Positive quote");
    equals(quote.body.components, [
      { code: "statutory_fee", amountMinor: 12101 },
      { code: "processing_fee", amountMinor: 2302 },
      { code: "emergency_surcharge", amountMinor: 703 },
      { code: "delivery_fee", amountMinor: 104 },
    ], "Positive quote must preserve all four separate charge components.");
    equals(quote.body.totalMinor, 15210, "Server-calculated positive total is incorrect.");
    equals(quote.body.paymentStatus, "NOT_COLLECTED", "Positive quote must remain unpaid.");
    equals((await detail(zeroId)).order, zeroSnapshot, "Existing snapshot changed after new policy publication.");
    positiveId = await createApplication("positive", 2, positivePreferences);
    const saved = await detail(positiveId);
    equals(saved.order.totalMinor, 15210, "Positive snapshot total must persist.");
    const list = await request("GET", "/applications", undefined, "staff");
    status(list, 200, "Application count");
    equals(list.body.total, 2, "Only two valid QA applications should exist after rejected requests.");
    return { currentPolicyVersion: 2, stalePolicy: 409, staleApplication: 409, missingOrder: 409, totalTampering: 422, positiveTotalMinor: 15210, originalZeroSnapshotUnchanged: true, validApplications: 2 };
  });
  await check("06 Separate reviewer and approver authorize both applications; staff is denied", async () => {
    await approve(zeroId);
    await approve(positiveId);
    const denied = await request("POST", `/applications/${zeroId}/issue`, {}, "staff", "Reject staff certificate issuance");
    status(denied, 403, "Staff cannot issue");
    equals((await detail(zeroId)).application.state, "APPROVED", "Zero-fee application must be approved before issue.");
    equals((await detail(positiveId)).application.state, "APPROVED", "Positive-fee application must remain approved.");
    return { staffApprovalStatus: 403, staffIssuanceStatus: 403, distinctReviewerAndApprover: true, approvedApplications: 2 };
  });
  await check("07 Concurrent zero-fee issuance and retry produce one DEMO certificate/debit", async () => {
    // Await both outcomes before cleanup even if one request has an ambiguous failure.
    const outcomes = await Promise.allSettled([1, 2].map((number) => request("POST", `/applications/${zeroId}/issue`, {}, "approver", `Concurrent zero-fee QA issue ${number}`)));
    ensure(outcomes.every((outcome) => outcome.status === "fulfilled"), "A concurrent issue request failed ambiguously; inspect both recorded outcomes before retrying.");
    const responses = outcomes.map((outcome) => (outcome as PromiseFulfilledResult<Response>).value);
    for (const response of responses) status(response, [200, 201], "Concurrent zero-fee issue");
    uuid(responses[0]!.body.id, "Certificate ID is invalid.");
    certificateId = responses[0]!.body.id;
    equals(responses[1]!.body.id, certificateId, "Concurrent requests must return the same certificate.");
    equals(responses[0]!.body.demo, true, "Issued certificate must remain DEMO.");
    qa.certificateId = certificateId;
    savePrivate();
    const retry = await request("POST", `/applications/${zeroId}/issue`, {}, "approver", "Retry already-issued zero-fee QA certificate");
    status(retry, 200, "Safe certificate issue retry");
    equals(retry.body.id, certificateId, "Retry must return the original certificate.");
    const after = await wallet();
    const debits = after.ledger.filter((entry: any) => entry.kind === "ISSUANCE");
    equals(debits.length, 1, "Exactly one issuance debit should exist.");
    equals(debits[0].delta, -creditCost, "Issuance debit must equal configured credit cost.");
    equals(after.balance, initialBalance - creditCost, "Wallet must reflect exactly one issuance.");
    const saved = await detail(zeroId);
    equals(saved.application.state, "ISSUED", "Zero-fee application must now be issued.");
    equals(saved.certificate.id, certificateId, "Application must point to the same certificate.");
    equals(saved.events.filter((event: any) => event.action === "issue").length, 1, "Issue history must contain one event.");
    equals(saved.order, zeroSnapshot, "Issuance must preserve its accepted zero-fee order.");
    return { concurrentResponses: responses.map((response) => response.status), retryStatus: retry.status, balanceBefore: initialBalance, balanceAfter: after.balance, issuanceEntries: 1, deductedCredits: creditCost, issueEvents: 1 };
  });
  await check("08 Approved positive-fee issuance is blocked with no debit or document", async () => {
    const before = await wallet();
    const beforeDetail = await detail(positiveId);
    const blocked = await request("POST", `/applications/${positiveId}/issue`, {}, "approver", "Confirm positive-fee QA issuance payment gate");
    status(blocked, 402, "Positive-fee issue must be blocked");
    code(blocked, "ORDER_PAYMENT_REQUIRED", "Positive-fee payment gate");
    const after = await wallet();
    const saved = await detail(positiveId);
    equals(after.balance, before.balance, "Blocked issue must not change wallet balance.");
    equals(after.ledger, before.ledger, "Blocked issue must not append a credit debit.");
    equals(saved.application.state, "APPROVED", "Blocked positive-fee application must remain approved.");
    equals(saved.certificate, null, "Blocked positive-fee application must not have a certificate.");
    equals(saved.events, beforeDetail.events, "Blocked issue must not append an application transition.");
    equals(saved.order, beforeDetail.order, "Blocked issue must preserve the order snapshot.");
    equals(saved.order.paymentStatus, "NOT_COLLECTED", "Sandbox subscription must not mark citizen fees paid.");
    return { issueStatus: 402, code: "ORDER_PAYMENT_REQUIRED", certificateCreated: false, balanceUnchanged: true, ledgerUnchanged: true, state: "APPROVED", paymentStatus: "NOT_COLLECTED" };
  });
  await check("09 Stored PDF and safe public verification match the single issued certificate", async () => {
    const response = await request("GET", `/certificates/${certificateId}/pdf`, undefined, "staff");
    status(response, 200, "Private certificate PDF");
    ensure(response.headers.get("content-type")?.includes("application/pdf"), "PDF content type is required.");
    ensure(Buffer.isBuffer(response.body) && response.body.subarray(0, 5).toString() === "%PDF-" && response.body.length > 10000, "Certificate response must contain real PDF bytes.");
    const cert = (await detail(zeroId)).certificate;
    const verification = new URL(cert.verificationUrl);
    equals(verification.origin, base, "Verification URL must stay on the authorized origin.");
    ensure(/^\/verify\/[a-f0-9]{64}$/.test(verification.pathname), "Verification must use the opaque token route.");
    const verified = await request("GET", verification.pathname);
    status(verified, 200, "Public verification");
    equals(verified.body.status, "ISSUED", "Public verification must reflect issued state.");
    equals(verified.body.serviceNo, serviceNo, "Public verification service mismatch.");
    equals(Object.keys(verified.body).sort(), ["status", "officeBn", "officeEn", "serviceNo", "serviceBn", "serviceEn", "issuedAt", "demo"].sort(), "Public verification must expose only the expected minimal fields.");
    return { pdfBytes: response.body.length, pdfSha256: createHash("sha256").update(response.body).digest("hex"), publicStatus: "ISSUED", serviceNo, opaqueVerificationToken: true };
  });
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL";
  // All in-script errors contain controlled labels/statuses, never raw server bodies.
  console.error(error instanceof Error ? error.message : "Hosted order QA failed.");
  process.exitCode = 1;
} finally {
  for (const role of Object.keys(sessions) as Role[]) {
    try {
      const response = await request("POST", "/auth/logout", {}, role, `Sign out ${role} QA session`);
      result.cleanup.push({ role, logoutStatus: response.status });
      if (response.status !== 200) result.limitations.push(`Logout for ${role} returned an unexpected status; inspect that session.`);
    } catch {
      result.cleanup.push({ role, logoutStatus: "UNCONFIRMED" });
    }
  }
  result.finishedAt = new Date().toISOString();
  result.passed = result.checks.filter((item: any) => item.status === "PASS").length;
  result.failed = result.checks.filter((item: any) => item.status === "FAIL").length;
  result.runFinished = true;
  qa.lastStatus = result.status;
  qa.finishedAt = result.finishedAt;
  try { savePrivate(); } catch { result.privatePersistenceWarning = "Could not update final private status; initial credentials and per-record saves are retained."; }
  save();
  console.log(`${result.status}: ${result.passed} hosted order checks passed; ${result.failed} failed. Safe evidence: ${resultFile}`);
}
