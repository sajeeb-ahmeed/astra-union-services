import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

test(
  "account security: password-confirmed session revocation, preserved current session and bilingual mobile UI",
  { timeout: 90000 },
  async () => {
    const origin = "http://127.0.0.1:5173";
    const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      (fs.existsSync(local) ? fs.readdirSync(local) : [])
        .filter((name) => /^chromium-/.test(name))
        .sort()
        .reverse()
        .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
        .find((file) => fs.existsSync(file));
    const browser = await chromium.launch({ headless: true, executablePath });
    const admin = await browser.newContext();
    const current = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const other = await browser.newContext();
    const page = await current.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const email = `session-browser-${Date.now()}@example.test`;
    const password = "Session-browser-original-2026!";
    try {
      const setupLogin = await admin.request.post(
        `${origin}/api/v1/auth/login`,
        { data: { email: "admin@alpha.demo.test", password: "Demo-Phase1!" } },
      );
      assert.equal(setupLogin.status(), 200);
      const created = await admin.request.post(`${origin}/api/v1/admin/users`, {
        headers: { "X-CSRF-Token": (await setupLogin.json()).csrfToken },
        data: {
          email,
          password,
          displayName: "Synthetic Session Browser",
          role: "staff",
        },
      });
      assert.equal(created.status(), 201, await created.text());
      assert.equal(
        (
          await other.request.post(`${origin}/api/v1/auth/login`, {
            data: { email, password },
          })
        ).status(),
        200,
      );
      await page.goto(`${origin}/login`);
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page
        .locator(".login-form")
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("button", { name: "My profile", exact: true })
        .click();
      const panel = page.locator(
        'section[aria-labelledby="account-sessions-title"]',
      );
      await panel
        .getByTestId("other-session-count")
        .filter({ hasText: /^1$/ })
        .waitFor();
      await panel
        .getByLabel("Current password to sign out others", { exact: true })
        .fill("incorrect-password");
      await panel
        .getByRole("button", { name: "Sign out other sessions", exact: true })
        .click();
      await panel.getByRole("alert").waitFor();
      assert.equal(
        await panel.locator('input[type="password"]').inputValue(),
        "",
      );
      assert.equal(
        (await other.request.get(`${origin}/api/v1/auth/me`)).status(),
        200,
      );
      await panel
        .getByLabel("Current password to sign out others", { exact: true })
        .fill(password);
      await panel
        .getByRole("button", { name: "Sign out other sessions", exact: true })
        .click();
      await panel
        .getByText("No other active sign-ins.", { exact: true })
        .waitFor();
      assert.equal(
        (await other.request.get(`${origin}/api/v1/auth/me`)).status(),
        401,
      );
      assert.equal(
        (await current.request.get(`${origin}/api/v1/auth/me`)).status(),
        200,
      );
      assert.equal(
        await panel
          .getByRole("button", { name: "Sign out other sessions", exact: true })
          .isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      await panel
        .getByRole("heading", { name: "সক্রিয় লগইন", exact: true })
        .waitFor();
      assert.equal(
        await panel.getByTestId("other-session-count").innerText(),
        "০",
      );
      assert.equal(
        await panel.getByRole("status").innerText(),
        "অন্য সব লগইন বন্ধ করা হয়েছে।",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await panel.screenshot({
        path: "execution/screenshots/account-security-mobile-bn.png",
      });
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("button", { name: "Account security", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Active sign-ins", exact: true })
        .waitFor();
      await page
        .getByText("No other active sign-ins.", { exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
