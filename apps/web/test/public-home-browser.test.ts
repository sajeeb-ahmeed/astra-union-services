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
      // Discovery (home §4): HOME-REDESIGN-02 replaced the 8-card
      // popular grid with the full service directory — .hsd-tile links
      // (HomeServiceDirectory), the first 18 at rest and the rest
      // behind "Show all 47 services"; the 47-card .svc-card grid
      // lives only on /services.
      const tiles = page.locator(".hsd-grid .hsd-tile");
      await tiles.first().waitFor();
      assert.equal(await tiles.count(), 18);
      // PORTAL-A: services + four steps in the main column; track, verify,
      // offices and help in the aside. The FAQ list moved to /help.
      for (const heading of ["home-services-heading", "home-how-heading", "home-track-heading", "home-verify-heading", "home-offices-heading", "home-help-heading"])
        assert.equal(await page.locator(`#${heading}`).count(), 1, heading);
      assert.equal(await page.locator("#home-faq-heading").count(), 0, "the FAQ list lives on /help");
      // PORTAL-A: the header offers the three doors of a service portal.
      const header = page.locator(".du-header");
      assert.equal(await header.getByRole("link", { name: "Register", exact: true }).getAttribute("href"), "/register");
      assert.equal(await header.getByRole("link", { name: "Office account", exact: true }).getAttribute("href"), "/register-office");
      assert.equal(await header.getByRole("link", { name: "Login", exact: true }).getAttribute("href"), "/login");
      // …and one flat six-item menu.
      const menu = page.getByRole("navigation", { name: "Public navigation", exact: true });
      assert.deepEqual(
        await menu.getByRole("link").allTextContents(),
        ["Home", "Services", "Track application", "Verify certificate", "Union offices", "Help & FAQ"],
      );
      // HOME-REDESIGN-02 CONTRACT CHANGE: the §5 account card is gone.
      // The hero carries the account actions as plain links — a
      // "Create a free account" CTA (/register) and a "Sign in" link
      // (/login) inside .hx-hero-ctas — still with no credential fields
      // on the home itself. The footer subscribe form is still present.
      const heroCtas = page.locator(".hx-hero-ctas");
      assert.equal(await heroCtas.getByLabel("Email or mobile number", { exact: true }).count(), 0);
      assert.equal(await heroCtas.getByLabel("Password", { exact: true }).count(), 0);
      const signInLink = heroCtas.getByRole("link", { name: "Sign in", exact: true });
      assert.equal(await signInLink.count(), 1);
      assert.equal(await signInLink.getAttribute("href"), "/login");
      const registerLink = heroCtas.getByRole("link", { name: "Create a free account", exact: true });
      assert.equal(await registerLink.count(), 1);
      assert.equal(await registerLink.getAttribute("href"), "/register");
      // PORTAL-E: no footer "updates" sign-up while outgoing email is not connected.
      assert.equal(await page.locator("#ax-subscribe-email").count(), 0);
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({ path: "execution/screenshots/phase1-public-home-desktop.png", fullPage: true });

      // Hero search: a service number narrows to that service's page;
      // an unknown term offers the catalogue instead of results.
      await page.locator("#home-service-search").fill("42");
      const results = page.locator(".hx-search-results a");
      await results.first().waitFor();
      assert.equal(await results.count(), 1);
      assert.equal(await results.first().getAttribute("href"), "/services/trade-license");
      await page.locator("#home-service-search").fill("zzzz");
      // HOME-REDESIGN-02: an unknown term offers the catalogue itself —
      // exactly one link, to /services ("No service by that name"),
      // not an empty result list.
      const fallback = page.locator(".hx-search-results a");
      await fallback.first().waitFor();
      assert.equal(await fallback.count(), 1);
      assert.equal(await fallback.first().getAttribute("href"), "/services");
      // All 47 services are one click away on the catalogue page.
      await page.getByRole("link", { name: "All 47 services", exact: true }).click();
      await page.waitForURL(`${origin}/services`);
      await page.locator(".public-service-grid .svc-card").first().waitFor();
      assert.equal(await page.locator(".public-service-grid .svc-card").count(), 47);
      await page.goto(`${origin}/`);

      // Verify spotlight (home §6): an incomplete entry is rejected in
      // place, and a full QR link routes to the verification page.
      await page.locator("#home-verify-input").fill("x");
      await page.locator(".hx-verify-form").getByRole("button").click();
      await page.locator("#home-verify-error").waitFor();
      const token = "a".repeat(64);
      await page.locator("#home-verify-input").fill(`https://example.test/verify/${token}`);
      await Promise.all([
        page.waitForURL(`${origin}/verify/${token}`),
        page.locator(".hx-verify-form").getByRole("button").click(),
      ]);

      // PORTAL-A: the home track card — an empty entry is rejected in
      // place; a reference opens /tracking with the lookup already run,
      // and an unknown reference alerts there.
      await page.goto(`${origin}/`);
      await page.locator("#home-track-input").waitFor();
      await page.locator("#home-track-input").press("Enter");
      await page.locator("#home-track-error").waitFor();
      const unknown = "00000000-0000-4000-8000-000000000000";
      await page.locator("#home-track-input").fill(unknown);
      await Promise.all([
        page.waitForURL(`${origin}/tracking?searchText=${unknown}`),
        page.locator("#home-track-input").press("Enter"),
      ]);
      // QAFIX-D fix-forward: the /tracking mount effect fills #tracking-id
      // from ?searchText= after the navigation lands, so asserting the
      // value the instant waitForURL resolves races the effect (the
      // 111/112 closing run read '' here; the same test passes on
      // re-run). Wait for the effect to land instead of asserting
      // immediately. No product change — the prefill behaviour is
      // correct; only the test's timing was racy.
      await page.waitForFunction(
        (expected) =>
          (document.querySelector("#tracking-id") as HTMLInputElement)
            ?.value === expected,
        unknown,
      );
      assert.equal(await page.locator("#tracking-id").inputValue(), unknown);
      await page.getByRole("alert").waitFor();

      // The tracking page itself still works from an empty form.
      await page.goto(`${origin}/tracking`);
      // Task C: wait for the mounted input before filling it — the
      // fill used to be the first render assertion on this navigation
      // and timed out on a blank page.
      await page.locator("#tracking-id").waitFor();
      await page.locator("#tracking-id").fill(unknown);
      await page.locator("#public-content").getByRole("button", { name: "Track application", exact: true }).click();
      await page.getByRole("alert").waitFor();

      // A directory tile deep-links to the service detail page. The
      // directory shows the first 18 tiles at rest, so expand it to
      // reach service 42's tile.
      await page.goto(`${origin}/`);
      await page.locator(".hsd-more").click();
      await page.locator('.hsd-tile[href="/services/trade-license"]').click();
      await page.waitForURL(`${origin}/services/trade-license`);
      await page.locator(".service-detail").waitFor();

      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await mobile.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await mobile.goto(origin);
      await mobile.locator(".hsd-grid .hsd-tile").first().waitFor();
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
