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
 * F-015 (CLS): the service page's office list used to arrive as a
 * one-line "Loading…" status that then expanded to the full list — a
 * single ~0.7 layout shift whenever the data landed after first paint.
 * The loading state is now skeleton rows, reserving roughly the loaded
 * height. Delay the office-info response and assert the skeleton is
 * what renders while it loads.
 */
test(
  "F-015: service page shows skeleton rows while office information loads",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
      await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      const infoUrl = (url: URL) => url.pathname === "/api/v1/services/1/office-info";
      await page.route(infoUrl, async (route) => {
        await new Promise((r) => setTimeout(r, 2000));
        await route.continue();
      });
      await page.goto(`${origin}/services/holding-tax`);
      await page.locator(".ax-skeleton").first().waitFor({ timeout: 15000 });
      assert.equal(
        await page.getByText("No participating office offers this service yet.").count(),
        0,
        "no premature empty state while office information loads",
      );
      await page.unroute(infoUrl);
      await page.locator(".ax-skeleton").first().waitFor({ state: "detached", timeout: 15000 });
    } finally {
      await browser.close();
    }
  },
);
