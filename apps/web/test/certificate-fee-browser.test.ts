import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type APIRequestContext, type Browser } from "playwright";
import { demoPayloads } from "@astra/shared-schemas";
import { ensureSyntheticSignature } from "./fixtures/issuance-fixtures.js";

/**
 * CERT-FEE in the browser: on a per-certificate office the Chairman picks the
 * certificate language, sees the platform fee, confirms, and the approval
 * pays from the office wallet and issues only that language version.
 * The office's billing mode and the platform prices are restored afterwards,
 * so the rest of the suite still runs on submit billing.
 */
const origin = "http://127.0.0.1:5173";
const seedPassword = "Demo-Phase1!"; // the seed fixture's demo password

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
async function apiLogin(request: APIRequestContext, email: string) {
  const r = await request.post(`${origin}/api/v1/auth/login`, { data: { email, password: seedPassword } });
  assert.equal(r.status(), 200);
  const body = await r.json();
  return { csrf: body.csrfToken as string, user: body.user };
}

test("CERT-FEE: the Chairman chooses English only, sees the fee, pays from the wallet and issues the English version", { timeout: 240000 }, async () => {
  const browser = await launch();
  const errors: string[] = [];
  const ownerContext = await browser.newContext();
  const owner = await apiLogin(ownerContext.request, "owner@astra.demo.test");
  const ownerHeaders = { "X-CSRF-Token": owner.csrf };
  const previousFees = await (await ownerContext.request.get(`${origin}/api/v1/owner/certificate-fees`)).json();
  let tenantId = "";
  try {
    // ---- setup through the API.
    const office = await browser.newContext();
    const approver = await apiLogin(office.request, "approver@alpha.local.test");
    tenantId = approver.user.tenantId;
    await ensureSyntheticSignature(office.request, origin, approver.csrf);
    const put = async (url: string, data: object) => {
      const r = await ownerContext.request.put(`${origin}/api/v1${url}`, { data, headers: ownerHeaders });
      assert.equal(r.status(), 200, await r.text());
    };
    await put("/owner/certificate-fees", { feeBnMinor: 2000, feeEnMinor: 3000, reason: "Synthetic browser-test prices" });
    await put(`/owner/tenants/${tenantId}/billing-mode`, {
      billingMode: "PER_CERTIFICATE",
      reason: "Synthetic browser test of per-certificate billing",
    });
    const funded = await ownerContext.request.post(`${origin}/api/v1/owner/tenants/${tenantId}/points/adjust`, {
      data: { deltaMinor: 5000, reason: "Synthetic browser-test wallet funding", requestKey: randomUUID() },
      headers: ownerHeaders,
    });
    assert.equal(funded.status(), 201, await funded.text());
    const citizenContext = await browser.newContext();
    const citizen = await apiLogin(citizenContext.request, "citizen@alpha.local.test");
    const citizenId = (await (await citizenContext.request.get(`${origin}/api/v1/citizens`)).json()).items[0].id;
    const created = await citizenContext.request.post(`${origin}/api/v1/applications`, {
      data: { citizenId, serviceNo: 12, payload: { ...(demoPayloads as any)[12], delivery_language: "bilingual" } },
      headers: { "X-CSRF-Token": citizen.csrf },
    });
    assert.equal(created.status(), 201, await created.text());
    const application = await created.json();
    const submitted = await citizenContext.request.post(`${origin}/api/v1/applications/${application.id}/transition`, {
      data: { action: "submit" },
      headers: { "X-CSRF-Token": citizen.csrf },
    });
    assert.equal(submitted.status(), 200, await submitted.text());
    await citizenContext.close();

    // ---- the Chairman decides in the UI.
    const chairContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await chairContext.addInitScript(() => localStorage.setItem("astra.language", "en"));
    const chair = await chairContext.newPage();
    chair.on("pageerror", (e) => errors.push(e.message));
    await chair.goto(`${origin}/login`);
    await chair.getByLabel("Email or mobile number", { exact: true }).fill("approver@alpha.local.test");
    await chair.getByLabel("Password", { exact: true }).fill(seedPassword);
    await chair.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
    await chair.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await chair.goto(`${origin}/#/applications/${application.id}`);

    const panel = chair.locator(".certificate-fee");
    await panel.waitFor();
    // The citizen ordered both versions: that is the default, at ৳50.
    assert.equal(await panel.getByRole("radio", { name: /Both Bangla and English/ }).isChecked(), true);
    await panel.getByRole("radio", { name: /^English/ }).check();
    await panel.locator(".certificate-fee-total").getByText("৳30", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "Approve, pay ৳30 from the wallet and issue" }).click();
    const confirm = panel.locator('[data-testid="confirm-certificate-fee"]');
    await confirm.waitFor();
    assert.match(await panel.locator(".certificate-fee-confirm").innerText(), /৳30.*English/s);
    const decided = chair.waitForResponse(
      (r) => r.url().endsWith(`/applications/${application.id}/transition`) && r.request().method() === "POST",
    );
    await confirm.click();
    const response = await decided;
    assert.equal(response.status(), 200, await response.text());
    const certificate = (await response.json()).certificate;
    assert.equal(certificate.languages, "en");
    assert.ok(certificate.pdfUrlEn, "the English version was issued");
    await chair.getByRole("link", { name: "Download PDF (English)" }).waitFor();
    assert.equal(
      await chair.getByRole("link", { name: "Download PDF", exact: true }).count(),
      0,
      "no Bangla download for an English-only certificate",
    );

    const wallet = await (await office.request.get(`${origin}/api/v1/wallet/points`)).json();
    const debit = wallet.ledger.find((e: any) => e.certificateId === certificate.id);
    assert.equal(debit?.deltaMinor, -3000, "the wallet paid ৳30 for the English certificate");
    assert.deepEqual(errors, []);
  } finally {
    if (tenantId) {
      await ownerContext.request.put(`${origin}/api/v1/owner/tenants/${tenantId}/billing-mode`, {
        data: { billingMode: "SUBMIT_CREDIT", reason: "Restore submit billing after the browser test" },
        headers: ownerHeaders,
      });
    }
    if (previousFees?.configured)
      await ownerContext.request.put(`${origin}/api/v1/owner/certificate-fees`, {
        data: {
          feeBnMinor: previousFees.feeBnMinor,
          feeEnMinor: previousFees.feeEnMinor,
          reason: "Restore the platform prices after the browser test",
        },
        headers: ownerHeaders,
      });
    await browser.close();
  }
});
