import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { chromium, type Page } from "playwright";
import { fillApplicationForm } from "./fixtures/fill-form.js";
import { demoPayloads } from "@astra/shared-schemas";
const base = "http://127.0.0.1:5173";
async function launch() {
  const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((n) => /^chromium-/.test(n))
      .sort()
      .reverse()
      .map((n) => path.join(local, n, "chrome-win64", "chrome.exe"))
      .find((f) => fs.existsSync(f));
  return chromium.launch({ headless: true, executablePath });
}
async function login(page: Page, role = "staff") {
  await page.goto(`${base}/login`);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${role}@alpha.local.test`);
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "What would you like to do?", exact: true })
    .waitFor();
}
async function nav(page: Page, name: string) {
  await goToWorkspacePage(page, name);
}
// UIUX-FIX-01: the services page is a launch catalog; applications run through the guided flow and
// drafts are saved from its review step. completeFees walks the flow's fees step.
async function completeFees(page: Page) {
  const next = page.getByRole("button", { name: "Next: review and submit" });
  try {
    await page.waitForFunction(
      () => !(document.querySelector(".ax-flow-actions button:last-child") as HTMLButtonElement)?.disabled,
      undefined,
      { timeout: 8000 },
    );
    return next;
  } catch {}
  const language = page.locator("#order-language");
  if (!(await language.inputValue())) await language.selectOption("bn");
  const review = page.getByRole("button", { name: "Review fees" });
  if (await review.count()) await review.click();
  const accept = page.locator(".ax-flow input[type=checkbox]").last();
  await accept.waitFor();
  await accept.check();
  await page.waitForFunction(
    () => !(document.querySelector(".ax-flow-actions button:last-child") as HTMLButtonElement)?.disabled,
  );
  return next;
}

test(
  "workspace usability: mobile task entry, bilingual search, actionable validation and draft-to-submit guidance",
  { timeout: 90000 },
  async () => {
    const browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await login(page);
      assert.equal(await page.locator(".workspace-tasks button").count(), 3);
      await page.getByRole("button", { name: /Start an application/ }).click();
      await page.locator("#service-search").waitFor();
      await page.locator("#service-search").fill("৪৫");
      assert.equal(await page.locator(".catalog .service").count(), 1);
      await page.locator("#service-search").fill("no-such-service-ux");
      await page
        .getByRole("heading", { name: "No matching service.", exact: true })
        .waitFor();
      await page
        .getByText("Try a different name or service number.", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      assert.equal(await page.locator(".catalog .service").count(), 47);
      // Launch the guided flow for service 45 from the catalog.
      await page
        .locator(".catalog .service")
        .filter({ has: page.locator('.service-number:text-is("45")') })
        .click();
      await page.getByRole("list", { name: "Application steps" }).waitFor();
      await page.locator(".ax-citizen input").first().check();
      // Phase 5: citizens may carry a legacy REF-… reference or the new public
      // format (dddddd-dddddd-dddddd); either must be stable across the switch.
      const refOf = (text: string) => text.match(/REF-[0-9a-f-]+|\d{6}-\d{6}-\d{6}/)?.[0];
      const firstCitizenRef = refOf(
        await page.locator("label.ax-citizen:has(input:checked)").innerText(),
      );
      assert.ok(firstCitizenRef);
      await page
        .getByRole("button", { name: "Next: application form", exact: true })
        .click();
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      await page.getByRole("list", { name: "আবেদনের ধাপ" }).waitFor();
      // The chosen citizen survives the interface-language switch (labels localise; the REF is stable).
      await page.getByRole("button", { name: "← নাগরিক", exact: true }).click();
      assert.equal(
        refOf(await page.locator("label.ax-citizen:has(input:checked)").innerText()),
        firstCitizenRef,
      );
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page
        .getByRole("button", { name: "Next: application form", exact: true })
        .click();
      // Advancing with an empty form surfaces the flow's actionable error summary.
      await page
        .getByRole("button", { name: "Next: fees and delivery", exact: true })
        .click();
      await page.locator(".ax-flow .error-summary").waitFor();
      const firstError = page.locator(".ax-flow .error-summary button").first();
      await firstError.click();
      assert.ok(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("data-field-path"),
        ),
      );
      await fillApplicationForm(page, demoPayloads[45]);
      await page
        .getByRole("button", { name: "Next: fees and delivery", exact: true })
        .click();
      await (await completeFees(page)).click();
      const created = page.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save as draft only", exact: true })
        .click();
      assert.equal((await created).status(), 201);
      await page
        .getByText("The application is saved as a draft; it is not submitted yet.", {
          exact: true,
        })
        .waitFor();
      await page
        .getByRole("button", { name: "Open application", exact: true })
        .click();
      await page.locator(".application-guidance").waitFor();
      assert.match(
        await page.locator(".application-guidance").innerText(),
        /draft|submit/i,
      );
      const submitted = page.waitForResponse(
        (r) =>
          r.url().includes("/transition") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Submit application", exact: true })
        .click();
      assert.equal((await submitted).status(), 200);
      await page
        .getByText("Submit application completed.", { exact: true })
        .waitFor();
      assert.match(
        await page.locator(".application-guidance").innerText(),
        /verification|office/i,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Approve and issue certificate", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({
        path: "execution/screenshots/usability-workspace-detail.png",
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    } finally {
      await browser.close();
    }
  },
);

test(
  "workspace usability: mobile page picker, empty search recovery and language retention",
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await login(page);
      await page.locator("#workspace-jump").selectOption("applications");
      await page
        .locator("#application-search")
        .fill("no-existing-application-ux-unique");
      await page
        .getByRole("heading", { name: "No matching applications", exact: true })
        .waitFor();
      await page.locator("#state-filter").selectOption("CANCELLED");
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      assert.equal(
        await page.locator("#state-filter").inputValue(),
        "CANCELLED",
      );
      await page
        .getByRole("button", { name: "সব ফিল্টার মুছুন", exact: true })
        .click();
      assert.equal(await page.locator("#application-search").inputValue(), "");
      assert.equal(await page.locator("#state-filter").inputValue(), "");
      // On phones the applications list renders as cards, not table rows.
      await page.locator(".ax-card-list .ax-card").first().waitFor();
      await page.locator("#workspace-jump").selectOption("home");
      await page
        .getByRole("heading", { name: "আজ কী করতে চান?", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: "execution/screenshots/usability-workspace-home-bn.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: "execution/screenshots/usability-workspace-home-en.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    } finally {
      await browser.close();
    }
  },
);

test(
  "workspace usability: role-specific tasks route to authorized queues without approving",
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    try {
      for (const [role, label, state] of [
        ["reviewer", "View submitted applications", "SUBMITTED"],
        ["approver", "Verify submitted applications", "SUBMITTED"],
        ["finance", "View payments and receipts", ""],
      ] as const) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
        await login(page, role);
        assert.equal(
          await page
            .getByRole("button", { name: /Start an application/ })
            .count(),
          0,
        );
        await page.getByRole("button", { name: new RegExp(label) }).click();
        if (state) {
          await page.locator("#state-filter").waitFor();
          assert.equal(await page.locator("#state-filter").inputValue(), state);
        } else {
          await page.locator(".payments-workspace").waitFor();
          assert.equal(await page.locator("#state-filter").count(), 0);
        }
        await page
          .getByRole("button", { name: "Sign out", exact: true })
          .click();
        await context.close();
      }
    } finally {
      await browser.close();
    }
  },
);
