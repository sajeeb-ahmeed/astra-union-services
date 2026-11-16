import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { signOut } from "./fixtures/session.js";
import { workspacePage } from "./fixtures/workspace-nav.js";
import { demoPayloads } from "@astra/shared-schemas";
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
async function signIn(page: Page, who: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(`${who}@alpha.demo.test`);
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
/** API calls in the signed-in page's session (with its CSRF token). */
/** Opens an application by its full id through the workspace's reference lookup. */
async function openApplication(page: Page, id: string) {
  await workspacePage(page, "Applications").click();
  await page.locator("#application-reference").fill(id);
  await page.getByRole("button", { name: "Find record", exact: true }).click();
}
async function call(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ([m, u, b]) => {
      const me = await (await fetch("/api/v1/auth/me", { credentials: "include" })).json();
      const r = await fetch(`/api/v1${u}`, {
        method: m as string,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      return { status: r.status, body: await r.json() };
    },
    [method, url, body] as const,
  );
}

test(
  "approval chain browser: the Chairman asks the applicant to come and the applicant sees when and where",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await signIn(page, "citizen");
      const citizenId = (await call(page, "GET", "/citizens")).body.items[0].id;
      const payload = demoPayloads[45];
      const created = await call(page, "POST", "/applications", { citizenId, serviceNo: 45, payload });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const id = created.body.id;
      assert.equal((await call(page, "POST", `/applications/${id}/transition`, { action: "submit" })).status, 200);
      await signOut(page);

      // Phase W: no secretary review — the Chairman summons from SUBMITTED.
      await signIn(page, "approver");
      await openApplication(page, id);
      await page.getByLabel("Decision or revocation reason", { exact: true }).fill("Please come to the office on Sunday at 10 am.");
      await page.getByRole("button", { name: "Ask the applicant to come", exact: true }).click();
      await page.locator(".summon-notice").getByText("Please come to the office on Sunday at 10 am.").waitFor();
      await signOut(page);

      await signIn(page, "citizen");
      await openApplication(page, id);
      const notice = page.locator(".summon-notice");
      await notice.getByText("The Chairman has asked the applicant to come").waitFor();
      assert.match(await notice.innerText(), /Sunday at 10 am/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    } finally {
      await browser.close();
    }
  },
);
