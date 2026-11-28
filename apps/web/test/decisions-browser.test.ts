import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type APIRequestContext, type Browser, type Page } from "playwright";
import { demoPayloads } from "@astra/shared-schemas";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { ensureSyntheticSignature } from "./fixtures/issuance-fixtures.js";

/**
 * Browser coverage for the Chairman's negative decisions, which until now
 * were exercised in the browser for no service (API level only, ALL47-02):
 *
 *   rejection  — the Chairman rejects in the UI (reason dialog + confirm);
 *                the citizen opens the application and sees it rejected
 *                with the Chairman's reason;
 *   revocation — the Chairman revokes an issued certificate through the
 *                in-app modal (upstream PR #74); the public verification
 *                page then says the certificate has been revoked.
 *
 * Applications are created and submitted through the API (the citizen's
 * form journey has its own tests); only the decisions go through the UI.
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
}
async function apiLogin(request: APIRequestContext, email: string) {
  const r = await request.post(`${origin}/api/v1/auth/login`, { data: { email, password: "Demo-Phase1!" } });
  assert.equal(r.status(), 200);
  return (await r.json()).csrfToken as string;
}
async function openApplication(page: Page, reference: string) {
  await goToWorkspacePage(page, "Applications");
  const row = page.locator("tr, article.ax-card").filter({ hasText: reference }).first();
  await row.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "← All applications", exact: true }).waitFor();
}

test("Decisions in the browser: the Chairman rejects (citizen sees the reason) and revokes via the modal (public verify says revoked)", { timeout: 240000 }, async () => {
  const browser = await launch();
  const errors: string[] = [];
  try {
    // ---- setup through the API: two submitted applications, one issued.
    const api = await browser.newContext();
    const citizenCsrf = await apiLogin(api.request, "citizen@alpha.local.test");
    const citizenId = (await (await api.request.get(`${origin}/api/v1/citizens`)).json()).items[0].id;
    const create = async (serviceNo: number) => {
      const created = await api.request.post(`${origin}/api/v1/applications`, {
        data: { citizenId, serviceNo, payload: (demoPayloads as any)[serviceNo] },
        headers: { "X-CSRF-Token": citizenCsrf },
      });
      assert.equal(created.status(), 201, await created.text());
      const body = await created.json();
      const submitted = await api.request.post(`${origin}/api/v1/applications/${body.id}/transition`, {
        data: { action: "submit" },
        headers: { "X-CSRF-Token": citizenCsrf },
      });
      assert.equal(submitted.status(), 200, await submitted.text());
      return body as { id: string; reference: string };
    };
    const toReject = await create(2);
    const toRevoke = await create(12);
    const office = await browser.newContext();
    const approverCsrf = await apiLogin(office.request, "approver@alpha.local.test");
    await ensureSyntheticSignature(office.request, origin, approverCsrf);
    const approved = await office.request.post(`${origin}/api/v1/applications/${toRevoke.id}/transition`, {
      data: { action: "approve" },
      headers: { "X-CSRF-Token": approverCsrf },
    });
    assert.equal(approved.status(), 200, await approved.text());
    const certificate = (await approved.json()).certificate;
    await api.close();
    await office.close();
    const refOf = (a: { reference: string }) => String(a.reference).replace(/\D/g, "");

    // ---- the Chairman decides in the UI.
    const chairContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await chairContext.addInitScript(() => localStorage.setItem("astra.language", "en"));
    const chair = await chairContext.newPage();
    chair.on("pageerror", (e) => errors.push(`chairman: ${e.message}`));
    await signIn(chair, "approver@alpha.local.test");

    // Rejection: reason field, then the reason dialog, then confirm.
    await openApplication(chair, refOf(toReject));
    const note = "Synthetic browser rejection note";
    await chair.getByLabel("Decision or revocation reason", { exact: true }).fill(note);
    const rejected = chair.waitForResponse((r) => r.url().endsWith("/transition") && r.request().method() === "POST");
    await chair.getByRole("button", { name: "Reject application", exact: true }).click();
    const confirmReject = chair.locator('[data-testid="confirm-transition"]');
    await confirmReject.waitFor();
    const preset = chair.locator('[data-testid="dialog-reason"]');
    let presetText = "";
    if (await preset.count()) {
      await preset.selectOption({ index: 1 });
      presetText = (await preset.locator("option:checked").innerText()).trim();
    }
    await confirmReject.click();
    const rejectResponse = await rejected;
    assert.equal(rejectResponse.status(), 200, await rejectResponse.text());
    assert.equal((await rejectResponse.json()).state, "REJECTED");

    // Revocation of the issued certificate through the in-app modal.
    await openApplication(chair, refOf(toRevoke));
    await chair.getByLabel("Decision or revocation reason", { exact: true }).fill("Synthetic browser revocation");
    await chair.getByRole("button", { name: "Revoke certificate", exact: true }).click();
    const dialog = chair.getByRole("dialog");
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes(certificate.number), "the modal names the certificate it will revoke");
    const revoked = chair.waitForResponse((r) => /\/certificates\/[^/]+\/revoke$/.test(r.url()) && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "Confirm revocation", exact: true }).click();
    const revokeResponse = await revoked;
    assert.equal(revokeResponse.status(), 200, await revokeResponse.text());
    assert.equal((await revokeResponse.json()).status, "REVOKED");

    // ---- the citizen sees the rejection and its reason.
    const citizenContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await citizenContext.addInitScript(() => localStorage.setItem("astra.language", "en"));
    const citizen = await citizenContext.newPage();
    citizen.on("pageerror", (e) => errors.push(`citizen: ${e.message}`));
    await signIn(citizen, "citizen@alpha.local.test");
    await openApplication(citizen, refOf(toReject));
    const detail = await citizen.locator("main").innerText();
    assert.match(detail, /Rejected/i, "the citizen sees the application rejected");
    assert.ok(
      detail.includes(note) || (presetText && detail.includes(presetText)),
      "the citizen sees the Chairman's reason",
    );

    // ---- the public verification page reports the revocation.
    const visitorContext = await browser.newContext();
    await visitorContext.addInitScript(() => localStorage.setItem("astra.language", "en"));
    const visitor = await visitorContext.newPage();
    visitor.on("pageerror", (e) => errors.push(`visitor: ${e.message}`));
    await visitor.goto(origin);
    // PORTAL-LANDING: the verify box sits behind the quick-services tab.
    await visitor.locator("#home-tab-verify").click();
    await visitor.locator("#home-verify-input").fill(certificate.number);
    await Promise.all([visitor.waitForURL(/\/verify\?searchText=/), visitor.locator("#home-verify-input").press("Enter")]);
    await visitor.getByText("This certificate has been revoked", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
