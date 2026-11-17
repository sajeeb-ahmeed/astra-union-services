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
  "Phase 1 public home on /: 47 services, rail sign-in, search, rail actions, deep link and mobile layout",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // The approved preview path now redirects to the home itself.
      await page.goto(`${origin}/home-preview`);
      assert.equal(new URL(page.url()).pathname, "/");
      const tiles = page.locator(".ax-tile");
      await tiles.first().waitFor();
      assert.equal(await tiles.count(), 47);
      for (const heading of ["ax-rail-account", "ax-rail-verify", "ax-rail-track", "ax-rail-notices"])
        assert.equal(await page.locator(`#${heading}-heading`).count(), 1, heading);
      // Signed-out visitors can sign in from the home's account panel (the real form, MFA included).
      const account = page.locator("#ax-rail-account-heading").locator("..");
      assert.equal(await account.getByLabel("Email", { exact: true }).count(), 1);
      assert.equal(await account.getByLabel("Password", { exact: true }).count(), 1);
      assert.equal(await page.getByLabel("Update preferences", { exact: true }).count(), 1);
      // Office count and notices load after the first paint; capture once both have arrived.
      const loaded = () =>
        page.waitForFunction(
          () =>
            !document.querySelector(".ax-stat:nth-child(2) strong")?.textContent?.includes("—") &&
            !/Loading|লোড হচ্ছে/.test(document.querySelector("#ax-rail-notices-heading")?.parentElement?.textContent ?? ""),
        );
      await loaded();
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({ path: "execution/screenshots/phase1-public-home-desktop.png", fullPage: true });

      await page.locator("#ax-service-search").fill("42");
      assert.equal(await tiles.count(), 1);
      assert.equal(await tiles.first().getAttribute("href"), "/services?service=42");
      await page.locator("#ax-service-search").fill("zzzz");
      assert.equal(await tiles.count(), 0);
      await page.getByRole("button", { name: /সব সেবা দেখুন|Show all services/ }).click();
      assert.equal(await tiles.count(), 47);

      await page.locator("#ax-verify-input").fill("x");
      await page.locator("#ax-rail-verify-heading").locator("..").getByRole("button").click();
      await page.locator("#ax-rail-verify-heading").locator("..").getByRole("alert").waitFor();
      await page.locator("#ax-track-input").fill("00000000-0000-4000-8000-000000000000");
      await page.locator("#ax-rail-track-heading").locator("..").getByRole("button").click();
      await page.locator("#ax-rail-track-heading").locator("..").getByRole("alert").waitFor();

      const token = "a".repeat(64);
      await page.locator("#ax-verify-input").fill(`https://example.test/verify/${token}`);
      await Promise.all([
        page.waitForURL(`${origin}/verify/${token}`),
        page.locator("#ax-rail-verify-heading").locator("..").getByRole("button").click(),
      ]);

      await page.goto(origin);
      await page.locator('.ax-tile[data-service="42"]').click();
      await page.waitForURL(`${origin}/services?service=42`);
      await page.locator(".service-information").waitFor();

      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await mobile.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await mobile.goto(origin);
      await mobile.locator(".ax-tile").first().waitFor();
      assert.equal(
        await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
        "no horizontal page scroll at 390px",
      );
      await mobile.getByRole("button", { name: "English", exact: true }).click();
      await mobile.getByRole("heading", { name: "Choose the service you need" }).waitFor();
      await mobile.waitForFunction(
        () => !/Loading/.test(document.querySelector("#ax-rail-notices-heading")?.parentElement?.textContent ?? ""),
      );
      await mobile.screenshot({ path: "execution/screenshots/phase1-public-home-mobile-en.png", fullPage: true });
      await mobile.getByRole("button", { name: "বাংলা", exact: true }).click();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
