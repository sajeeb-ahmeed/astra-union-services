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

test("user guide browser: every role has its section in both languages, and it prints as a PDF", { timeout: 90000 }, async () => {
  const browser = await browserInstance();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${origin}/guide`);
    await page.getByRole("heading", { name: "Astra user guide", exact: true }).waitFor();
    for (const role of ["Citizens", "Office staff and entrepreneurs", "Secretary (verifier)", "Chairman (approver)", "Office admin and finance", "Platform owner"])
      await page.getByRole("heading", { name: role, exact: true }).waitFor();
    assert.ok((await page.locator(".user-guide ol li").count()) >= 20);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const pdf = await page.pdf({ format: "A4" });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    await page.evaluate(() => localStorage.setItem("astra.language", "bn"));
    await page.reload();
    await page.getByRole("heading", { name: "Astra ব্যবহারের নির্দেশিকা", exact: true }).waitFor();
    await page.getByRole("heading", { name: "চেয়ারম্যান (অনুমোদনকারী)", exact: true }).waitFor();
  } finally {
    await browser.close();
  }
});
