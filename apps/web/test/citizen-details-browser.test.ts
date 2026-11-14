import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { workspacePage } from "./fixtures/workspace-nav.js";
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
async function signIn(page: Page, email: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
// A synthetic 17-digit NID that is unique per run, so repeated runs never hit the duplicate check.
const nid = `19${String(Date.now()).slice(-13)}00`.slice(0, 17);

test(
  "citizen details browser: staff register a citizen with an encrypted NID, see only the hint, and reveal on request",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await signIn(page, "staff@alpha.demo.test");
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await workspacePage(page, "Citizens").click();
      const name = `Details Browser Citizen ${Date.now()}`;
      await page.getByLabel("Name (English)", { exact: true }).fill(name);
      await page.getByLabel("Name (Bangla)", { exact: true }).fill("বিস্তারিত পরীক্ষার নাগরিক");
      await page.getByLabel("Date of birth", { exact: true }).fill("1991-02-03");
      await page.getByLabel("Address (Bangla)", { exact: true }).fill("নমুনা পরীক্ষার গ্রাম");
      await page.getByLabel("Address (English)", { exact: true }).fill("Synthetic Details Village");
      const union = JSON.parse(fs.readFileSync("data/geo/unions.json", "utf8")).find(
        (row: any) => row.upazilaCode === "upa-001",
      );
      for (const [level, code] of [
        ["division", "div-01"],
        ["district", "dis-01"],
        ["upazila", "upa-001"],
        ["union", union.code],
        ["ward", `${union.code}-w01`],
      ]) {
        await page.locator(`#citizen-geo-${level} option[value="${code}"]`).waitFor({ state: "attached" });
        await page.locator(`#citizen-geo-${level}`).selectOption(code);
      }
      await page.locator("#citizen-details-nid").fill(nid);
      await page.locator("#citizen-details-mobile").fill("01712345678");
      await page.locator("#citizen-details-gender").selectOption("female");
      await page.locator("#citizen-details-fatherNameEn").fill("Synthetic Father");
      const registered = page.waitForResponse(
        (response) => response.url().endsWith("/citizens") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Register citizen", exact: true }).click();
      const response = await registered;
      assert.equal(response.status(), 201, await response.text());
      const created = await response.json();
      assert.equal(created.nidHint, `••••${nid.slice(-3)}`);
      assert.equal(JSON.stringify(created).includes(nid), false);
      // The registration form is cleared for the next citizen.
      await page.waitForFunction(
        () => (document.querySelector("#citizen-details-nid") as HTMLInputElement | null)?.value === "",
      );

      await page.getByRole("button", { name: `Details: ${name}`, exact: true }).click();
      const panel = page.locator(".citizen-details-editor");
      await panel.waitFor();
      assert.equal(await panel.getByTestId("nid-value").innerText(), `••••${nid.slice(-3)}`);
      assert.equal(await panel.locator('[id$="-fatherNameEn"]').inputValue(), "Synthetic Father");
      const reveal = page.waitForResponse((r) => r.url().endsWith(`/citizens/${created.id}/identity`));
      await panel.getByRole("button", { name: "Show full numbers", exact: true }).click();
      assert.equal((await reveal).status(), 200);
      await panel.getByTestId("nid-value").getByText(nid, { exact: true }).waitFor();

      await panel.locator('[id$="-blood"]').selectOption("B+");
      await panel.getByRole("button", { name: "Save details", exact: true }).click();
      await panel.getByText("Details saved", { exact: true }).waitFor();
      // Saving returns to the masked view; the number field stays blank and keeps the stored NID.
      assert.equal(await panel.getByTestId("nid-value").innerText(), `••••${nid.slice(-3)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      fs.mkdirSync("execution/evidence/phase3", { recursive: true });
      await panel.screenshot({ path: "execution/evidence/phase3/citizen-details-staff.png" });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "citizen details browser: a citizen sees their own details on the profile page at phone width",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await signIn(page, "citizen@alpha.demo.test");
      await workspacePage(page, "My profile").click();
      const panel = page.locator(".citizen-details-editor");
      await panel.waitFor();
      await panel.getByRole("button", { name: "Save details", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    } finally {
      await browser.close();
    }
  },
);
