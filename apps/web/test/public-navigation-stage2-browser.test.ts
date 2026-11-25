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

test(
  "L-006: in-app public navigation is client-side — no reload, no second splash",
  { timeout: 180000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}/`);
      await page.locator(".hx-hero").waitFor({ timeout: 30000 });
      // A window property survives client-side navigation but not a full
      // page load — it is the tripwire for every step below.
      await page.evaluate(() => { (window as any).__l006 = "alive"; });
      const markerAlive = async () =>
        assert.equal(await page.evaluate(() => (window as any).__l006), "alive", "a full page load wiped the window marker");
      const splashAbsent = async () =>
        assert.equal(
          await page.getByText("Loading DigitalUnion…").count(),
          0,
          "the first-load splash reappeared on an in-app navigation",
        );

      // Header nav (a NavLink button with the portal's onNavigate).
      await page.locator(".du-header").getByRole("button", { name: "Services", exact: true }).click();
      await page.waitForURL("**/services", { timeout: 15000 });
      await page.locator(".svc-card").first().waitFor({ timeout: 15000 });
      await markerAlive();
      await splashAbsent();

      // Brand link back home (also a NavLink button).
      await page.locator(".du-brand").click();
      await page.waitForURL(`${origin}/`, { timeout: 15000 });
      await page.locator(".hx-hero").waitFor({ timeout: 15000 });
      await markerAlive();
      await splashAbsent();

      // Back/forward: the popstate path re-renders instead of reloading.
      await page.goBack();
      await page.waitForURL("**/services", { timeout: 15000 });
      await page.locator(".svc-card").first().waitFor({ timeout: 15000 });
      await markerAlive();
      await splashAbsent();
      await page.goForward();
      await page.waitForURL(`${origin}/`, { timeout: 15000 });
      await page.locator(".hx-hero").waitFor({ timeout: 15000 });
      await markerAlive();

      // Home tracking form: submit navigates client-side to /tracking
      // and the portal reads ?searchText= on mount.
      await page.locator("#home-track-input").fill("2026111812345678");
      await page.locator(".hp-card").getByRole("button", { name: "Track", exact: true }).click();
      await page.waitForURL("**/tracking?searchText=2026111812345678", { timeout: 15000 });
      // Wait for the page content first: the portal chunk resolves
      // before the form renders, and only then is "no splash" meaningful.
      await page.locator("#tracking-id").waitFor({ timeout: 15000 });
      await markerAlive();
      await splashAbsent();

      // Back home, then the home verify form: a bogus 16-digit number
      // navigates client-side to /verify?searchText=… and the App renders
      // CertificateVerification for it (which reports "not found").
      await page.locator(".du-brand").click();
      await page.waitForURL(`${origin}/`, { timeout: 15000 });
      await page.locator(".hx-hero").waitFor({ timeout: 15000 });
      await page.locator("#home-verify-input").fill("1111111111111111");
      await page.locator(".hp-card").getByRole("button", { name: "Verify", exact: true }).click();
      await page.waitForURL("**/verify?searchText=1111111111111111", { timeout: 15000 });
      await page.getByText("Certificate not found").waitFor({ timeout: 15000 });
      await markerAlive();
      await splashAbsent();

      // Plain-anchor safety net: the home help card's /help link is a
      // plain <a href> — the delegated interceptor must catch it.
      await page.locator(".du-brand").click();
      await page.waitForURL(`${origin}/`, { timeout: 15000 });
      await page.locator(".hx-hero").waitFor({ timeout: 15000 });
      await page.locator(".hp-links a[href=\"/help\"]").click();
      await page.waitForURL("**/help", { timeout: 15000 });
      await page.getByRole("heading", { name: "Help & FAQ", exact: true }).waitFor({ timeout: 15000 });
      await markerAlive();
      await splashAbsent();

      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
