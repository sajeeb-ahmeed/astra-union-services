import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
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

test(
  "chairman dashboard browser: the Chairman filters applications by service and works the Pending queue",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await page.goto(`${origin}/login`);
      await page.getByLabel("Email", { exact: true }).fill("approver@alpha.local.test");
      await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
      await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();

      // Service filter: choosing a service re-queries with serviceNo and every
      // rendered row belongs to that service. (The API suites run before this
      // one and leave service-45 applications in the alpha office.)
      await goToWorkspacePage(page, "Applications");
      const filtered = page.waitForResponse((r) => r.url().includes("serviceNo=45"));
      // FULL-UIUX-01 toolbar: the service filter is labelled "Service"
      // (id service-filter); the request still carries serviceNo.
      await page.locator("#service-filter").selectOption("45");
      assert.equal((await filtered).status(), 200);
      // Columns are Reference / Citizen / Service / Status / action, and the
      // service cell carries the catalog name (the "#45" prefix is internal
      // numbering, not the assertion target).
      const serviceCells = await page.locator("tbody tr td:nth-child(3)").allTextContents();
      assert.ok(serviceCells.length > 0, "service 45 has rows to show");
      assert.ok(
        // BUNDLE06-R5 E2: the product's catalog name is Title Case
        // ("Permanent Resident Certificate", service 45 in the API
        // catalog); the test's old sentence-case string was stale.
        // Product casing is unchanged — only this assertion aligns.
        serviceCells.every((text) => text.includes("Permanent Resident Certificate")),
        `every row is service 45: ${JSON.stringify(serviceCells)}`,
      );

      // Pending queue: both groups render with their API counts, and a row
      // opens the same application detail as the applications list.
      const countsResponse = page.waitForResponse((r) => r.url().includes("/applications/counts"));
      await goToWorkspacePage(page, "pending");
      assert.equal((await countsResponse).status(), 200);
      const reviewHeading = page.getByRole("heading", { name: /Awaiting review/ });
      await reviewHeading.waitFor();
      await page.getByRole("heading", { name: /Awaiting issuance/ }).waitFor();
      const reviewText = (await reviewHeading.textContent()) || "";
      const reviewCount = Number(reviewText.match(/·\s*([\d,]+)/)?.[1].replace(",", ""));
      assert.ok(reviewCount >= 1, `awaiting review count is live: ${reviewText}`);
      await page.getByRole("button", { name: "Open", exact: true }).first().click();
      await page.getByRole("button", { name: /All applications/ }).waitFor();
    } finally {
      await browser.close();
    }
  },
);
