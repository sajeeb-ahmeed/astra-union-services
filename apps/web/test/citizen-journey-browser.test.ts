import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { demoPayloads } from "@astra/shared-schemas";
import { fillApplicationForm } from "./fixtures/fill-form.js";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { readOtpCode } from "./fixtures/otp-outbox.js";

/**
 * PORTAL-B: the whole citizen journey on a phone, end to end, as one person
 * would do it — no seeded citizen, no shortcuts on the citizen's side:
 *
 *   register (3 fields) → lands signed in → "Apply for a certificate" →
 *   the deferred details once → the form opens with them already filled →
 *   submit → (the Chairman approves) → "My applications" shows it issued →
 *   the PDF downloads → anyone verifies it from the public home page.
 *
 * Only the Chairman's approval goes through the API: the office side has
 * its own browser tests; this one is about what the citizen goes through.
 */
const origin = "http://127.0.0.1:5173";

async function launch(): Promise<Browser> {
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const executable =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((n) => /^chromium-/.test(n))
      .sort()
      .reverse()
      .map((n) => path.join(local, n, "chrome-win64", "chrome.exe"))
      .find((p) => fs.existsSync(p));
  return chromium.launch({ headless: true, executablePath: executable });
}

/**
 * Fee step only when the office has a fee policy; otherwise the flow skips
 * it by itself (the step can show for a moment first, so act only on the
 * fee form's own language control, never on a passing "Next" button).
 */
async function throughFees(page: Page) {
  const submit = page.getByRole("button", { name: "Submit application", exact: true });
  const toReview = page.getByRole("button", { name: "Next: review and submit", exact: true });
  const language = page.locator("#order-language");
  for (let i = 0; i < 80; i++) {
    if (await submit.isVisible().catch(() => false)) return;
    if (await language.isVisible().catch(() => false)) break;
    await page.waitForTimeout(250);
  }
  if (await submit.isVisible().catch(() => false)) return;
  if ((await language.count()) && !(await language.inputValue())) await language.selectOption("bn");
  const review = page.getByRole("button", { name: "Review fees" });
  if (await review.count()) await review.click();
  const accept = page.locator(".ax-flow input[type=checkbox]").last();
  if (await accept.count()) await accept.check();
  await toReview.click();
  await submit.waitFor();
}

test(
  "PORTAL-B citizen journey on a phone: register → signed in → apply with prefilled details → issued → download → public verify",
  { timeout: 180000 },
  async () => {
    const browser = await launch();
    const errors: string[] = [];
    const mobile = `016${String(Date.now()).slice(-8)}`;
    const password = `Journey-${Math.random().toString(36).slice(2, 10)}`;
    const address = { bn: "যাত্রা গ্রাম, আলফা ইউনিয়ন", en: "Journey Village, Alpha Union" };
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => localStorage.setItem("astra.language", "en"));
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));

      // 1. Register: three typed fields, then the S-001 mobile verification
      // (code sent to the handset), then straight into the workspace.
      await page.goto(`${origin}/register?office=alpha`);
      await page.locator("#signup-name").fill("Journey Citizen");
      await page.locator("#signup-mobile").fill(mobile);
      await page.locator("#signup-password").fill(password);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.locator("#signup-verify-title").waitFor();
      const sentAt = Date.now();
      await page.getByRole("button", { name: "Send code", exact: true }).click();
      await page
        .locator("#signup-verify-code")
        .fill(await readOtpCode(mobile.slice(-8), sentAt));
      await page
        .getByRole("button", { name: "Verify and sign in", exact: true })
        .click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/");

      // 2. The citizen's own tasks — no staff wording.
      const tasks = page.locator(".workspace-tasks button");
      assert.equal(await tasks.count(), 3);
      assert.equal(await page.getByText("Choose a citizen and service", { exact: false }).count(), 0);
      await page.getByRole("button", { name: /Apply for a certificate/ }).click();
      await page.locator("#service-search").waitFor();
      await page.locator(`.catalog .svc-card[data-service="45"]`).click();

      // 3. The details signup deferred, asked once…
      await page.locator(".du-profile-completion").waitFor();
      await page.locator("#pc-nameBn").fill("যাত্রা নাগরিক");
      await page.locator("#pc-dateOfBirth").fill("1991-02-03");
      await page.locator("#pc-addressBn").fill(address.bn);
      await page.locator("#pc-addressEn").fill(address.en);
      const ward = page.locator("#pc-geo-ward");
      if (await ward.count()) {
        const first = await ward.locator("option").nth(1).getAttribute("value");
        if (first) await ward.selectOption(first);
      }
      await page.getByRole("button", { name: "Save and continue to the form", exact: true }).click();
      await page.locator(".du-profile-completion").waitFor({ state: "detached" });

      // …and the form opens with them already filled, still editable.
      const form = page.getByTestId("service-application-form");
      const addressBn = form.locator('[data-field-path="permanent_address_bn"]');
      await addressBn.waitFor();
      assert.equal(await addressBn.inputValue(), address.bn, "the Bangla address is not typed twice");
      assert.equal(
        await form.locator('[data-field-path="permanent_address_en"]').inputValue(),
        address.en,
        "the English address is not typed twice",
      );
      const { permanent_address_bn: _bn, permanent_address_en: _en, ...rest } = demoPayloads[45] as Record<string, unknown>;
      await fillApplicationForm(page, rest);
      await page.locator('[data-field-path="purpose"]').fill("Journey test purpose");
      await page.getByRole("button", { name: "Next: fees and delivery", exact: true }).click();
      await throughFees(page);
      // On a phone the sticky action bar sits above the bottom tab bar: the
      // Submit button is on top at its centre, not hidden under the tabs.
      const covered = await page.evaluate(() => {
        const button = [...document.querySelectorAll(".ax-flow-actions button")].find(
          (b) => b.textContent?.trim() === "Submit application",
        );
        if (!button) return "missing";
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit === button || button.contains(hit) ? "" : String(hit?.closest("nav")?.className ?? hit?.tagName);
      });
      assert.equal(covered, "", "Submit application must not be covered");

      // 4. Submit: the done screen gives the public reference.
      const submitted = page.waitForResponse(
        (r) => r.url().includes("/transition") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Submit application", exact: true }).click();
      assert.equal((await submitted).status(), 200);
      await page.getByText("The application is submitted and waiting for office review.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Another application for this service", exact: true }).waitFor();
      const reference = (await page.locator(".ax-refchip").first().innerText()).replace(/\D/g, "");
      assert.match(reference, /^\d{16}$/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

      // 5. The Chairman approves (office side through the API).
      const office = await browser.newContext();
      const signedIn = await office.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "approver@alpha.local.test", password: "Demo-Phase1!" },
      });
      assert.equal(signedIn.status(), 200);
      const csrf = (await signedIn.json()).csrfToken;
      const listed = await (await office.request.get(`${origin}/api/v1/applications?q=${reference}`)).json();
      const application = listed.items.find((item: any) => String(item.reference ?? "").replace(/\D/g, "") === reference);
      assert.ok(application, `the approver finds ${reference}`);
      const approved = await office.request.post(`${origin}/api/v1/applications/${application.id}/transition`, {
        data: { action: "approve" },
        headers: { "X-CSRF-Token": csrf },
      });
      assert.equal(approved.status(), 200, await approved.text());
      const certificate = (await approved.json()).certificate;
      assert.ok(certificate?.number && certificate?.pdfUrl);
      await office.close();

      // 6. "My applications" shows it issued, and the PDF downloads.
      // On a phone the list is one card per application (no wide table).
      await goToWorkspacePage(page, "Applications");
      const card = page.locator("article.ax-card").filter({ hasText: reference });
      await card.waitFor();
      // The decision shows without a reload: opening the list re-reads it.
      await card.getByText("Certificate issued", { exact: true }).waitFor();
      await card.getByRole("button", { name: "Open", exact: true }).click();
      await page.getByRole("link", { name: "Download PDF", exact: true }).waitFor();
      const pdf = await context.request.get(`${origin}${certificate.pdfUrl}`);
      assert.equal(pdf.status(), 200);
      assert.equal((await pdf.body()).subarray(0, 4).toString(), "%PDF");

      // 7. Anyone verifies it from the public home page.
      const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await publicContext.addInitScript(() => localStorage.setItem("astra.language", "en"));
      const visitor = await publicContext.newPage();
      visitor.on("pageerror", (e) => errors.push(e.message));
      await visitor.goto(origin);
      await visitor.locator("#home-verify-input").fill(certificate.number);
      await Promise.all([visitor.waitForURL(/\/verify\?searchText=/), visitor.locator("#home-verify-input").press("Enter")]);
      await visitor.getByText("This is not an official certificate", { exact: true }).waitFor();
      await publicContext.close();
      await context.close();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
