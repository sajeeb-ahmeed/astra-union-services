import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
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
  await page.goto(`${origin}/${query}`);
  await page.getByLabel("Email", { exact: true }).fill("staff@alpha.demo.test");
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
const stepHeading = (page: Page) => page.locator("#ax-flow-step-heading");
/** Fees step: without an office fee policy "Next" enables once settings load; with one, quote and accept. */
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
  "Phase 1 service flow preview: citizen → form → fees → review → submitted, with validation and back navigation",
  { timeout: 150000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await signIn(page, "?preview=flow");
      await page.locator('.ax-dashboard .ax-tile[data-service="45"]').click();

      // Step 1: citizen.
      await stepHeading(page).getByText("Citizen", { exact: true }).waitFor();
      assert.equal(await page.locator('.ax-stepper [aria-current="step"]').count(), 1);
      const next1 = page.getByRole("button", { name: "Next: application form" });
      assert.equal(await next1.isDisabled(), true, "a citizen must be chosen first");
      await page.locator(".ax-citizen").first().waitFor();
      await page.locator(".ax-citizen input").first().check();
      await next1.click();

      // Step 2: form validation blocks an empty form, then the synthetic example passes.
      await stepHeading(page).getByText("Application form", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Next: fees and delivery" }).click();
      await page.locator(".ax-flow .error-summary").waitFor();
      await page.getByRole("button", { name: "Fill synthetic example" }).click();
      await page.getByRole("button", { name: "Next: fees and delivery" }).click();

      // Step 3: fees. Offices with a fee policy need a language, a quote and acceptance.
      await stepHeading(page).getByText("Fees and delivery", { exact: true }).waitFor();
      await completeFees(page);
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({ path: "execution/screenshots/phase1-service-flow-fees.png", fullPage: true });

      // Back navigation keeps the entered form data.
      await page.getByRole("button", { name: "← Application form" }).click();
      await stepHeading(page).getByText("Application form", { exact: true }).waitFor();
      assert.equal(await page.locator(".ax-flow .error-summary").count(), 0);
      await page.getByRole("button", { name: "Next: fees and delivery" }).click();
      await stepHeading(page).getByText("Fees and delivery", { exact: true }).waitFor();
      await (await completeFees(page)).click();

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

      // Step 5: done, with the reference; the server agrees it is submitted.
      await stepHeading(page).getByText("Done", { exact: true }).waitFor();
      const reference = (await page.locator(".ax-flow-reference").textContent())!.trim();
      assert.match(reference, /^[0-9a-f-]{36}$/);
      const stored = await page.evaluate(
        async (id) => (await (await fetch(`/api/v1/applications/${id}`)).json()).application.state,
        reference,
      );
      assert.equal(stored, "SUBMITTED");
      await page.screenshot({ path: "execution/screenshots/phase1-service-flow-done.png", fullPage: true });
      await page.getByRole("button", { name: "Open application" }).click();
      await page.getByText(reference.slice(0, 8)).first().waitFor();

      // Without ?preview=flow the dashboard tile still opens the legacy intake page.
      const plain = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await signIn(plain, "");
      await plain.locator('.ax-dashboard .ax-tile[data-service="45"]').click();
      await plain.locator(".catalog .service.selected").waitFor();
      assert.equal(await plain.locator(".ax-flow").count(), 0);

      // Mobile: the stepper collapses and the page does not scroll sideways.
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await signIn(mobile, "?preview=flow");
      await mobile.locator('.ax-dashboard .ax-tile[data-service="45"]').click();
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
