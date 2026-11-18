import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

/**
 * Phase 5 (5A): one browser, many accounts.
 *
 * Live failure being pinned (17 Nov E2E campaign): a tab signed in as one account kept its
 * shell and CSRF token after the browser's session cookie was replaced by another account's
 * sign-in — POSTs failed with "A valid session CSRF token is required.", sign-out did
 * nothing, and the sidebar later showed the other account over stale data. The fixed
 * behaviour: the shell revalidates identity (focus/visibility/session-change), the workspace
 * follows the account the cookie actually holds, and sign-out always completes — after a
 * same-account re-sign-in it ends the current session via the resync + single retry.
 */
const origin = "http://127.0.0.1:5173";
const password = "Demo-Phase1!";

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

async function signIn(page: Page, email: string) {
  await page.goto(`${origin}/login`);
  await page.locator(".login-form #email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

/** Sign in through the API (as another tab of the same browser would) and return the session cookie value. */
async function apiSessionCookie(email: string): Promise<string> {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const cookie = (response.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith("astra_session="),
  );
  assert.ok(cookie, "login must set the session cookie");
  return cookie.split(";")[0].slice("astra_session=".length);
}

async function replaceSessionCookie(page: Page, value: string) {
  await page.context().addCookies([
    { name: "astra_session", value, url: `${origin}/` },
  ]);
}

async function meStatus(cookieValue: string): Promise<number> {
  const response = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { Cookie: `astra_session=${cookieValue}` },
  });
  return response.status;
}

const sidebarIdentity = (page: Page) => page.locator(".sidebar-bottom p");

test(
  "Phase 5: an open tab follows an account switch in the same browser, then signs out cleanly",
  { timeout: 180000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() =>
        localStorage.setItem("astra.language", "en"),
      );
      await signIn(page, "staff@alpha.local.test");
      await sidebarIdentity(page).getByText("alpha staff").waitFor();

      // Another sign-in in the same browser replaces the cookie: the tab's session now
      // belongs to the citizen, while the tab still shows the staff workspace.
      const citizenCookie = await apiSessionCookie("citizen@alpha.local.test");
      await replaceSessionCookie(page, citizenCookie);
      // Returning to the tab revalidates identity: the workspace must switch to the
      // citizen — never keep the staff shell over the citizen's session.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await sidebarIdentity(page).getByText("alpha citizen").waitFor();
      assert.equal(await sidebarIdentity(page).getByText("alpha staff").count(), 0);

      // Sign-out works from the switched state and returns to the sign-in portal.
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.locator(".login-form #email").waitFor();
      assert.equal(await meStatus(citizenCookie), 401);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "Phase 5: after the same account signs in again elsewhere, sign-out still ends the current session",
  { timeout: 180000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() =>
        localStorage.setItem("astra.language", "en"),
      );
      await signIn(page, "staff@alpha.local.test");
      await sidebarIdentity(page).getByText("alpha staff").waitFor();
      const firstCookie = (await page.context().cookies(origin)).find(
        (c) => c.name === "astra_session",
      )!.value;

      // The same account signs in again (second tab/device): the browser cookie now holds
      // the NEW session, while this tab still holds the first session's CSRF token. The
      // logout POST is rejected once, the client resyncs from /auth/me and retries — the
      // sign-out completes instead of doing nothing.
      const secondCookie = await apiSessionCookie("staff@alpha.local.test");
      await replaceSessionCookie(page, secondCookie);
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.locator(".login-form #email").waitFor();
      // The CURRENT (second) session is the one that ended; the first session — the other
      // tab/device — is untouched.
      assert.equal(await meStatus(secondCookie), 401);
      assert.equal(await meStatus(firstCookie), 200);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
