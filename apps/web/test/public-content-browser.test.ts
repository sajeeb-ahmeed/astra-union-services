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
  "public content browser: FAQ answers search, office officers are listed, and an inclusion request can be sent",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${origin}/help`);
      await page.getByLabel("Search help", { exact: true }).fill("refund");
      const answers = page.locator("details[id^=faq-]");
      await answers.first().waitFor();
      assert.ok((await answers.count()) >= 1);
      for (const text of await answers.allInnerTexts()) assert.match(text.toLowerCase(), /refund/);
      await page.locator("#faq-refund summary").click();
      await page.locator("#faq-refund").getByText(/3–5 working days/).waitFor();

      await page.goto(`${origin}/offices`);
      await page.getByLabel("Office name", { exact: true }).fill("Demo Alpha Union");
      await page.getByRole("button", { name: "Search offices", exact: true }).click();
      await page.getByRole("button", { name: "View office", exact: true }).first().click();
      const officers = page.locator(".designated-officers");
      await officers.getByRole("heading", { name: "Designated issuing officers", exact: true }).waitFor();
      assert.ok((await officers.locator("li").count()) >= 1);

      const inclusion = page.locator(".office-inclusion");
      await inclusion.getByRole("button", { name: "Request to add an office", exact: true }).click();
      await inclusion.getByLabel("Office name", { exact: true }).fill(`Synthetic Browser Union ${Date.now()}`);
      await inclusion.getByLabel("Contact name", { exact: true }).fill("Synthetic Contact");
      await inclusion.getByLabel("Position", { exact: true }).fill("UP Secretary");
      await inclusion.getByLabel("Mobile number", { exact: true }).fill("01712000001");
      await inclusion.getByRole("button", { name: "Send request", exact: true }).click();
      await inclusion.getByText("Request received. Thank you.", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    } finally {
      await browser.close();
    }
  },
);
