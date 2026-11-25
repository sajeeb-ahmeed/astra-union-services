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

/**
 * F-012: /policies was one combined page with no effective date and no
 * retention/deletion/rights detail. It is now a hub; the full texts live
 * on /privacy and /terms, each dated, with retention/deletion stated as
 * the product actually works (official records kept; no self-service
 * deletion; requests go to the issuing office).
 */
test(
  "F-012: /privacy and /terms render dated pages; /policies links to both",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      for (const [path, heading, detail] of [
        ["/privacy", "Privacy policy", "Retention and deletion"],
        ["/terms", "Terms of use", "Fees and receipts"],
      ] as const) {
        await page.goto(`${origin}${path}`);
        assert.equal(await page.locator("h1").first().textContent(), heading);
        const text = (await page.locator("main").textContent()) ?? "";
        assert.match(text, /Last updated: 26 November 2026/);
        assert.ok(text.includes(detail), `${path} is missing its "${detail}" section`);
      }
      await page.goto(`${origin}/policies`);
      assert.equal(await page.locator("h1").first().textContent(), "Policies");
      assert.equal(await page.locator('a[href="/privacy"]').count(), 1);
      assert.equal(await page.locator('a[href="/terms"]').count(), 1);
    } finally {
      await browser.close();
    }
  },
);
