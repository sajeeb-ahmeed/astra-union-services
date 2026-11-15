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
  "witness browser: a visitor picks the owner's religion and type and downloads a utility PDF",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const stamp = Date.now();
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
    });
    const csrf = (await login.json()).csrfToken;
    const added = await owner.request.post(`${origin}/api/v1/owner/witness-types`, {
      headers: { "X-CSRF-Token": csrf },
      data: { religionBn: "পরীক্ষা ধর্ম", religionEn: `Browser religion ${stamp}`, nameBn: "পরীক্ষা ধরন", nameEn: "Browser type" },
    });
    assert.equal(added.status(), 201, await added.text());
    const typeId = (await added.json()).id;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${origin}/witness`);
      await page.getByRole("heading", { name: "Witness statement", exact: true }).waitFor();
      await page.locator(`#witness-religion option[value="Browser religion ${stamp}"]`).waitFor({ state: "attached" });
      await page.getByLabel("Religion", { exact: true }).selectOption(`Browser religion ${stamp}`);
      await page.getByLabel("Certificate type", { exact: true }).selectOption(typeId);
      await page.getByLabel("Deceased's name (Bangla)", { exact: true }).fill("পরীক্ষা মৃত ব্যক্তি");
      await page.getByLabel("Attestor's name (Bangla)", { exact: true }).fill("পরীক্ষা প্রত্যয়নকারী");
      await page.getByLabel("Attestor's mobile", { exact: true }).fill("01712000003");
      await page.getByLabel("Attestor's NID (10 or 17 digits)", { exact: true }).fill("12345");
      await page.getByRole("button", { name: "Create document", exact: true }).click();
      await page.getByRole("alert").getByText(/10 or 17 digit NID/).waitFor();
      await page.getByLabel("Attestor's NID (10 or 17 digits)", { exact: true }).fill("1234567890");
      await page.getByRole("button", { name: "Create document", exact: true }).click();
      const link = page.getByRole("link", { name: "Download PDF", exact: true });
      await link.waitFor();
      const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
      const file = await download.path();
      assert.equal(fs.readFileSync(file!).subarray(0, 5).toString(), "%PDF-");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    } finally {
      await owner.request.patch(`${origin}/api/v1/owner/witness-types/${typeId}`, { headers: { "X-CSRF-Token": csrf }, data: { active: false } });
      await owner.close();
      await browser.close();
    }
  },
);
