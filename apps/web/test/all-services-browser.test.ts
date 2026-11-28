import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { demoPayloads, serviceCatalog } from "@astra/shared-schemas";
import { fillApplicationForm } from "./fixtures/fill-form.js";
import { ensureSyntheticSignature, publishZeroFeePolicy } from "./fixtures/issuance-fixtures.js";

/**
 * ALL47-BROWSER: every one of the 47 services through the real UI, the way
 * the three roles use it (synthetic data, DEMO issuance only):
 *
 *   citizen  — signs in, picks the service from the catalog, fills the real
 *              form (shared demo payloads typed into the actual controls,
 *              required document rows uploaded and scanned by the fixture
 *              scanner), goes through the fee step and submits;
 *   Chairman — finds it in the pending queue, opens it, "Approve and issue
 *              certificate", confirms in the modal, sees the certificate;
 *   public   — verifies the printed number from the home page and sees the
 *              demo (not official) notice.
 *
 * Each service records step-level results and the run continues past a
 * failing service (screenshot in execution/screenshots/all47/), so one run
 * shows the whole picture; the test fails at the end unless all 47 pass.
 *
 * State: the zero-fee policies it publishes are referenced by the applications
 * it creates, so they survive the T-003 reset; scripts/test-web.ts therefore
 * runs this file last.
 *
 * Long (about 47 x 15 s), so it runs only when E2E_ALL47=1:
 *   E2E_ALL47=1 npm run test:web
 * Evidence: execution/all-services-browser-qa.json
 */
const origin = "http://127.0.0.1:5173";
const shots = "execution/screenshots/all47";

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
}

async function englishContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("astra.language", "en"));
  return context;
}

/** Same fee-step handling as the citizen journey test. */
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
  if (await review.count()) {
    await review.click();
    // The breakdown (and its acknowledgement) renders after the quote returns.
    const accept = page.getByLabel("I have reviewed the certificate options and fee breakdown.", { exact: true });
    await accept.waitFor();
    await accept.check();
  }
  await toReview.click();
  await submit.waitFor();
}

function payloadFor(no: number): Record<string, unknown> {
  const payload = { ...(demoPayloads as Record<number, Record<string, unknown>>)[no] };
  // Same W-002 LANGUAGE-gate pairing as the API ALL47 tests.
  if (no === 10) payload.last_occupation_en = "Sample information";
  return payload;
}

test(
  "ALL47-BROWSER: every service — citizen applies in the UI, the Chairman approves in the UI, the public verifies the number",
  { skip: process.env.E2E_ALL47 !== "1" && "set E2E_ALL47=1 to run (about 15 minutes)", timeout: 60 * 60 * 1000 },
  async () => {
    const only = (process.env.E2E_ALL47_ONLY ?? "")
      .split(",")
      .map(Number)
      .filter(Boolean);
    fs.mkdirSync(shots, { recursive: true });
    const browser = await launch();
    const results: any[] = [];
    try {
      // W-002: issuance needs a chairman signature for the office.
      const setup = await browser.newContext();
      const approverLogin = await setup.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "approver@alpha.local.test", password: "Demo-Phase1!" },
      });
      assert.equal(approverLogin.status(), 200);
      await ensureSyntheticSignature(setup.request, origin, (await approverLogin.json()).csrfToken);
      // W-002 AMOUNTS gate: the money receipts (1 holding tax, 41, 42 trade
      // licence) cannot be issued without order amounts, which the citizen's
      // fee step only produces when the office has a fee policy. The seed has
      // none, so the office admin publishes the synthetic zero-fee policy
      // (skipped when one already exists; test:web resets test policies).
      const adminLogin = await setup.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "admin@alpha.local.test", password: "Demo-Phase1!" },
      });
      assert.equal(adminLogin.status(), 200);
      const adminCsrf = (await adminLogin.json()).csrfToken;
      for (const moneyService of [1, 41, 42])
        await publishZeroFeePolicy(setup.request, origin, adminCsrf, moneyService).catch((e) => {
          if (!/409|VERSION|exists/i.test(String(e))) throw e;
        });
      await setup.close();

      const citizenContext = await englishContext(browser);
      const citizen = await citizenContext.newPage();
      await signIn(citizen, "citizen@alpha.local.test");
      const chairContext = await englishContext(browser);
      const chair = await chairContext.newPage();
      await signIn(chair, "approver@alpha.local.test");
      const visitorContext = await englishContext(browser);
      const visitor = await visitorContext.newPage();

      for (const service of serviceCatalog) {
        const no = service.service_no;
        if (only.length && !only.includes(no)) continue;
        const row: Record<string, unknown> = { serviceNo: no };
        const errors: string[] = [];
        const onError = (e: Error) => errors.push(e.message);
        citizen.on("pageerror", onError);
        chair.on("pageerror", onError);
        let step = "citizen: open catalog";
        try {
          // Upstream's citizen dashboard (PR #75) replaced the starter tasks:
          // the catalog is the sidebar's "Service catalog" entry.
          await citizen.goto(origin);
          await citizen.getByRole("link", { name: "Service catalog", exact: true }).or(
            citizen.getByRole("button", { name: "Service catalog", exact: true }),
          ).first().click();
          await citizen.locator("#service-search").waitFor();
          step = "citizen: choose service";
          await citizen.locator(`.catalog .svc-card[data-service="${no}"]`).click();
          const form = citizen.getByTestId("service-application-form");
          await form.waitFor();
          row.formRenders = "PASS";
          step = "citizen: fill form";
          await fillApplicationForm(citizen, payloadFor(no));
          await citizen.getByRole("button", { name: "Next: fees and delivery", exact: true }).click();
          step = "citizen: fees";
          await throughFees(citizen);
          step = "citizen: submit";
          const submitted = citizen.waitForResponse(
            (r) => r.url().includes("/transition") && r.request().method() === "POST",
          );
          await citizen.getByRole("button", { name: "Submit application", exact: true }).click();
          const submitResponse = await submitted;
          assert.equal(submitResponse.status(), 200, await submitResponse.text());
          await citizen
            .getByText("The application is submitted and waiting for office review.", { exact: true })
            .waitFor();
          const reference = (await citizen.locator(".ax-refchip").first().innerText()).replace(/\D/g, "");
          assert.match(reference, /^\d{16}$/);
          row.reference = reference;
          row.citizenSubmit = "PASS";

          step = "chairman: queue";
          await chair.goto(`${origin}/#/pending`);
          // A hash-only navigation keeps the already-loaded page: reload so the
          // queue is read after this submission (see stale-queue note in the report).
          await chair.reload();
          // Desktop renders the queue as a table, phones as cards: match either.
          const card = chair.locator("article.ax-card, tr").filter({ hasText: reference }).first();
          await card.waitFor();
          row.chairmanQueue = "PASS";
          step = "chairman: approve";
          await card.getByRole("button", { name: "Open", exact: true }).click();
          await chair.getByRole("button", { name: "Approve and issue certificate", exact: true }).click();
          const dialog = chair.getByRole("dialog");
          await dialog.waitFor();
          const issued = chair.waitForResponse(
            (r) => r.url().endsWith("/transition") && r.request().method() === "POST",
          );
          await dialog.getByRole("button", { name: "Confirm approval", exact: true }).click();
          const approveResponse = await issued;
          assert.equal(approveResponse.status(), 200, await approveResponse.text());
          const certificate = (await approveResponse.json()).certificate;
          assert.ok(certificate?.number, "certificate number");
          await chair.getByText("Approved — the certificate has been issued.", { exact: false }).first().waitFor();
          await chair.getByRole("link", { name: "Download PDF", exact: true }).waitFor();
          const pdf = await chairContext.request.get(`${origin}${certificate.pdfUrl}`);
          assert.equal(pdf.status(), 200);
          assert.equal((await pdf.body()).subarray(0, 4).toString(), "%PDF");
          row.certificate = certificate.number;
          row.chairmanApproveAndPdf = "PASS";

          step = "public: verify number";
          await visitor.goto(origin);
          // PORTAL-LANDING: the verify box sits behind the quick-services tab.
          await visitor.locator("#home-tab-verify").click();
          await visitor.locator("#home-verify-input").fill(certificate.number);
          await Promise.all([
            visitor.waitForURL(/\/verify\?searchText=/),
            visitor.locator("#home-verify-input").press("Enter"),
          ]);
          await visitor.getByText("This is not an official certificate", { exact: true }).waitFor();
          row.publicVerification = "PASS";
          assert.deepEqual(errors, [], "no page errors");
          row.status = "PASS";
        } catch (error) {
          row.status = "FAIL";
          row.failedStep = step;
          row.error = String((error as Error).message ?? error).split("\n")[0].slice(0, 400);
          if (errors.length) row.pageErrors = errors.slice(0, 3);
          await citizen.screenshot({ path: `${shots}/service-${no}-citizen.png`, fullPage: true }).catch(() => {});
          await chair.screenshot({ path: `${shots}/service-${no}-chairman.png`, fullPage: true }).catch(() => {});
        } finally {
          citizen.off("pageerror", onError);
          chair.off("pageerror", onError);
        }
        results.push(row);
        console.log(`ALL47-BROWSER service ${no}: ${row.status}${row.failedStep ? ` at ${row.failedStep} — ${row.error}` : ""}`);
      }
    } finally {
      fs.writeFileSync(
        "execution/all-services-browser-qa.json",
        JSON.stringify(
          {
            mode: "SYNTHETIC_DEMO",
            level: "browser (citizen UI -> Chairman UI -> public verify UI)",
            servicesPassed: results.filter((r) => r.status === "PASS").length,
            services: results,
          },
          null,
          2,
        ),
      );
      await browser.close();
    }
    const failed = results.filter((r) => r.status !== "PASS").map((r) => `${r.serviceNo} (${r.failedStep})`);
    assert.deepEqual(failed, [], `services failing in the browser: ${failed.join(", ")}`);
    if (!only.length) assert.equal(results.length, 47);
  },
);
