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
      await page.locator("#ax-rail-track-heading").getByText("আবেদনের অবস্থা").waitFor();
      await page.locator("#ax-rail-verify-heading").getByText("সনদ যাচাই").waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page
        .locator(".ax-title-band")
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
  "public usability: Bengali search, empty recovery and selected service replace the long catalog",
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(`${origin}/services`);
      const search = page.getByLabel("Search public services", { exact: true });
      await search.waitFor();
      assert.equal(await page.locator(".public-service").count(), 47);
      await search.fill(" ৪৫ ");
      assert.equal(await page.locator(".public-service").count(), 1);
      await page.locator(".public-service").click();
      const detail = page.getByRole("region", {
        name: "Service information",
        exact: true,
      });
      await detail.waitFor();
      assert.equal(
        await detail.evaluate((element) => document.activeElement === element),
        true,
      );
      assert.equal(await page.locator(".public-service").count(), 0);
      assert.ok(
        (await detail.boundingBox())!.y < 150,
        "Selected service should be brought into view",
      );
      await detail
        .getByRole("button", { name: "← Choose another service", exact: true })
        .click();
      assert.equal(
        await search.evaluate((element) => document.activeElement === element),
        true,
      );
      assert.equal(await page.locator(".public-service").count(), 1);
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      assert.equal(await search.inputValue(), "");
      assert.equal(await page.locator(".public-service").count(), 47);
      await search.fill("unmatched-service-example");
      assert.equal(await page.locator(".public-service").count(), 0);
      await page
        .getByRole("button", { name: "Show all services", exact: true })
        .click();
      assert.equal(await page.locator(".public-service").count(), 47);
      await search.fill("Family certificate");
      await page.locator(".public-service").click();
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      await page
        .locator(".service-information")
        .getByRole("button", { name: "← অন্য সেবা বেছে নিন", exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#public-service-search").inputValue(),
        "Family certificate",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page
        .locator(".service-information")
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
        .fill("staff@alpha.demo.test");
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
      await form.getByRole("button", { name: "লুকান", exact: true }).click();
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
