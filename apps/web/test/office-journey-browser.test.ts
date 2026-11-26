import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { demoPayloads } from "@astra/shared-schemas";
import { fillApplicationForm } from "./fixtures/fill-form.js";
import { ensureSyntheticSignature } from "./fixtures/issuance-fixtures.js";

/**
 * PORTAL-C: the office journey as the office does it.
 *
 *   staff (desktop): a walk-in citizen is found by MOBILE → the staff form
 *   starts blank → filled and submitted;
 *   Chairman (phone): lands on Pending → opens the card → reads the
 *   application BEFORE the decision panel → approves (one confirmation) →
 *   the certificate is issued, "Retry issuance" is only a secondary
 *   recovery, and the PDF downloads.
 *
 * Neither sees "/login" in the address bar once signed in.
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

async function signIn(page: Page, email: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/", "signed in, the address no longer says /login");
}

test(
  "PORTAL-C office journey: staff finds a walk-in by mobile and submits; the Chairman reads, then approves on a phone",
  { timeout: 180000 },
  async () => {
    const browser = await launch();
    const errors: string[] = [];
    const mobile = `013${String(Date.now()).slice(-8)}`;
    const walkIn = `Walk-in Citizen ${Date.now()}`;
    try {
      // A walk-in citizen the office registered earlier (by API: the
      // registration screen has its own tests).
      const setup = await browser.newContext();
      const staffLogin = await setup.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "staff@alpha.local.test", password: "Demo-Phase1!" },
      });
      assert.equal(staffLogin.status(), 200);
      const created = await setup.request.post(`${origin}/api/v1/citizens`, {
        data: {
          nameBn: "ওয়াক-ইন নাগরিক",
          nameEn: walkIn,
          dateOfBirth: "1988-08-08",
          addressBn: "ওয়াক-ইন গ্রাম",
          addressEn: "Walk-in Village",
          details: { mobile },
        },
        headers: { "X-CSRF-Token": (await staffLogin.json()).csrfToken },
      });
      assert.equal(created.status(), 201, await created.text());
      // W-002: issuance needs a chairman signature for the office — the
      // seed gives alpha only a SEAL, so upload the explicitly identified
      // synthetic signature (as the approver) before the Chairman approves.
      // The setup context is closed right after, so swapping its session
      // from staff to approver here is harmless.
      const approverLogin = await setup.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "approver@alpha.local.test", password: "Demo-Phase1!" },
      });
      assert.equal(approverLogin.status(), 200);
      await ensureSyntheticSignature(setup.request, origin, (await approverLogin.json()).csrfToken);
      await setup.close();

      // 1. Staff at a desktop.
      const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await staffContext.addInitScript(() => localStorage.setItem("astra.language", "en"));
      const staff = await staffContext.newPage();
      staff.on("pageerror", (e) => errors.push(`staff: ${e.message}`));
      await signIn(staff, "staff@alpha.local.test");
      await staff.getByRole("button", { name: /Start an application/ }).click();
      await staff.locator("#service-search").waitFor();
      await staff.locator(`.catalog .svc-card[data-service="45"]`).click();
      // The walk-in is found by the number they know: their mobile.
      const search = staff.getByLabel("Find a citizen (name, mobile or reference)", { exact: true });
      await search.fill(mobile);
      const choice = staff.locator(".ax-citizen").filter({ hasText: walkIn });
      await choice.waitFor();
      assert.equal(await staff.locator(".ax-citizen").count(), 1, "the mobile finds exactly that citizen");
      await choice.locator("input[type=radio]").check();
      await staff.getByRole("button", { name: "Next: application form", exact: true }).click();
      // Staff intake starts blank (Release 0.4) — nothing carried over.
      const form = staff.getByTestId("service-application-form");
      const addressBn = form.locator('[data-field-path="permanent_address_bn"]');
      await addressBn.waitFor();
      assert.equal(await addressBn.inputValue(), "");
      await fillApplicationForm(staff, demoPayloads[45]);
      await staff.locator('[data-field-path="purpose"]').fill("Office journey purpose");
      await staff.getByRole("button", { name: "Next: fees and delivery", exact: true }).click();
      const submit = staff.getByRole("button", { name: "Submit application", exact: true });
      const language = staff.locator("#order-language");
      for (let i = 0; i < 80 && !(await submit.isVisible().catch(() => false)); i++) {
        if (await language.isVisible().catch(() => false)) {
          if (!(await language.inputValue())) await language.selectOption("bn");
          const accept = staff.locator(".ax-flow input[type=checkbox]").last();
          if (await accept.count()) await accept.check();
          await staff.getByRole("button", { name: "Next: review and submit", exact: true }).click();
        }
        await staff.waitForTimeout(250);
      }
      await submit.click();
      await staff.getByText("The application is submitted and waiting for office review.", { exact: true }).waitFor();
      const reference = (await staff.locator(".ax-refchip").first().innerText()).replace(/\D/g, "");
      assert.match(reference, /^\d{16}$/);
      await staffContext.close();

      // 2. The Chairman on a phone.
      const chairContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await chairContext.addInitScript(() => localStorage.setItem("astra.language", "en"));
      const chair = await chairContext.newPage();
      chair.on("pageerror", (e) => errors.push(`chairman: ${e.message}`));
      // QAFIX-09 (B1): the irreversible-decision confirmation is
      // an in-app modal now, not a native dialog — the flow below
      // records the modal instead of a dialog event.
      const confirmations: string[] = [];
      await signIn(chair, "approver@alpha.local.test");
      assert.match(new URL(chair.url()).hash, /^#\/pending/, "the Chairman starts on his queue");
      const card = chair.locator("article.ax-card").filter({ hasText: reference });
      await card.waitFor();
      // The 16 digits stay on one line in the card.
      const chip = card.locator(".ax-refchip code");
      const lineHeight = await chip.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 24);
      assert.ok((await chip.boundingBox())!.height < lineHeight * 1.5, "the reference does not wrap");
      await card.getByRole("button", { name: "Open", exact: true }).click();

      // Read first, decide after: the details come before the decision panel.
      const details = chair.getByText("Residence details", { exact: true });
      const reason = chair.locator("#reason");
      await reason.waitFor();
      const detailsTop = (await details.boundingBox())!.y;
      const reasonTop = (await reason.boundingBox())!.y;
      assert.ok(detailsTop < reasonTop, `details (${detailsTop}) come before the decision (${reasonTop})`);

      await chair.getByRole("button", { name: "Approve and issue certificate", exact: true }).click();
      const confirmDialog = chair.getByRole("dialog");
      await confirmDialog.waitFor();
      confirmations.push(await confirmDialog.innerText());
      assert.ok(
        confirmations[0].includes(reference),
        "the confirmation modal names the application it will approve",
      );
      const issued = chair.waitForResponse((r) => r.url().endsWith("/transition") && r.request().method() === "POST");
      await confirmDialog.getByRole("button", { name: "Confirm approval", exact: true }).click();
      const response = await issued;
      assert.equal(response.status(), 200, await response.text());
      assert.equal(confirmations.length, 1, "one confirmation before an irreversible approval");
      const certificate = (await response.json()).certificate;
      await chair.getByText("Approved — the certificate has been issued.", { exact: false }).first().waitFor();
      await chair.getByRole("link", { name: "Download PDF", exact: true }).waitFor();
      const retry = chair.getByRole("button", { name: "Retry issuance safely", exact: true });
      assert.equal(await retry.getAttribute("class"), "secondary", "re-issuing is a recovery, not the next step");
      const pdf = await chairContext.request.get(`${origin}${certificate.pdfUrl}`);
      assert.equal(pdf.status(), 200);
      assert.equal((await pdf.body()).subarray(0, 4).toString(), "%PDF");
      assert.equal(await chair.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await chairContext.close();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
