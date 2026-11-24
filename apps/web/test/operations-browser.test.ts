import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { ensurePendingScan } from "./fixtures/pending-scan.js";
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

test("operations browser: the owner sees scanner health and pending queues first", { timeout: 90000 }, async () => {
  const browser = await browserInstance();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  try {
    // QAFIX-09: arrange one pending scan BEFORE sign-in — the
    // operations panel fetches once on mount and re-polls only
    // every 60s, so a scan arranged after sign-in can leave the
    // panel showing the stale "All clear" state (see consoles).
    await ensurePendingScan(origin);
    await page.goto(`${origin}/login`);
    await page.getByLabel("Email or mobile number", { exact: true }).fill("owner@astra.demo.test");
    await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
    await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await goToWorkspacePage(page, "Platform management");
    const panel = page.locator(".owner-operations");
    await panel.getByRole("heading", { name: "Operations", exact: true }).waitFor();
    await panel.getByText("Waiting for scan", { exact: true }).waitFor();
    await panel.getByText("Recharge requests", { exact: true }).waitFor();
    // Either all clear or plain-language alerts; never an empty box.
    assert.ok((await panel.getByTestId("operations-ok").count()) + (await panel.locator(".operations-alerts li").count()) >= 1);
  } finally {
    await browser.close();
  }
});
