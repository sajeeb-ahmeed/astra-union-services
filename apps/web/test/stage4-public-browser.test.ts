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
async function newPage(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  return page;
}

/**
 * F-006: /register-office used to inherit the previous page's
 * document.title (OfficeRegistration never called applyPageHead).
 * It now sets its own title.
 */
test("F-006: register-office sets its own document title", { timeout: 90000 }, async () => {
  const browser = await browserInstance();
  try {
    const page = await newPage(browser);
    await page.goto(`${origin}/`);
    const homeTitle = await page.title();
    await page.goto(`${origin}/register-office`);
    // The route renders after the async tenant/session load, so the
    // shell's home title is visible first — wait for the real one.
    await page.waitForFunction(
      (t) => document.title === t,
      "Open an office account | DigitalUnion",
      { timeout: 15000 },
    );
    assert.equal(await page.title(), "Open an office account | DigitalUnion");
    assert.notEqual(await page.title(), homeTitle);
  } finally {
    await browser.close();
  }
});

/**
 * F-017: a /help search with no matches used to render a bare heading.
 * It now renders the services-search EmptyState pattern with a reset.
 */
test("F-017: help search with no matches shows an explicit empty state with a reset", { timeout: 90000 }, async () => {
  const browser = await browserInstance();
  try {
    const page = await newPage(browser);
    await page.goto(`${origin}/help`);
    await page.locator("#faq-search").fill("zzzqqqnomatch");
    await page.getByText("No answers match that search.").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Show all questions" }).click();
    assert.equal(await page.locator("#faq-search").inputValue(), "");
    assert.ok((await page.locator("details").count()) > 0, "questions return after the reset");
  } finally {
    await browser.close();
  }
});

/**
 * F-018: the office directory used to render a count of 0 and an empty
 * grid when filters matched no office. It now renders an EmptyState
 * with a one-click filter reset.
 */
test("F-018: office directory with no matching offices shows an empty state with a reset", { timeout: 90000 }, async () => {
  const browser = await browserInstance();
  try {
    const page = await newPage(browser);
    await page.goto(`${origin}/offices`);
    await page.locator("#directory-name").fill("zzzqqqnomatch");
    await page.getByRole("button", { name: "Search offices" }).click();
    await page.getByText("No offices match these filters.").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Show all offices" }).click();
    await page.waitForTimeout(1500);
    assert.equal(await page.getByText("No offices match these filters.").count(), 0, "empty state clears after the reset");
    assert.ok((await page.locator(".office-card").count()) > 0, "offices return after the reset");
  } finally {
    await browser.close();
  }
});
