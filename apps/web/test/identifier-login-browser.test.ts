import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { readOtpCode } from "./fixtures/otp-outbox.js";
import { chromium, type Browser, type Page } from "playwright";
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
const password = "Demo-Phase1!";
async function signIn(page: Page, type: string, identifier: string) {
  await page.goto(`${origin}/login`);
  await page.locator("#login-identifier-type").selectOption(type);
  await page.locator(".login-form #email").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
}

test(
  "Phase 2b sign-in identifiers: add a mobile number, sign in with it, then remove it",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const mobile = `019${String(Date.now()).slice(-8)}`;
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await signIn(page, "email", "approver@alpha.local.test");
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();

      await goToWorkspacePage(page, "security");
      const panel = page.locator('section[aria-labelledby="sign-in-identifiers-title"]');
      await panel.waitFor();
      const mobileRow = panel.locator("dt", { hasText: "Mobile number" }).locator("xpath=following-sibling::dd[1]");
      await mobileRow.getByRole("button", { name: /Add|Change/ }).click();
      await panel.locator("#identifier-value").fill(`+88 ${mobile}`);
      await panel.locator("#identifier-current-password").fill(password);
      // S-001: a mobile is saved only with a code proven for the new
      // number — send the code, prove it, then save.
      const sentAt = Date.now();
      await panel.getByRole("button", { name: "Send code", exact: true }).click();
      await panel
        .locator("#identifier-otp-code")
        .fill(await readOtpCode(mobile.slice(-8), sentAt));
      await panel.getByRole("button", { name: "Verify code", exact: true }).click();
      await panel.getByText("Verified. Now save.").waitFor();
      await panel.getByRole("button", { name: "Save identifier" }).click();
      await panel.getByText("Saved. You can now sign in with it.").waitFor();
      assert.match((await mobileRow.textContent()) ?? "", new RegExp(`${mobile.slice(0, 3)}\\*+${mobile.slice(-2)}`));
      assert.doesNotMatch((await panel.textContent()) ?? "", new RegExp(mobile));
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await panel.screenshot({ path: "execution/screenshots/phase2b-sign-in-identifiers.png" });
      await page.getByRole("button", { name: "Sign out", exact: true }).click();

      // Wrong mobile and unknown mobile look the same; the right one signs in.
      await signIn(page, "mobile", "01999999999");
      await page.locator(".login-form [role=alert]").waitFor();
      await signIn(page, "mobile", mobile);
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();

      // Clean up the shared demo account.
      await goToWorkspacePage(page, "security");
      await panel.waitFor();
      await mobileRow.getByRole("button", { name: "Remove" }).click();
      await panel.locator("#identifier-current-password").fill(password);
      await panel.getByRole("button", { name: "Remove identifier" }).click();
      await panel.getByText("Removed.").waitFor();
      assert.match((await mobileRow.textContent()) ?? "", /Not added/);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
