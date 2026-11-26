import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
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

async function signInAsApprover(page: any) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill("approver@alpha.local.test");
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test(
  "CH-004: an invalid applications state filter degrades to the full list instead of crashing the section",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await signInAsApprover(page);
      // A marker that survives in-page navigation but not a reload: the
      // fix must recover WITHOUT a full reload.
      await page.evaluate(() => { (window as any).__ch004NoReload = 1; });

      // The reported crash URL: a state that is not in the state machine.
      await page.evaluate(() => { location.hash = "#/applications?state=AWAITING_ISSUANCE"; });
      await page.locator("#state-filter").waitFor();
      assert.equal(await page.locator("#state-filter").inputValue(), "", "unknown state normalizes to All states");
      assert.equal(await page.getByText("This section could not load").count(), 0, "no error boundary screen");
      // The bad value is repaired out of the URL so a refresh/bookmark
      // does not re-carry it.
      assert.ok(page.url().endsWith("#/applications"), `bad filter repaired out of the URL: ${page.url()}`);
      // The list itself renders (rows + a live total), not an empty state.
      await page.locator(".table-wrap tbody tr").first().waitFor({ timeout: 15000 });
      assert.ok((await page.locator(".table-wrap tbody tr").count()) > 0, "applications rows render");
      assert.equal(await page.evaluate(() => (window as any).__ch004NoReload), 1, "recovered without a reload");
      assert.deepEqual(errors, [], `no page errors: ${JSON.stringify(errors)}`);

      // Navigating away and back to the clean list also renders without a reload.
      await page.evaluate(() => { location.hash = "#/home"; });
      await page.evaluate(() => { location.hash = "#/applications"; });
      await page.locator("#state-filter").waitFor();
      await page.locator(".table-wrap tbody tr").first().waitFor({ timeout: 15000 });
      assert.equal(await page.evaluate(() => (window as any).__ch004NoReload), 1, "still no reload after navigating back");

      // Valid filters still work — including a lowercase value, which
      // normalizes to the canonical state.
      const submitted = page.waitForResponse(
        (r) => r.url().includes("/api/v1/applications") && r.url().includes("state=SUBMITTED"),
      );
      await page.evaluate(() => { location.hash = "#/applications?state=SUBMITTED"; });
      assert.equal((await submitted).status(), 200);
      await page.locator("#state-filter").waitFor();
      assert.equal(await page.locator("#state-filter").inputValue(), "SUBMITTED");
      await page.evaluate(() => { location.hash = "#/applications?state=issued"; });
      await page.locator("#state-filter").waitFor();
      assert.equal(await page.locator("#state-filter").inputValue(), "ISSUED");

      // An invalid service is dropped while the valid state survives.
      await page.evaluate(() => { location.hash = "#/applications?state=SUBMITTED&service=abc"; });
      await page.locator("#state-filter").waitFor();
      assert.equal(await page.locator("#state-filter").inputValue(), "SUBMITTED");
      assert.equal(await page.locator("#service-filter").inputValue(), "");

      // ISSUANCE_PENDING is not a listable state (the API 422s it), so
      // the filter no longer offers it at all.
      assert.equal(
        await page.locator("#state-filter option[value='ISSUANCE_PENDING']").count(),
        0,
        "ISSUANCE_PENDING is not offered as a filter",
      );
      assert.deepEqual(errors, [], `no page errors: ${JSON.stringify(errors)}`);
    } finally {
      await browser.close();
    }
  },
);

test(
  "CH-004: a failed applications-list fetch shows a retry instead of a dead screen",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const listPattern = /\/api\/v1\/applications\?/;
    try {
      await signInAsApprover(page);
      await page.evaluate(() => { location.hash = "#/applications"; });
      await page.locator(".table-wrap tbody tr").first().waitFor({ timeout: 15000 });

      // Break only the list endpoint, then re-filter so the list refetches.
      await page.route(listPattern, (route) => route.abort());
      await page.evaluate(() => { location.hash = "#/applications?state=DRAFT"; });
      await page.getByText("The applications list could not be loaded.").waitFor({ timeout: 15000 });
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await retry.waitFor();

      // Restore the endpoint and retry in place: the list recovers with
      // no reload and no navigation.
      await page.unroute(listPattern);
      const retried = page.waitForResponse(
        (r) => r.url().includes("/api/v1/applications") && r.url().includes("state=DRAFT"),
      );
      await retry.click();
      assert.equal((await retried).status(), 200);
      await page.waitForFunction(
        () => ![...document.body.innerText.split("\n")].some((line) => line.includes("could not be loaded")),
        undefined,
        { timeout: 15000 },
      );
      await page.locator(".table-wrap tbody tr").first().waitFor({ timeout: 15000 });
      assert.deepEqual(errors, [], `no page errors: ${JSON.stringify(errors)}`);
    } finally {
      await browser.close();
    }
  },
);
