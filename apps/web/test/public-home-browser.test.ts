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
  "Public home on / (PORTAL-LANDING): grouped services, account doors, hero search, quick track/verify, text size, deep links and mobile layout",
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
      // PORTAL-LANDING (owner's reference portal): all 47 services on the
      // home page in seven groups, each service linked once; the 47-card
      // .svc-card grid lives on /services.
      const groups = page.locator(".ph-group");
      await groups.first().waitFor();
      assert.equal(await groups.count(), 7);
      assert.equal(await page.locator(".ph-group .ph-service").count(), 47);
      // Hero quick services (track tab first), services, four steps and the
      // FAQ in the main column; notices, hotlines and help in the aside; the
      // office band below.
      for (const heading of ["home-quick-heading", "home-track-heading", "home-account-heading", "home-services-heading", "home-how-heading", "home-faq-heading", "home-notices-heading", "home-hotline-heading", "home-help-heading", "home-offices-heading"])
        assert.equal(await page.locator(`#${heading}`).count(), 1, heading);
      // Group chips narrow the directory; the filter box narrows by name.
      await page.locator(".ph-chips").getByRole("button", { name: /^Tax & licences/ }).click();
      assert.equal(await page.locator(".ph-group").count(), 1);
      assert.equal(await page.locator(".ph-group .ph-service").count(), 4);
      await page.locator(".ph-chips").getByRole("button", { name: /^All services/ }).click();
      await page.locator("#home-service-filter").fill("trade");
      assert.equal(await page.locator(".ph-group .ph-service").count(), 1);
      await page.locator("#home-service-filter").fill("");
      assert.equal(await page.locator(".ph-group .ph-service").count(), 47);
      // The header offers the three doors of a service portal.
      const header = page.locator(".du-header");
      assert.equal(await header.getByRole("link", { name: "Register", exact: true }).getAttribute("href"), "/register");
      assert.equal(await header.getByRole("link", { name: "Office account", exact: true }).getAttribute("href"), "/register-office");
      assert.equal(await header.getByRole("link", { name: "Login", exact: true }).getAttribute("href"), "/login");
      // …and the reference portal's seven-item menu.
      const menu = page.getByRole("navigation", { name: "Public navigation", exact: true });
      assert.deepEqual(
        await menu.getByRole("link").allTextContents(),
        ["Home", "Services", "Track application", "Verify certificate", "Notice board", "How it works", "Help & FAQ"],
      );
      // The citizen-account card carries the account doors as plain links,
      // with no credential fields on the home itself.
      const account = page.locator(".ph-account");
      assert.equal(await account.getByLabel("Email or mobile number", { exact: true }).count(), 0);
      assert.equal(await account.getByLabel("Password", { exact: true }).count(), 0);
      assert.equal(await account.getByRole("link", { name: "Login", exact: true }).getAttribute("href"), "/login");
      assert.equal(await account.getByRole("link", { name: "Register", exact: true }).getAttribute("href"), "/register");
      // Text size (অ- / অ / অ+) scales the page and is remembered.
      await page.getByRole("button", { name: "Larger text", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), "112.5%");
      await page.getByRole("button", { name: "Normal text", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), "100%");
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

      // Verify (quick-services tab): an incomplete entry is rejected in
      // place, and a full QR link routes to the verification page.
      await page.getByRole("tab", { name: "Verify certificate", exact: true }).click();
      assert.equal(await page.locator("#home-verify-heading").count(), 1);
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

      // A directory link deep-links to the service detail page.
      await page.goto(`${origin}/`);
      await page.locator('.ph-service[href="/services/trade-license"]').click();
      await page.waitForURL(`${origin}/services/trade-license`);
      await page.locator(".service-detail").waitFor();

      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await mobile.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await mobile.goto(origin);
      await mobile.locator(".ph-group .ph-service").first().waitFor();
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
