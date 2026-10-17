import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const origin = "http://127.0.0.1:5173";
const password = "Order-browser-test-2026!";
const run = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const adminEmail = `order-admin-${run}@example.test`;
const citizenEmail = `order-citizen-${run}@example.test`;
const staffEmail = `order-staff-${run}@example.test`;
const geography = {
  divisionCode: "div-02", districtCode: "dis-19", upazilaCode: "upa-089",
  unionCode: "uni-0001", wardCode: "uni-0001-w01",
};
let browser: Browser;

async function request(page: Page, route: string, method = "GET", data?: unknown) {
  const session = await (await page.request.get(`${origin}/api/v1/auth/me`)).json();
  const response = await page.request.fetch(`${origin}/api/v1${route}`, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken || "" },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), data: await response.json() };
}
async function login(page: Page, email: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name, exact: true }).click();
}
async function language(page: Page, name: "English" | "বাংলা") {
  await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name, exact: true }).click();
}
async function policySettings(page: Page, serviceNo: string) {
  await nav(page, "Office administration");
  await page.getByRole("tab", { name: "Application fee policies", exact: true }).click();
  await page.locator("#order-policy-service").selectOption(serviceNo);
  await page.locator("#order-fee-statutory").waitFor();
}
const policyInput = {
  expectedVersion: 0, reason: "Isolated browser fixture; synthetic policy only",
  statutoryFeeMinor: 10000, processingFeeMinor: 1575, emergencySurchargeMinor: 2000,
  deliveryFeesMinor: { office_collection: 0, digital_copy: 500 },
  deliveryModes: ["office_collection", "digital_copy"], urgencies: ["normal", "urgent"],
};

before(async () => {
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local) ? fs.readdirSync(local) : []).filter((name) => /^chromium-/.test(name)).sort().reverse()
      .map((name) => path.join(local, name, "chrome-win64", "chrome.exe")).find((file) => fs.existsSync(file));
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext(), setup = await context.newPage();
  try {
    const ownerLogin = await setup.request.post(`${origin}/api/v1/auth/login`, { data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" } });
    assert.equal(ownerLogin.status(), 200);
    const created = await request(setup, "/owner/tenants", "POST", {
      slug: `order-browser-${run}`, nameBn: "ফি নীতি পরীক্ষার ইউনিয়ন", nameEn: `Order Browser Union ${run}`,
      officeType: "UNION", geography: { ...geography, wardCode: undefined },
      adminEmail, adminName: "Synthetic Fee Administrator", adminPassword: password,
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const signup = await setup.request.post(`${origin}/api/v1/auth/signup`, { data: {
      email: citizenEmail, password, displayName: "Order Browser Citizen", tenantId: created.data.id,
      nameBn: "ফি পরীক্ষার নাগরিক", nameEn: "Order Browser Citizen", dateOfBirth: "1991-01-02",
      addressBn: "নমুনা পরীক্ষার গ্রাম", addressEn: "Synthetic Order Village", geography,
    } });
    assert.equal(signup.status(), 201, await signup.text());
    const adminLogin = await setup.request.post(`${origin}/api/v1/auth/login`, { data: { email: adminEmail, password } });
    assert.equal(adminLogin.status(), 200);
    const staff = await request(setup, "/admin/users", "POST", {
      email: staffEmail, password, displayName: "Synthetic Fee Counter Staff", role: "staff",
    });
    assert.equal(staff.status, 201, JSON.stringify(staff.data));
  } finally { await context.close(); }
});
after(async () => { await browser?.close(); });

test("order browser: explicit office fees, citizen-first quote acceptance, bilingual/mobile state and immutable fee snapshot", { timeout: 120000 }, async () => {
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const citizenContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staffContext = await browser.newContext();
  const admin = await adminContext.newPage(), citizen = await citizenContext.newPage(), staff = await staffContext.newPage();
  const errors: string[] = [];
  for (const page of [admin, citizen, staff]) page.on("pageerror", (error) => errors.push(error.message));
  try {
    await login(admin, adminEmail);
    await policySettings(admin, "45");
    const fields = { statutory: "100.00", processing: "15.75", emergency: "20.00", office_collection: "0", digital_copy: "5.00" };
    for (const key of Object.keys(fields)) assert.equal(await admin.locator(`#order-fee-${key}`).inputValue(), "", `${key} must not assume a rate`);
    assert.equal(await admin.locator("#order-mode-office_collection").isChecked(), false);
    assert.equal(await admin.locator("#order-urgency-normal").isChecked(), false);
    for (const [key, value] of Object.entries(fields)) await admin.locator(`#order-fee-${key}`).fill(value);
    await language(admin, "বাংলা");
    assert.equal(await admin.locator("#order-fee-processing").inputValue(), "15.75");
    await admin.getByRole("heading", { name: "ইউনিয়নভিত্তিক আবেদন ফি নীতি", exact: true }).waitFor();
    await language(admin, "English");
    for (const id of ["order-mode-office_collection", "order-mode-digital_copy", "order-urgency-normal", "order-urgency-urgent"]) await admin.locator(`#${id}`).check();
    await admin.locator("#order-policy-reason").fill("Synthetic browser policy: statutory and processing fees are separate");
    const publishedPromise = admin.waitForResponse((response) => response.url().endsWith("/admin/services/45/order-policies") && response.request().method() === "POST");
    await admin.getByRole("button", { name: "Publish fee policy version", exact: true }).click();
    const published = await publishedPromise;
    assert.equal(published.status(), 201, await published.text());
    const policy = (await published.json()).policy;
    assert.equal(policy.statutoryFeeMinor, 10000);
    assert.equal(policy.processingFeeMinor, 1575);
    assert.equal(policy.version, 1);
    await admin.getByText("Current version: 1", { exact: true }).waitFor();

    await login(citizen, citizenEmail);
    assert.equal(await citizen.getByRole("button", { name: "Office administration", exact: true }).count(), 0);
    await nav(citizen, "Service catalog");
    assert.equal(await citizen.locator("#order-language").count(), 0, "Select a citizen before configuring an order");
    await citizen.locator("#applicant option:not([value=''])").first().waitFor({ state: "attached" });
    await citizen.locator("#applicant").selectOption({ index: 1 });
    await citizen.locator("#order-language").waitFor();
    const save = citizen.getByRole("button", { name: "Save draft application", exact: true });
    assert.equal(await save.isDisabled(), true, "Configured policy must be reviewed and accepted");
    await citizen.getByRole("button", { name: "Fill synthetic example", exact: true }).click();
    await citizen.getByLabel("Purpose (English)", { exact: false }).fill("Preserved custom order purpose");
    await citizen.locator("#order-language").selectOption("en");
    await citizen.locator("#order-delivery").selectOption("digital_copy");
    await citizen.locator("#order-urgency").selectOption("urgent");
    const quotePromise = citizen.waitForResponse((response) => response.url().endsWith("/services/45/order-quote") && response.request().method() === "POST");
    await citizen.getByRole("button", { name: "Review fees", exact: true }).click();
    const quoteResponse = await quotePromise;
    assert.equal(quoteResponse.status(), 200, await quoteResponse.text());
    assert.equal((await quoteResponse.json()).totalMinor, 14075);
    await citizen.getByRole("region", { name: "Application fee breakdown" }).waitFor();
    assert.equal(await save.isDisabled(), true);
    await citizen.getByRole("checkbox", { name: "I have reviewed the certificate options and fee breakdown.", exact: true }).check();
    await save.and(citizen.locator(":enabled")).waitFor();
    assert.equal(await save.isEnabled(), true);
    await language(citizen, "বাংলা");
    assert.equal(await citizen.locator("#order-language").inputValue(), "en", "Interface language does not change certificate language");
    assert.equal(await citizen.locator("[id$='purpose_en']").inputValue(), "Preserved custom order purpose");
    assert.equal(await citizen.getByRole("checkbox", { name: "আমি সনদের পছন্দ ও ফি বিবরণ যাচাই করেছি।", exact: true }).isChecked(), true);
    await citizen.getByRole("region", { name: "আবেদনের ফি বিবরণ" }).waitFor();
    assert.equal(await citizen.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    fs.mkdirSync("execution/screenshots", { recursive: true });
    await citizen.screenshot({ path: "execution/screenshots/order-quote-mobile-bn.png", fullPage: true });
    await language(citizen, "English");
    await citizen.locator("#order-urgency").selectOption("normal");
    assert.equal(await citizen.getByRole("region", { name: "Application fee breakdown" }).count(), 0, "Changing preferences invalidates acceptance");
    assert.equal(await save.isDisabled(), true);

    // Hold a real server response while preferences change. An obsolete quote must never become actionable.
    let releaseQuote!: () => void, quoteArrived!: () => void, quoteCompleted!: () => void;
    const release = new Promise<void>((resolve) => { releaseQuote = resolve; });
    const arrived = new Promise<void>((resolve) => { quoteArrived = resolve; });
    const completed = new Promise<void>((resolve) => { quoteCompleted = resolve; });
    await citizen.route("**/api/v1/services/45/order-quote", async (route) => {
      const response = await route.fetch();
      quoteArrived();
      await release;
      await route.fulfill({ response });
      quoteCompleted();
    }, { times: 1 });
    await citizen.getByRole("button", { name: "Review fees", exact: true }).click();
    await arrived;
    await citizen.locator("#order-delivery").selectOption("office_collection");
    const obsoleteResponse = citizen.waitForResponse((response) => response.url().endsWith("/services/45/order-quote"));
    releaseQuote();
    await completed;
    await (await obsoleteResponse).finished();
    await citizen.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await citizen.getByRole("button", { name: "Review fees", exact: true }).waitFor();
    assert.equal(await citizen.getByRole("region", { name: "Application fee breakdown" }).count(), 0);
    assert.equal(await save.isDisabled(), true);
    await citizen.getByRole("button", { name: "Review fees", exact: true }).click();
    await citizen.getByRole("checkbox", { name: "I have reviewed the certificate options and fee breakdown.", exact: true }).check();
    const createdPromise = citizen.waitForResponse((response) => response.url().endsWith("/applications") && response.request().method() === "POST");
    await save.click();
    const created = await createdPromise;
    assert.equal(created.status(), 201, await created.text());
    const application = await created.json();
    assert.deepEqual(created.request().postDataJSON().order, {
      policyVersion: 1,
      preferences: { addressBasis: "registered_profile", certificateLanguage: "en", deliveryMode: "office_collection", urgency: "normal" },
    });
    await citizen.getByText(`APPLICATION ${application.id.slice(0, 8)}`, { exact: true }).waitFor();
    const summary = citizen.getByRole("region", { name: "Application fee breakdown" });
    assert.match(await summary.innerText(), /115\.75/);
    assert.match(await summary.innerText(), /cannot be issued until verified fee settlement/);
    assert.match(await summary.innerText(), /not a payment receipt/);
    const detail = await request(citizen, `/applications/${application.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.order.totalMinor, 11575);
    const revised = await request(admin, "/admin/services/45/order-policies", "POST", { ...policyInput, expectedVersion: 1, statutoryFeeMinor: 20000 });
    assert.equal(revised.status, 201, JSON.stringify(revised.data));
    const unchanged = await request(citizen, `/applications/${application.id}`);
    assert.deepEqual(unchanged.data.order, detail.data.order, "New office policy must not rewrite an existing fee snapshot");
    await citizen.screenshot({ path: "execution/screenshots/order-snapshot-mobile-en.png", fullPage: true });

    await login(staff, staffEmail);
    assert.equal(await staff.getByRole("button", { name: "Office administration", exact: true }).count(), 0);
    assert.equal(await staff.getByRole("tab", { name: "Application fee policies", exact: true }).count(), 0);
    const denied = await request(staff, "/admin/services/45/order-policies", "POST", { ...policyInput, expectedVersion: 2 });
    assert.equal(denied.status, 403);
    assert.deepEqual(errors, []);
  } finally { await Promise.all([adminContext.close(), citizenContext.close(), staffContext.close()]); }
});

test("order browser: delayed policy load cannot populate another service's blank fee editor", { timeout: 60000 }, async () => {
  const context = await browser.newContext(), page = await context.newPage();
  let releasePolicy: (() => void) | undefined;
  try {
    await login(page, adminEmail);
    const configured = await request(page, "/admin/services/44/order-policies", "POST", policyInput);
    assert.equal(configured.status, 201, JSON.stringify(configured.data));
    await nav(page, "Office administration");
    await page.getByRole("tab", { name: "Application fee policies", exact: true }).click();
    let arrived!: () => void, done!: () => void;
    const responseArrived = new Promise<void>((resolve) => { arrived = resolve; });
    const released = new Promise<void>((resolve) => { releasePolicy = resolve; });
    const completed = new Promise<void>((resolve) => { done = resolve; });
    await page.route("**/api/v1/services/44/order-options", async (route) => {
      const response = await route.fetch();
      arrived();
      await released;
      await route.fulfill({ response });
      done();
    }, { times: 1 });
    await page.locator("#order-policy-service").selectOption("44");
    await responseArrived;
    await page.locator("#order-policy-service").selectOption("42");
    await page.getByText("No fee policy configured", { exact: true }).waitFor();
    const obsoleteResponse = page.waitForResponse((response) => response.url().endsWith("/services/44/order-options"));
    releasePolicy!();
    await completed;
    await (await obsoleteResponse).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.locator("#order-policy-service").inputValue(), "42");
    for (const key of ["statutory", "processing", "emergency", "office_collection", "digital_copy"]) assert.equal(await page.locator(`#order-fee-${key}`).inputValue(), "");
    assert.equal(await page.locator("#order-mode-office_collection").isChecked(), false);
    assert.equal(await page.locator("#order-urgency-normal").isChecked(), false);
    assert.equal(await page.getByText("Current version: 1", { exact: true }).count(), 0);
  } finally { releasePolicy?.(); await context.close(); }
});
