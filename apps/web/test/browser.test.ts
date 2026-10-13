import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
const origin = "http://127.0.0.1:5173";
let ownedStack: ChildProcess | undefined;
async function ready() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${origin}/api/v1/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Local app did not become ready.");
}
async function start() {
  try {
    if ((await fetch(`${origin}/api/v1/health`)).ok) return;
  } catch {}
  ownedStack = spawn(process.execPath, ["--import", "tsx", "scripts/dev.ts"], {
    stdio: "pipe",
  });
  await ready();
}
async function login(page: Page, role: string, tenant = "alpha") {
  await page.goto(origin);
  await page
    .getByLabel("Email", { exact: true })
    .fill(
      role === "owner"
        ? "owner@astra.demo.test"
        : `${role}@${tenant}.demo.test`,
    );
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(page: Page, name: string) {
  const bn: Record<string, string> = {
    Applications: "আবেদন",
    "Service catalog": "সেবার তালিকা",
    "Subscription & credits": "সাবস্ক্রিপশন ও ক্রেডিট",
    Citizens: "নাগরিক",
  };
  await page
    .getByRole("navigation")
    .getByRole("button", { name: new RegExp(`${name}|${bn[name] || name}`) })
    .click();
}
async function openById(page: Page, id: string) {
  await nav(page, "Applications");
  const row = page.getByRole("row").filter({ hasText: id.slice(0, 8) });
  await row.getByRole("button", { name: "Open application" }).click();
  await page
    .getByText(`APPLICATION ${id.slice(0, 8)}`, { exact: true })
    .waitFor();
}
async function action(page: Page, text: string) {
  const response = page.waitForResponse(
    (r) => r.url().includes("/transition") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: text, exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200, await result.text());
  await page.getByText(`${text} completed.`, { exact: true }).waitFor();
}
let browser: Browser;
test(
  "browser: citizen → staff visibility → correction → authorized approval → real PDF/QR → exactly-once debit",
  { timeout: 120000 },
  async () => {
    await start();
    const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    const executable =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (fs.existsSync(local) ? fs.readdirSync(local) : [])
        .filter((n) => /^chromium-/.test(n))
        .sort()
        .reverse()
        .map((n) => path.join(local, n, "chrome-win64", "chrome.exe"))
        .find((p) => fs.existsSync(p));
    browser = await chromium.launch({
      headless: true,
      executablePath: executable,
    });
    fs.mkdirSync("execution/screenshots", { recursive: true });
    const contexts = await Promise.all(
      Array.from({ length: 4 }, () =>
        browser.newContext({ viewport: { width: 1440, height: 1024 } }),
      ),
    );
    const [citizen, staff, reviewer, approver] = await Promise.all(
      contexts.map((c) => c.newPage()),
    );
    const errors: string[] = [];
    for (const page of [citizen, staff, reviewer, approver])
      page.on("pageerror", (e) => errors.push(e.message));
    try {
      await login(citizen, "citizen");
      await nav(citizen, "Service catalog");
      await citizen
        .getByLabel("Citizen / নাগরিক", { exact: true })
        .selectOption({ index: 1 });
      await citizen
        .getByLabel("Purpose (English)", { exact: false })
        .fill("Browser acceptance demonstration");
      const createdResponse = citizen.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await citizen
        .getByRole("button", { name: "Save draft application", exact: true })
        .click();
      const created = await createdResponse;
      assert.equal(created.status(), 201, await created.text());
      const application = await created.json();
      await citizen
        .getByText(`APPLICATION ${application.id.slice(0, 8)}`, { exact: true })
        .waitFor();
      await action(citizen, "Submit application");
      await login(staff, "staff");
      await openById(staff, application.id);
      assert.equal(
        await staff
          .getByRole("button", { name: "Approve application", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await staff.getByRole("button", { name: /Issue demo/ }).count(),
        0,
      );
      await staff.screenshot({
        path: "execution/screenshots/staff-application.png",
        fullPage: true,
      });
      await login(reviewer, "reviewer");
      await openById(reviewer, application.id);
      await action(reviewer, "Begin review");
      await reviewer
        .getByLabel("Review, approval or revocation reason", { exact: true })
        .fill("Clarify the synthetic demonstration purpose.");
      await action(reviewer, "Request correction");
      await citizen.reload();
      await openById(citizen, application.id);
      await citizen
        .getByLabel("Purpose (English)", { exact: false })
        .fill("Corrected browser acceptance purpose");
      const saved = citizen.waitForResponse(
        (r) => r.request().method() === "PATCH",
      );
      await citizen
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      assert.equal((await saved).status(), 200);
      await citizen
        .getByText("New immutable payload version saved.", { exact: true })
        .waitFor();
      await action(citizen, "Resubmit application");
      await reviewer.reload();
      await openById(reviewer, application.id);
      await action(reviewer, "Begin review");
      await login(approver, "approver");
      await openById(approver, application.id);
      await action(approver, "Approve application");
      const before = await approver.evaluate(
        async () => await (await fetch("/api/v1/wallet")).json(),
      );
      const issuedResponse = approver.waitForResponse(
        (r) => r.url().endsWith("/issue") && r.request().method() === "POST",
      );
      await approver
        .getByRole("button", {
          name: "Issue demo certificate · 1 credit",
          exact: true,
        })
        .click();
      const issued = await issuedResponse;
      assert.equal(issued.status(), 201, await issued.text());
      const certificate = await issued.json();
      await approver
        .getByRole("link", { name: "Download PDF", exact: true })
        .waitFor();
      await approver.screenshot({
        path: "execution/screenshots/issued-resident.png",
        fullPage: true,
      });
      const after = await approver.evaluate(
        async () => await (await fetch("/api/v1/wallet")).json(),
      );
      assert.equal(after.balance, before.balance - 1);
      const retryResponse = approver.waitForResponse(
        (r) => r.url().endsWith("/issue") && r.request().method() === "POST",
      );
      await approver
        .getByRole("button", { name: "Retry issuance safely", exact: true })
        .click();
      const retry = await retryResponse;
      assert.ok([200, 201].includes(retry.status()));
      assert.equal((await retry.json()).id, certificate.id);
      const retryWallet = await approver.evaluate(
        async () => await (await fetch("/api/v1/wallet")).json(),
      );
      assert.equal(retryWallet.balance, after.balance);
      const pdf = await contexts[3].request.get(
        `${origin}${certificate.pdfUrl}`,
      );
      assert.equal(pdf.status(), 200);
      const bytes = await pdf.body();
      assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
      fs.writeFileSync("execution/browser-resident-demo.pdf", bytes);
      fs.writeFileSync(
        "execution/browser-certificate.json",
        JSON.stringify(
          {
            id: certificate.id,
            number: certificate.number,
            verificationUrl: certificate.verificationUrl,
            applicationId: application.id,
          },
          null,
          2,
        ),
      );
      const anonymous = await browser.newContext();
      const verify = await anonymous.newPage();
      await verify.goto(certificate.verificationUrl);
      await verify.getByText("ISSUED", { exact: true }).waitFor();
      assert.equal(
        await verify.getByText("Demo Citizen", { exact: true }).count(),
        0,
      );
      await verify.screenshot({
        path: "execution/screenshots/public-verification.png",
        fullPage: true,
      });
      const privatePdf = await anonymous.request.get(
        `${origin}${certificate.pdfUrl}`,
      );
      assert.equal(privatePdf.status(), 401);
      await verify.goto(`${origin}/verify/invalid-token`);
      await verify
        .getByText(
          "Certificate not found. The verification link may be invalid.",
          { exact: true },
        )
        .waitFor();
      await anonymous.close();
      const detail = await contexts[3].request.get(
        `${origin}/api/v1/applications/${application.id}`,
      );
      const persisted = await detail.json();
      assert.equal(persisted.versions.length, 2);
      assert.equal(
        persisted.payload.purpose_en,
        "Corrected browser acceptance purpose",
      );
      assert.equal(persisted.application.state, "ISSUED");
      assert.deepEqual(errors, []);
    } finally {
      for (const context of contexts) await context.close();
    }
  },
);
test(
  "browser: family/trade conditional validation, real private upload, finance settlement and mobile keyboard layout",
  { timeout: 120000 },
  async () => {
    assert.ok(browser);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      await login(page, "staff");
      assert.equal(
        await page
          .getByRole("button", { name: /Subscription & credits/ })
          .count(),
        0,
      );
      await nav(page, "Service catalog");
      await page
        .getByRole("button", { name: /02.*Family certificate/ })
        .click();
      await page.getByRole("button", { name: "Remove 1", exact: true }).click();
      await page
        .getByLabel("Citizen / নাগরিক", { exact: true })
        .selectOption({ index: 1 });
      await page
        .getByRole("button", { name: "Save draft application", exact: true })
        .click();
      await page
        .getByText("Please correct the highlighted fields.", { exact: true })
        .waitFor();
      assert.ok(await page.locator('fieldset[aria-invalid="true"]').count());
      await page
        .getByRole("button", { name: "Fill synthetic example", exact: true })
        .click();
      const familyResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save draft application", exact: true })
        .click();
      assert.equal((await familyResponse).status(), 201);
      await page
        .getByText("Draft saved to PostgreSQL.", { exact: true })
        .waitFor();
      await nav(page, "Service catalog");
      await page.getByRole("button", { name: /42.*Trade license/ }).click();
      await page
        .getByLabel("Citizen / নাগরিক", { exact: true })
        .selectOption({ index: 1 });
      await page
        .getByRole("button", { name: "Add supporting documents", exact: false })
        .click();
      await page
        .getByLabel("Document description", { exact: false })
        .fill("Synthetic PDF evidence");
      const uploadResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/attachments") && r.request().method() === "POST",
      );
      await page.locator('input[type="file"]').setInputFiles({
        name: "synthetic.pdf",
        mimeType: "application/pdf",
        buffer: fs.readFileSync("execution/browser-resident-demo.pdf"),
      });
      assert.equal((await uploadResponse).status(), 201);
      await page.getByText(/Private upload saved:/).waitFor();
      const tradeResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save draft application", exact: true })
        .click();
      assert.equal((await tradeResponse).status(), 201);
      await page
        .getByText("Draft saved to PostgreSQL.", { exact: true })
        .waitFor();
      await page.screenshot({
        path: "execution/screenshots/mobile-trade.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "No mobile horizontal document overflow",
      );
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await login(page, "finance");
      assert.equal(
        await page
          .getByRole("navigation")
          .getByRole("button", { name: /Applications|Citizens/ })
          .count(),
        0,
      );
      await nav(page, "Subscription & credits");
      const created = page.waitForResponse(
        (r) =>
          r.url().endsWith("/billing/orders") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Create 10-credit top-up", exact: true })
        .click();
      const order = await (await created).json();
      await page.getByText(order.id.slice(0, 8), { exact: true }).waitFor();
      const row = page
        .getByRole("row")
        .filter({ hasText: order.id.slice(0, 8) });
      const settle = page.waitForResponse(
        (r) =>
          r.url().endsWith("/demo-settle") && r.request().method() === "POST",
      );
      await row
        .getByRole("button", { name: "Settle in local sandbox", exact: true })
        .click();
      assert.equal((await settle).status(), 200);
      await page
        .getByText(
          "Verified sandbox settlement processed. Replay cannot grant credits twice.",
          { exact: true },
        )
        .waitFor();
      await page.screenshot({
        path: "execution/screenshots/billing-sandbox.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "password",
      );
    } finally {
      await context.close();
      await browser.close();
      if (ownedStack) ownedStack.kill();
    }
  },
);
test(
  "browser: staff citizen registration and owner compensating adjustments persist with role boundaries",
  { timeout: 60000 },
  async () => {
    await start();
    const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    const executable =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (fs.existsSync(local) ? fs.readdirSync(local) : [])
        .filter((n) => /^chromium-/.test(n))
        .sort()
        .reverse()
        .map((n) => path.join(local, n, "chrome-win64", "chrome.exe"))
        .find((p) => fs.existsSync(p));
    const browser = await chromium.launch({
      headless: true,
      executablePath: executable,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    try {
      await login(page, "staff");
      await nav(page, "Citizens");
      await page
        .getByLabel("Demo reference", { exact: true })
        .fill(`DEMO-BROWSER-${Date.now()}`);
      const registered = page.waitForResponse(
        (r) => r.url().endsWith("/citizens") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Register citizen", exact: true })
        .click();
      const response = await registered;
      assert.equal(response.status(), 201, await response.text());
      const citizen = await response.json();
      await page
        .getByText(
          "Citizen registered. Duplicate identity keys are rejected.",
          { exact: true },
        )
        .waitFor();
      await page
        .getByLabel("Search within your tenant", { exact: true })
        .fill(citizen.syntheticReference);
      await page.getByText(citizen.id.slice(0, 8), { exact: true }).waitFor();
      const duplicate = page.waitForResponse(
        (r) => r.url().endsWith("/citizens") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Register citizen", exact: true })
        .click();
      assert.equal((await duplicate).status(), 409);
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await login(page, "owner");
      await page
        .getByRole("navigation")
        .getByRole("button", { name: /Platform management/ })
        .click();
      assert.equal(
        await page
          .getByRole("navigation")
          .getByRole("button", { name: /Applications|Citizens/ })
          .count(),
        0,
      );
      const tenant = page
        .locator(".tenant-card")
        .filter({ hasText: "Demo Alpha Union" });
      await tenant.getByLabel("Credit adjustment", { exact: true }).fill("3");
      await tenant
        .getByLabel("Reason", { exact: true })
        .fill("Browser synthetic support adjustment");
      const adjusted = page.waitForResponse(
        (r) => r.url().endsWith("/adjust") && r.request().method() === "POST",
      );
      await tenant
        .getByRole("button", { name: "Record adjustment", exact: true })
        .click();
      assert.equal((await adjusted).status(), 201);
      await page
        .getByText("Audited compensating entry added.", { exact: true })
        .waitFor();
      await page.screenshot({
        path: "execution/screenshots/owner-tenants.png",
        fullPage: true,
      });
    } finally {
      await context.close();
      await browser.close();
      if (ownedStack) ownedStack.kill();
    }
  },
);
