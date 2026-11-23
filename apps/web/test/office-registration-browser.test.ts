import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { goToWorkspacePage, workspacePage } from "./fixtures/workspace-nav.js";
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
async function signIn(page: Page, email: string, secret: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
}

test(
  "Phase 2d office registration: request a post, wait for review, owner approves, then sign in",
  { timeout: 150000 },
  async () => {
    const browser = await browserInstance();
    const email = `office-applicant-${Date.now()}@example.test`;
    const secret = randomBytes(12).toString("base64url"); // generated per run
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await page.goto(origin);
      await page.getByRole("link", { name: "Request to add your office" }).click();
      await page.waitForURL(`${origin}/register-office`);

      const office = page.locator("#office-reg-office");
      const alpha = office.locator("option", { hasText: "Alpha Union" });
      await alpha.waitFor({ state: "attached" });
      await office.selectOption((await alpha.getAttribute("value"))!);
      const post = page.locator("#office-reg-post");
      await post.locator('option[value="digital_centre_entrepreneur"]').waitFor({ state: "attached" });
      assert.equal(await post.locator('option[value="municipality_mayor"]').count(), 0);
      await post.selectOption("digital_centre_entrepreneur");
      await page.locator("#office-reg-name").fill("Synthetic UDC Applicant");
      await page.locator("#office-reg-email").fill(email);
      await page.locator("#office-reg-password").fill(secret);
      await page.getByRole("button", { name: "Send for verification" }).click();
      await page.getByRole("heading", { name: "Request sent" }).waitFor();
      fs.mkdirSync("execution/screenshots", { recursive: true });

      // Before approval the right password gets a clear "waiting" answer, and no workspace.
      await signIn(page, email, secret);
      await page.locator(".login-form [role=alert]").getByText(/waiting for verification/).waitFor();

      const owner = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await owner.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await signIn(owner, "owner@astra.demo.test", "Demo-Phase1!");
      await owner.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      // FULL-UIUX-01: the owner lands on the console (its sidebar entry is
      // the current page and the sidebar is collapsed there).
      await goToWorkspacePage(owner, "owner");
      // OWNER-REDESIGN-01: the verification queue lives in the Permissions section.
      await owner.locator('.owner-nav a[href="#owner-permissions"]').click();
      const queue = owner.locator('section[aria-labelledby="owner-requests-title"]');
      const row = queue.locator("tr", { hasText: email });
      await row.waitFor();
      assert.match((await row.textContent()) ?? "", /Digital Centre Entrepreneur/);
      // Only the queue: the owner page lists every office, which can be thousands of rows in a long-lived test database.
      await queue.screenshot({ path: "execution/screenshots/phase2d-owner-queue.png" });
      await row.getByRole("button", { name: "Approve" }).click();
      await queue.getByText("Approved. They can now sign in.").waitFor();

      await signIn(page, email, secret);
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
