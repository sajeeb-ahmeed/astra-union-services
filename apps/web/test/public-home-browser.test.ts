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
  "Phase 1 public home on /: service discovery, account sign-in, hero search, verify spotlight, deep links and mobile layout",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // FULL-UIUX-01 (A14): /home-preview no longer redirects — unknown
      // addresses get the not-found view. The home itself lives at /.
      await page.goto(`${origin}/`);
      assert.equal(new URL(page.url()).pathname, "/");
      // Discovery (home §4): the home shows the 8 popular services as
      // ServiceCards; the full 47-service grid lives only on /services.
      const cards = page.locator(".home-service-grid .svc-card");
      await cards.first().waitFor();
      assert.equal(await cards.count(), 8);
      for (const heading of ["home-services-heading", "home-how-heading", "home-verify-heading", "home-offices-heading", "home-faq-heading"])
        assert.equal(await page.locator(`#${heading}`).count(), 1, heading);
      // REFINEMENT-02 P2-1(a) CONTRACT CHANGE (intentional, owner-approved
      // plan): the §5 account card no longer embeds the sign-in form; it is
      // a compact CTA card linking to the split-screen login/register. The
      // expectation below asserts the NEW contract: no credential fields in
      // the card, exactly one Sign in link (/login) and one Register link
      // (/register). The footer subscribe form is still present.
      const account = page.locator(".home-account-card");
      assert.equal(await account.getByLabel("Email", { exact: true }).count(), 0);
      assert.equal(await account.getByLabel("Password", { exact: true }).count(), 0);
      const signInLink = account.getByRole("link", { name: "Sign in", exact: true });
      assert.equal(await signInLink.count(), 1);
      assert.equal(await signInLink.getAttribute("href"), "/login");
      const registerLink = account.getByRole("link", { name: "Register", exact: true });
      assert.equal(await registerLink.count(), 1);
      assert.equal(await registerLink.getAttribute("href"), "/register");
      assert.equal(await page.locator("#ax-subscribe-email").count(), 1);
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({ path: "execution/screenshots/phase1-public-home-desktop.png", fullPage: true });

      // Hero search: a service number narrows to that service's page;
      // an unknown term offers the catalogue instead of results.
      await page.locator("#home-service-search").fill("42");
      const results = page.locator(".home-hero-results a");
      await results.first().waitFor();
      assert.equal(await results.count(), 1);
      assert.equal(await results.first().getAttribute("href"), "/services/trade-license");
      await page.locator("#home-service-search").fill("zzzz");
      await page.locator(".home-hero-results p").waitFor();
      assert.equal(await page.locator(".home-hero-results a").count(), 0);
      // All 47 services are one click away on the catalogue page.
      await page.getByRole("link", { name: "See all 47 services", exact: true }).click();
      await page.waitForURL(`${origin}/services`);
      await page.locator(".public-service-grid .svc-card").first().waitFor();
      assert.equal(await page.locator(".public-service-grid .svc-card").count(), 47);
      await page.goto(`${origin}/`);

      // Verify spotlight (home §6): an incomplete entry is rejected in
      // place, and a full QR link routes to the verification page.
      await page.locator("#home-verify-input").fill("x");
      await page.locator(".home-verify-form").getByRole("button").click();
      await page.locator(".home-verify-error").waitFor();
      const token = "a".repeat(64);
      await page.locator("#home-verify-input").fill(`https://example.test/verify/${token}`);
      await Promise.all([
        page.waitForURL(`${origin}/verify/${token}`),
        page.locator(".home-verify-form").getByRole("button").click(),
      ]);

      // Tracking lives on its own page now; an unknown reference alerts.
      await page.goto(`${origin}/tracking`);
      await page.locator("#tracking-id").fill("00000000-0000-4000-8000-000000000000");
      await page.locator("#public-content").getByRole("button", { name: "Track application", exact: true }).click();
      await page.getByRole("alert").waitFor();

      // A popular-service card deep-links to the service detail page.
      await page.goto(`${origin}/`);
      await page.locator('.home-service-grid .svc-card[data-service="42"]').click();
      await page.waitForURL(`${origin}/services/trade-license`);
      await page.locator(".service-detail").waitFor();

      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await mobile.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await mobile.goto(origin);
      await mobile.locator(".home-service-grid .svc-card").first().waitFor();
      assert.equal(
        await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
        "no horizontal page scroll at 390px",
      );
      await mobile.getByRole("heading", { name: "Your union's certificates, now online" }).waitFor();
      await mobile.screenshot({ path: "execution/screenshots/phase1-public-home-mobile-en.png", fullPage: true });
      await mobile.getByRole("button", { name: "বাংলা", exact: true }).click();
      await mobile.getByRole("heading", { name: "আপনার ইউনিয়নের সনদ, এখন অনলাইনে" }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
