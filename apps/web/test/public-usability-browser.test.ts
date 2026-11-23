import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:5173";
async function launch() {
  const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((name) => /^chromium-/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
      .find((name) => fs.existsSync(name));
  return chromium.launch({ headless: true, executablePath });
}

test(
  "public usability: on mobile the home reaches tracking and verification in both languages",
  { timeout: 60000 },
  async () => {
    // Phase 1: the old home's quick-task buttons became the home navigation and its rail panels.
    const browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(origin);
      await page.getByRole("button", { name: "English", exact: true }).click();
      const nav = page.getByRole("navigation", { name: "Public navigation", exact: true });
      await nav.getByRole("link", { name: "Track application", exact: true }).click();
      await page.waitForURL(/\/tracking$/);
      await page.getByLabel("Application reference", { exact: true }).waitFor();
      await page.goto(origin);
      await page
        .getByRole("navigation", { name: "Public navigation", exact: true })
        .getByRole("link", { name: "Verify certificate", exact: true })
        .click();
      await page.waitForURL(/\/verify$/);
      await page.goto(origin);
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      const banglaNav = page.getByRole("navigation", { name: "প্রধান মেনু", exact: true });
      await banglaNav.getByRole("link", { name: "আবেদনের অবস্থা", exact: true }).waitFor();
      // PORTAL-A: on the Bangla home the aside carries the tracking and
      // verification cards side by side with the services.
      await page.locator("#home-verify-heading").getByText("একটি সনদ যাচাই করুন").waitFor();
      await page.locator("#home-track-heading").getByText("আবেদনের অবস্থা জানুন").waitFor();
      await page.getByLabel("আবেদনের রেফারেন্স নম্বর", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page
        .locator(".hx-hero")
        .screenshot({
          path: "execution/screenshots/usability-public-home-bn.png",
        });
      await banglaNav.getByRole("link", { name: "সনদ যাচাই", exact: true }).click();
      await page.waitForURL(/\/verify$/);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "public usability: Bengali search, empty recovery and the service page replace the long catalog",
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await page.goto(`${origin}/services`);
      const search = page.getByLabel("Search public services", { exact: true });
      await search.waitFor();
      const cards = page.locator(".public-service-grid .svc-card");
      assert.equal(await cards.count(), 47);
      await search.fill(" ৪৫ ");
      assert.equal(await cards.count(), 1);
      // FULL-UIUX-01 (A5): a service is a real page at /services/<slug>;
      // opening the card navigates there and the catalog unmounts.
      await cards.first().click();
      await page.waitForURL(/\/services\/permanent-resident-certificate$/);
      const detail = page.locator(".service-detail");
      await detail.waitFor();
      // The catalog (search + grid) is gone; the cards still on the page
      // are the detail's own "Related services" siblings.
      assert.equal(await page.locator("#public-service-search").count(), 0);
      assert.equal(
        await page.evaluate(() => window.scrollY <= 1),
        true,
        "the service page starts at the top",
      );
      assert.equal(
        await detail.evaluate((el) => el.querySelector("h1")!.getBoundingClientRect().top < window.innerHeight),
        true,
        "the service heading is in the first viewport",
      );
      await detail
        .getByRole("button", { name: "← All services", exact: true })
        .click();
      await page.waitForURL(/\/services$/);
      await page.waitForFunction(
        () => document.activeElement?.id === "public-service-search",
      );
      assert.equal(
        await search.evaluate((element) => document.activeElement === element),
        true,
        "returning to the catalog restores focus to the search",
      );
      assert.equal(await cards.count(), 1);
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      assert.equal(await search.inputValue(), "");
      assert.equal(await cards.count(), 47);
      await search.fill("unmatched-service-example");
      assert.equal(await cards.count(), 0);
      await page
        .getByRole("button", { name: "Show all services", exact: true })
        .click();
      assert.equal(await cards.count(), 47);
      await search.fill("Family certificate");
      await cards.first().click();
      await page.waitForURL(/\/services\/family-certificate$/);
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      await page
        .locator(".service-detail")
        .getByRole("button", { name: "← সব সেবা", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page
        .locator(".service-detail")
        .screenshot({
          path: "execution/screenshots/usability-public-service-bn.png",
        });
    } finally {
      await browser.close();
    }
  },
);

test(
  "public usability: show password never submits; successful login and sign-out return masked empty fields",
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    let loginPosts = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/auth/login") && request.method() === "POST")
        loginPosts++;
    });
    try {
      await page.goto(`${origin}/login`);
      const form = page.locator(".login-form");
      const password = page.getByLabel("Password", { exact: true });
      await page
        .getByLabel("Email", { exact: true })
        .fill("staff@alpha.local.test");
      await password.fill("Demo-Phase1!");
      const toggle = form.getByRole("button", {
        name: "Show password",
        exact: true,
      });
      await toggle.focus();
      await page.keyboard.press("Space");
      assert.equal(await password.getAttribute("type"), "text");
      assert.equal(
        await form
          .getByRole("button", { name: "Hide password", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(loginPosts, 0);
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      await form.getByRole("button", { name: "পাসওয়ার্ড লুকান", exact: true }).click();
      assert.equal(
        await page.locator("#password").getAttribute("type"),
        "password",
      );
      await page.getByRole("button", { name: "English", exact: true }).click();
      await form
        .getByRole("button", { name: "Show password", exact: true })
        .click();
      await form.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await form.waitFor();
      assert.equal(await password.inputValue(), "");
      assert.equal(await password.getAttribute("type"), "password");
      assert.equal(
        await page.getByLabel("Email", { exact: true }).inputValue(),
        "",
      );
      assert.equal(
        await form
          .getByRole("button", { name: "Show password", exact: true })
          .getAttribute("aria-pressed"),
        "false",
      );
      assert.equal(loginPosts, 1);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
    } finally {
      await browser.close();
    }
  },
);
