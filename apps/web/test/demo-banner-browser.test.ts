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
 * F-008: the mode honesty system was dead code. The local test stack
 * runs in demo mode (ISSUANCE_MODE unset), so the banner must be
 * visible on the public home page; OFFICIAL-mode rendering is covered
 * by the demo-banner unit test (DemoBanner renders nothing there).
 */
test(
  "F-008: demo-mode banner is visible on the public home page",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await page.goto(`${origin}/`);
      const banner = page.locator(".du-demo-banner");
      await banner.waitFor();
      assert.match((await banner.textContent()) ?? "", /not official/i);
    } finally {
      await browser.close();
    }
  },
);
