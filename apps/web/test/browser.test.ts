import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { chromium, type Browser, type Page } from "playwright";
import { signOut } from "./fixtures/session.js";
import { fillApplicationForm } from "./fixtures/fill-form.js";
import { demoPayloads } from "@astra/shared-schemas";
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
  // REFINEMENT-02 P2-1(a) CONTRACT CHANGE (intentional): the home page no
  // longer embeds the sign-in form (compact CTA card instead), so sign-in
  // starts on the split-screen /login page — the same entry every other
  // browser suite uses.
  await page.goto(`${origin}/login`);
  await page
    .getByLabel("Email or mobile number", { exact: true })
    .fill(
      role === "owner"
        ? "owner@astra.demo.test"
        : `${role}@${tenant}.local.test`,
    );
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(page: Page, name: string) {
  const bn: Record<string, string> = {
    Applications: "আবেদন",
    "Service catalog": "সেবার তালিকা",
    "Subscription & credits": "সাবস্ক্রিপশন ও ক্রেডিট",
    Citizens: "নাগরিক",
  };
  void bn;
  await goToWorkspacePage(page, name);
}
async function openById(page: Page, reference: string) {
  await nav(page, "Applications");
  // FULL-UIUX-01: rows are identified by the application's 16-digit public
  // reference (RefChip) — truncated UUIDs are never rendered — and the row
  // action is named "Open".
  const row = page.getByRole("row").filter({ hasText: reference });
  await row.getByRole("button", { name: "Open", exact: true }).click();
  // The detail view's back button (the sidebar also carries an
  // "All applications" entry in the UDC navigation).
  await page
    .getByRole("button", { name: "← All applications", exact: true })
    .waitFor();
}
// UIUX-FIX-01: applications start from the catalog and run through the guided flow; drafts are
// saved from the flow's review step. completeFees walks the fees step like the flow tests do.
// FULL-UIUX-01: catalog entries are ServiceCards named by category + name.
const serviceNames: Record<string, string> = {
  "45": "Permanent resident certificate",
};
function catalogTile(page: Page, serviceNo: string) {
  return page.locator("button.svc-card", {
    hasText: serviceNames[serviceNo],
  });
}
async function completeFees(page: Page) {
  const next = page.getByRole("button", {
    name: "Next: review and submit",
    exact: true,
  });
  const draftButton = page.getByRole("button", {
    name: "Save as draft only",
    exact: true,
  });
  const language = page.locator("#order-language");
  // The fees step settles asynchronously: the office's fee settings load
  // first, then the step either shows the order panel (language select) or —
  // when the office has no fee policy for the service (FULL-UIUX-01 FE S8) —
  // is skipped straight to the review step. Wait for either outcome instead
  // of racing the loading state.
  for (let i = 0; i < 80; i++) {
    if (await draftButton.isVisible().catch(() => false)) return;
    if (await language.isVisible().catch(() => false)) break;
    await page.waitForTimeout(250);
  }
  if (await draftButton.isVisible().catch(() => false)) return;
  try {
    await page.waitForFunction(
      () =>
        !(
          document.querySelector(
            ".ax-flow-actions button:last-child",
          ) as HTMLButtonElement
        )?.disabled,
      undefined,
      { timeout: 8000 },
    );
    await next.click();
    return;
  } catch {}
  if (await language.count()) {
    if (!(await language.inputValue())) await language.selectOption("bn");
  }
  const review = page.getByRole("button", { name: "Review fees" });
  if (await review.count()) await review.click();
  const accept = page.locator(".ax-flow input[type=checkbox]").last();
  await accept.waitFor();
  await accept.check();
  await page.waitForFunction(
    () =>
      !(
        document.querySelector(
          ".ax-flow-actions button:last-child",
        ) as HTMLButtonElement
      )?.disabled,
  );
  await next.click();
}
// FULL-UIUX-01: the transition confirmation banner is a full sentence in
// the reader's language (actionDone), not "<action> completed.".
const actionDoneText: Record<string, string> = {
  "Submit application": "Application submitted.",
  "Request correction": "Correction requested.",
  "Resubmit application": "Application resubmitted.",
};
async function action(page: Page, text: string) {
  const response = page.waitForResponse(
    (r) => r.url().includes("/transition") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: text, exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200, await result.text());
  // The same sentence also appears as a timeline entry heading on the
  // detail page — assert the confirmation banner (role=status) itself.
  await page
    .getByRole("status")
    .filter({ hasText: actionDoneText[text] })
    .waitFor();
}
let browser: Browser;
test(
  "browser: citizen → staff visibility → correction → authorized approval → real PDF/QR → fee settled once at submit, no issuance debit",
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
    for (const context of contexts)
      await context.addInitScript(() =>
        localStorage.setItem("astra.language", "en"),
      );
    const errors: string[] = [];
    for (const page of [citizen, staff, reviewer, approver])
      page.on("pageerror", (e) => errors.push(e.message));
    try {
      await login(citizen, "citizen");
      await nav(citizen, "Service catalog");
      await catalogTile(citizen, "45").click();
      // FULL-UIUX-01 (UX M14): a signed-in citizen applying for themselves
      // skips the citizen step — their own record is pre-selected and the
      // flow opens directly on the application form.
      await fillApplicationForm(citizen, demoPayloads[45]);
      await citizen
        .getByLabel("Purpose (English)", { exact: false })
        .fill("Browser acceptance demonstration");
      await citizen
        .getByRole("button", { name: "Next: fees and delivery", exact: true })
        .click();
      await completeFees(citizen);
      const createdResponse = citizen.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await citizen
        .getByRole("button", { name: "Save as draft only", exact: true })
        .click();
      const created = await createdResponse;
      assert.equal(created.status(), 201, await created.text());
      const application = await created.json();
      await citizen
        .getByRole("button", { name: "Open application", exact: true })
        .click();
      await citizen
        .locator(".ax-refchip")
        .filter({ hasText: application.reference })
        .first()
        .waitFor();
      await action(citizen, "Submit application");
      await login(staff, "staff");
      await openById(staff, application.reference);
      assert.equal(
        await staff
          .getByRole("button", { name: "Approve and issue certificate", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await staff.getByRole("button", { name: /Issue certificate/ }).count(),
        0,
      );
      await staff.screenshot({
        path: "execution/screenshots/staff-application.png",
        fullPage: true,
      });
      await login(reviewer, "reviewer");
      await openById(reviewer, application.reference);
      // Phase W: the Secretary (reviewer) is view-only — no decision buttons.
      assert.equal(
        await reviewer
          .getByRole("button", { name: "Request correction", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await reviewer
          .getByRole("button", {
            name: "Approve and issue certificate",
            exact: true,
          })
          .count(),
        0,
      );
      await login(approver, "approver");
      await openById(approver, application.reference);
      await approver
        .getByLabel("Decision or revocation reason", { exact: true })
        .fill("Clarify the synthetic demonstration purpose.");
      await action(approver, "Request correction");
      await citizen.reload();
      await openById(citizen, application.reference);
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
        .getByText("Changes saved.", { exact: true })
        .waitFor();
      await action(citizen, "Resubmit application");
      await approver.reload();
      await openById(approver, application.reference);
      const before = await approver.evaluate(
        async () => await (await fetch("/api/v1/wallet")).json(),
      );
      // QA-13 (PR #55): approving first asks window.confirm
      // (WorkspaceApp.tsx transition()). With no dialog handler
      // registered Playwright auto-dismisses it, the confirm reads as
      // "Cancel" and the transition POST is never sent — accept the
      // dialog explicitly so the approval below can run.
      approver.on("dialog", (dialog) => void dialog.accept());
      // Phase W: one click — the Chairman's approval issues the certificate.
      const issuedResponse = approver.waitForResponse(
        (r) =>
          r.url().endsWith("/transition") && r.request().method() === "POST",
      );
      await approver
        .getByRole("button", {
          name: "Approve and issue certificate",
          exact: true,
        })
        .click();
      const issued = await issuedResponse;
      assert.equal(issued.status(), 200, await issued.text());
      const certificate = (await issued.json()).certificate;
      assert.ok(certificate?.id);
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
      // Phase 3B: approval/issuance debits nothing — the application fee
      // settled once at the first submit (subscription allowance here).
      assert.equal(after.balance, before.balance);
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
      await anonymous.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      const verify = await anonymous.newPage();
      await verify.goto(certificate.verificationUrl);
      // HOME-REDESIGN-01: the public verify page answers with a verdict
      // sentence, not the old status badge — and this stack issues
      // DEMO-mode certificates, so the correct verdict is the demo one.
      await verify.getByText("This is a demo certificate", { exact: true }).waitFor();
      assert.equal(
        await verify.getByText("Karim Uddin", { exact: true }).count(),
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
    await context.addInitScript(() =>
      localStorage.setItem("astra.language", "en"),
    );
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
        .locator("button.svc-card", { hasText: "Family certificate" })
        .click();
      await page.locator(".ax-citizen input").first().check();
      await page
        .getByRole("button", { name: "Next: application form", exact: true })
        .click();
      await fillApplicationForm(page, demoPayloads[2]);
      await page.getByRole("button", { name: "Remove 1", exact: true }).click();
      await page
        .getByRole("button", { name: "Next: fees and delivery", exact: true })
        .click();
      // The flow surfaces validation as its error summary plus invalid groups (P2-10: repeatables render as [role="group"], not fieldsets).
      await page.locator(".ax-flow .error-summary").waitFor();
      assert.ok(await page.locator('[role="group"][aria-invalid="true"]').count());
      await fillApplicationForm(page, demoPayloads[2]);
      await page
        .getByRole("button", { name: "Next: fees and delivery", exact: true })
        .click();
      await completeFees(page);
      const familyResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save as draft only", exact: true })
        .click();
      assert.equal((await familyResponse).status(), 201);
      await page
        .getByText("The application is saved as a draft; it is not submitted yet.", { exact: true })
        .waitFor();
      await nav(page, "Service catalog");
      await page
        .locator("button.svc-card", { hasText: "Trade license" })
        .click();
      await page.locator(".ax-citizen input").first().check();
      await page
        .getByRole("button", { name: "Next: application form", exact: true })
        .click();
      await fillApplicationForm(page, demoPayloads[42]);
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
      await page.getByTestId("attachment-status").waitFor();
      await page.getByText("Waiting for safety check", { exact: true }).waitFor();
      assert.equal(await page.getByRole("link", { name: "Download document", exact: true }).count(), 0);
      await page
        .getByRole("button", { name: "Next: fees and delivery", exact: true })
        .click();
      await completeFees(page);
      const tradeResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save as draft only", exact: true })
        .click();
      assert.equal((await tradeResponse).status(), 201);
      await page
        .getByText("The application is saved as a draft; it is not submitted yet.", { exact: true })
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
      await signOut(page);
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
        .getByRole("button", { name: "Settle payment", exact: true })
        .click();
      assert.equal((await settle).status(), 200);
      await page
        .getByText(
          "Payment settled. Settling the same order again cannot grant credits twice.",
          { exact: true },
        )
        .waitFor();
      await page.screenshot({
        path: "execution/screenshots/billing-sandbox.png",
        fullPage: true,
      });
      await signOut(page);
      await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("Email or mobile number", { exact: true }).inputValue(),
        "",
        "Signing out clears the previous account from the form without navigation",
      );
      assert.equal(
        await page.getByLabel("Password", { exact: true }).inputValue(),
        "",
        "Signing out never restores the submitted password or initial local demo password",
      );
      await page.getByLabel("Email or mobile number", { exact: true }).focus();
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
    await context.addInitScript(() =>
      localStorage.setItem("astra.language", "en"),
    );
    const page = await context.newPage();
    try {
      await login(page, "staff");
      await nav(page, "Citizens");
      for (const [key, value] of Object.entries({ nameBn: "নমুনা নাগরিক", nameEn: "Browser Registered Citizen", dateOfBirth: "1994-01-01", addressBn: "নমুনা গ্রাম", addressEn: "Sample village" })) await page.locator(`#citizen-${key}`).fill(value);
      await page.getByRole("button", { name: "Continue", exact: true }).click(); // B-4: P2-7 stepper — advance to the next registration step
      const union = JSON.parse(fs.readFileSync("data/geo/unions.json", "utf8")).find((row: any) => row.upazilaCode === "upa-001");
      for (const [level, code] of [["division", "div-01"], ["district", "dis-01"], ["upazila", "upa-001"], ["union", union.code], ["ward", `${union.code}-w01`]]) {
        await page.locator(`#citizen-geo-${level} option[value="${code}"]`).waitFor({ state: "attached" });
        await page.locator(`#citizen-geo-${level}`).selectOption(code);
      }
      await page.getByRole("button", { name: "Continue", exact: true }).click(); // B-4: P2-7 stepper — advance to the details step
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
      // FULL-UIUX-01 (C31/P2-7): the citizens list shows the citizen's own
      // 16-digit reference, never a truncated UUID.
      await page.getByText(citizen.syntheticReference, { exact: true }).waitFor();
      // Phase 5: server-generated citizen references used the public format
      // (dddddd-dddddd-dddddd), not the old REF-<uuid>. CERTNO-01: references
      // are now a plain 16-digit number (Dhaka date + 8 random digits).
      assert.match(citizen.syntheticReference, /^\d{16}$/);
      assert.equal(response.request().postDataJSON().geography.unionCode, union.code);
      const session = await (await context.request.get(`${origin}/api/v1/auth/me`)).json();
      // Duplicate identity keys are rejected. Server-generated references use the
      // CERTNO-01 16-digit format, which callers cannot supply (the schema accepts only REF-…),
      // so the duplicate check uses an explicit reference, as API clients do.
      const explicit = {
        ...response.request().postDataJSON(),
        syntheticReference: "REF-DUP-BROWSER-001",
      };
      const first = await context.request.post(`${origin}/api/v1/citizens`, {
        data: explicit,
        headers: { "X-CSRF-Token": session.csrfToken },
      });
      assert.equal(first.status(), 201, await first.text());
      const duplicate = await context.request.post(`${origin}/api/v1/citizens`, {
        data: explicit,
        headers: { "X-CSRF-Token": session.csrfToken },
      });
      assert.equal(duplicate.status(), 409);
      await signOut(page);
      await login(page, "owner");
      // FULL-UIUX-01: the platform owner lands directly on the owner
      // console; on that page the workspace sidebar collapses to the brand
      // strip, so navigation runs through the console's own section nav.
      await page.locator(".owner-nav").waitFor();
      // Role boundary: the owner's workspace nav offers no office-workspace
      // pages (Applications/Citizens) at all.
      assert.equal(
        await page.locator('nav.ws-nav button[data-page="applications"]').count(),
        0,
      );
      assert.equal(
        await page.locator('nav.ws-nav button[data-page="citizens"]').count(),
        0,
      );
      // OWNER-REDESIGN-01: office cards live in the Offices section (one section at a time).
      await page.locator('.owner-nav a[href="#owner-offices"]').click();
      const tenant = page
        .locator(".tenant-card")
        .filter({ hasText: "Alpha Union" });
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
      // Viewport only: the owner page lists every office, and a full-page capture of a long-lived
      // test database (hundreds of offices) crashed the headless browser.
      await page.screenshot({
        path: "execution/screenshots/owner-tenants.png",
      });
    } finally {
      await context.close();
      await browser.close();
      if (ownedStack) ownedStack.kill();
    }
  },
);
