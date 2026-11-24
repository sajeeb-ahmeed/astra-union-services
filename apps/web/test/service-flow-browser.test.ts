import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { fillApplicationForm } from "./fixtures/fill-form.js";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { demoPayloads } from "@astra/shared-schemas";
const origin = "http://127.0.0.1:5173";
async function browserInstance(): Promise<Browser> {
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const executable =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local)
      ? fs
          .readdirSync(local)
          .filter((name) => /^chromium-/.test(name))
          .sort()
          .reverse()
          .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
          .find((filename) => fs.existsSync(filename))
      : undefined);
  return chromium.launch({ headless: true, executablePath: executable });
}
async function signIn(page: Page, query: string) {
  await page.addInitScript(() => localStorage.setItem("astra.language", "en"));
  await page.goto(`${origin}/login${query}`); // B-3: sign-in lives at /login since P2-1(a) removed the embedded home form
  await page.getByLabel("Email or mobile number", { exact: true }).fill("staff@alpha.local.test");
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
const stepHeading = (page: Page) => page.locator("#ax-flow-step-heading");
/** Entry: the dashboard's task opens the service catalog; its ServiceCard starts the flow. */
async function startFlow(page: Page, serviceNo: number) {
  await page.getByRole("button", { name: /Start an application/ }).click();
  await page.locator("#service-search").waitFor();
  await page.locator(`.catalog .svc-card[data-service="${serviceNo}"]`).click();
}
/** Fees step: rendered only when the office configured a fee policy for the
 * service; with none (the seeded alpha office) the flow auto-skips it
 * (feeStepEmpty), so this completes the quote/acceptance when the step
 * renders and otherwise just confirms the review step. */
async function advanceToReview(page: Page) {
  await Promise.race([
    page.locator("#order-language").waitFor(),
    page
      .getByRole("button", { name: "Save as draft only", exact: true })
      .waitFor(),
  ]).catch(() => {});
  if (await page.locator("#order-language").count()) {
    const language = page.locator("#order-language");
    if (!(await language.inputValue())) await language.selectOption("bn");
    await page.getByRole("button", { name: "Review fees" }).click();
    const accept = page.locator(".order-panel input[type=checkbox]");
    await accept.waitFor();
    await accept.check();
    await page.waitForFunction(
      () => !(document.querySelector(".ax-flow-actions button:last-child") as HTMLButtonElement)?.disabled,
    );
    await page
      .getByRole("button", { name: "Next: review and submit" })
      .click();
  }
  await page
    .getByRole("button", { name: "Save as draft only", exact: true })
    .waitFor();
}

test(
  "Phase 1 service flow: citizen → form → fees → review → submitted, validation, back navigation and new-citizen return",
  { timeout: 150000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await signIn(page, "");
      await startFlow(page, 45);

      // Step 1: citizen.
      await stepHeading(page).getByText("Citizen", { exact: true }).waitFor();
      assert.equal(await page.locator('.ax-stepper [aria-current="step"]').count(), 1);
      const next1 = page.getByRole("button", { name: "Next: application form" });
      assert.equal(await next1.isDisabled(), true, "a citizen must be chosen first");
      await page.locator(".ax-citizen").first().waitFor();
      await page.locator(".ax-citizen input").first().check();
      await next1.click();

      // Step 2: form validation blocks an empty form, then the filled example data passes.
      await stepHeading(page).getByText("Application form", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Next: fees and delivery" }).click();
      await page.locator(".ax-flow .error-summary").waitFor();
      await fillApplicationForm(page, demoPayloads[45]);
      await page.getByRole("button", { name: "Next: fees and delivery" }).click();

      // Step 3: fees. Alpha has no fee policy for this service, so the
      // flow auto-skips the fees step and lands on the review step.
      await advanceToReview(page);
      fs.mkdirSync("execution/screenshots", { recursive: true });

      // Back navigation keeps the entered form data. With the fees step
      // skipped, the review step's back button returns to the form.
      await page.getByRole("button", { name: "← Application form" }).click();
      await stepHeading(page).getByText("Application form", { exact: true }).waitFor();
      assert.equal(await page.locator(".ax-flow .error-summary").count(), 0);
      await page.getByRole("button", { name: "Next: fees and delivery" }).click();
      await advanceToReview(page);

      // Step 4: review, then submit.
      await stepHeading(page).getByText("Review and submit", { exact: true }).waitFor();
      assert.match((await page.locator(".ax-flow-summary").textContent()) ?? "", /Permanent resident/);
      await page.screenshot({ path: "execution/screenshots/phase1-service-flow-review.png", fullPage: true });
      const created = page.waitForResponse(
        (r) => r.url().endsWith("/api/v1/applications") && r.request().method() === "POST",
      );
      const submitted = page.waitForResponse(
        (r) => /\/transition$/.test(r.url()) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Submit application" }).click();
      assert.equal((await created).status(), 201);
      assert.equal((await submitted).status(), 200);
      const createdApplication = await (await created).json();

      // Step 5: done, with the reference; the server agrees it is submitted.
      // CERTNO-01: the done screen shows the public application reference
      // (16 digits), not the internal application UUID.
      await stepHeading(page).getByText("Done", { exact: true }).waitFor();
      const reference = (await page.locator(".ax-refchip code").textContent())!.trim();
      assert.match(reference, /^\d{16}$/);
      assert.equal(reference, createdApplication.reference);
      const stored = await page.evaluate(
        async (id) => (await (await fetch(`/api/v1/applications/${id}`)).json()).application.state,
        createdApplication.id,
      );
      assert.equal(stored, "SUBMITTED");
      await page.screenshot({ path: "execution/screenshots/phase1-service-flow-done.png", fullPage: true });
      await page.getByRole("button", { name: "Open application" }).click();
      await page.locator(".application-guidance").waitFor();
      assert.equal(
        (await page.locator(".ax-refchip code").first().textContent())!.trim(),
        createdApplication.reference,
      );

      // Registering a new citizen from the flow returns to it at the form, with that citizen chosen.
      await goToWorkspacePage(page, "home");
      await startFlow(page, 42);
      await stepHeading(page).getByText("Citizen", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Register a new citizen", exact: true }).click();
      const name = `Flow Browser Citizen ${Date.now()}`;
      await page.getByLabel("Name (English)", { exact: true }).fill(name);
      await page.getByLabel("Name (Bangla)", { exact: true }).fill("ফ্লো পরীক্ষার নমুনা নাগরিক");
      await page.getByLabel("Date of birth", { exact: true }).fill("1993-04-05");
      await page.getByLabel("Address (Bangla)", { exact: true }).fill("নমুনা পরীক্ষার গ্রাম");
      await page.getByLabel("Address (English)", { exact: true }).fill("Synthetic Flow Village");
      await page.getByRole("button", { name: "Continue", exact: true }).click(); // B-4: P2-7 stepper — advance to the next registration step
      const union = JSON.parse(fs.readFileSync("data/geo/unions.json", "utf8")).find(
        (row: any) => row.upazilaCode === "upa-001",
      );
      for (const [level, code] of [
        ["division", "div-01"],
        ["district", "dis-01"],
        ["upazila", "upa-001"],
        ["union", union.code],
        ["ward", `${union.code}-w01`],
      ]) {
        await page.locator(`#citizen-geo-${level} option[value="${code}"]`).waitFor({ state: "attached" });
        await page.locator(`#citizen-geo-${level}`).selectOption(code);
      }
      await page.getByRole("button", { name: "Continue", exact: true }).click(); // B-4: P2-7 stepper — advance to the details step
      const registered = page.waitForResponse(
        (r) => r.url().endsWith("/citizens") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Register citizen", exact: true }).click();
      assert.equal((await registered).status(), 201);
      await stepHeading(page).getByText("Application form", { exact: true }).waitFor();
      assert.match((await page.locator(".ax-flow").textContent()) ?? "", new RegExp(name));
      assert.match((await page.locator(".ax-flow-title").textContent()) ?? "", /Trade licen/);

      // Mobile: the stepper collapses and the page does not scroll sideways.
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await signIn(mobile, "");
      await startFlow(mobile, 45);
      await mobile.locator(".ax-citizen").first().waitFor();
      assert.equal(
        await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
      );
      await mobile.screenshot({ path: "execution/screenshots/phase1-service-flow-mobile.png", fullPage: true });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "QAFIX-05: service 23's profession and figures are always required and the earner select gates the earner fields",
  { timeout: 150000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await signIn(page, "");
      await startFlow(page, 23);
      await stepHeading(page).getByText("Citizen", { exact: true }).waitFor();
      await page.locator(".ax-citizen").first().waitFor();
      await page.locator(".ax-citizen input").first().check();
      await page.getByRole("button", { name: "Next: application form" }).click();
      await stepHeading(page).getByText("Application form", { exact: true }).waitFor();

      // QAFIX-05 removed both opt-in checkboxes: the profession pair and
      // the income figures are always visible, and the earner is a select.
      const form = page.getByTestId("service-application-form");
      assert.equal(
        await form.locator('[data-field-path="optradio"]').count(),
        0,
        "the registration opt-in is gone",
      );
      assert.equal(
        await form.locator('[data-field-path="other_person"]').count(),
        0,
        "the other-person checkbox is gone",
      );
      for (const path of [
        "income_info_amount",
        "income_info_amount_word",
        "profession_bn",
        "profession_en",
        "income_earner",
      ])
        assert.equal(
          await form.locator(`[data-field-path="${path}"]`).count(),
          1,
          `${path} is always visible`,
        );
      // With the earner unset the earner fields stay hidden.
      assert.equal(
        await form.locator('[data-field-path="other_person_name"]').count(),
        0,
        "the earner group stays hidden while no other earner is chosen",
      );

      // The demo payload (earner "self") fills the always-visible core
      // and the form advances. Before QAFIX-05 an untouched citizen
      // submitted with no profession and no named earner at all.
      await fillApplicationForm(page, demoPayloads[23]);
      await page.getByRole("button", { name: "Next: fees and delivery" }).click();
      // No fee policy for this service either: the fees step auto-skips
      // and the review step proves the form advanced.
      await stepHeading(page).getByText("Review and submit", { exact: true }).waitFor();

      // Back on the form, choosing another person reveals the earner
      // group and its required fields are enforced again.
      await page.getByRole("button", { name: "← Application form" }).click();
      await stepHeading(page).getByText("Application form", { exact: true }).waitFor();
      await page.locator('[data-field-path="income_earner"]').selectOption("other_person");
      await page.locator('[data-field-path="other_person_name"]').waitFor();
      await page.getByRole("button", { name: "Next: fees and delivery" }).click();
      const summary = page.locator(".ax-flow .error-summary");
      await summary.waitFor();
      // The summary names fields by their labels, not their paths.
      assert.match((await summary.textContent()) ?? "", /Other person name: This field is required\./);
    } finally {
      await browser.close();
    }
  },
);

test(
  "Phase 4: the date field accepts a directly typed date and the review lists the entered service details (service 45)",
  { timeout: 150000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await signIn(page, "");
      await startFlow(page, 45);
      await stepHeading(page).getByText("Citizen", { exact: true }).waitFor();
      await page.locator(".ax-citizen").first().waitFor();
      await page.locator(".ax-citizen input").first().check();
      await page.getByRole("button", { name: "Next: application form" }).click();
      await stepHeading(page).getByText("Application form", { exact: true }).waitFor();

      const { residence_since: _demoDate, ...rest } = demoPayloads[45] as Record<string, unknown>;
      await fillApplicationForm(page, rest);
      // Direct typed entry — no calendar widget or spinbutton segments.
      const date = page.locator('[data-field-path="residence_since"]');
      assert.equal(await date.getAttribute("type"), "text");
      assert.equal(await date.getAttribute("placeholder"), "YYYY-MM-DD");
      await date.click();
      await date.pressSequentially("2020-03-04");
      assert.equal(await date.inputValue(), "2020-03-04");

      await page.getByRole("button", { name: "Next: fees and delivery" }).click();
      await advanceToReview(page);

      // The review step shows the service-specific details that were
      // entered, not only the generic summary.
      await stepHeading(page).getByText("Review and submit", { exact: true }).waitFor();
      const details = (await page.locator(".ax-flow-details").textContent()) ?? "";
      assert.match(details, /Resident since/);
      // QAFIX-01 (§4 item 10): the review renders human dates, not ISO —
      // the entered 2020-03-04 reads "4 March 2020" here.
      assert.match(details, /4 March 2020/);
      // QAFIX-01: the purpose is a single field now; the review shows the
      // one purpose text the form carried (the demo payload's Bangla text),
      // where the old pair showed the English purpose here.
      assert.ok(details.includes(demoPayloads[45].purpose as string));

      const created = page.waitForResponse(
        (r) => r.url().endsWith("/api/v1/applications") && r.request().method() === "POST",
      );
      const submitted = page.waitForResponse(
        (r) => /\/transition$/.test(r.url()) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Submit application" }).click();
      assert.equal((await created).status(), 201);
      assert.equal((await submitted).status(), 200);
      await stepHeading(page).getByText("Done", { exact: true }).waitFor();
    } finally {
      await browser.close();
    }
  },
);
