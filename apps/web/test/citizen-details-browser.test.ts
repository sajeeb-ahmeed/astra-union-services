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

test(
  "profile completeness browser: the details panel shows what is missing and the admin switch saves",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await signIn(page, "staff@alpha.demo.test");
      await workspacePage(page, "Citizens").click();
      // A fresh citizen without an ID number or mobile decision is incomplete.
      const name = `Completeness Browser Citizen ${Date.now()}`;
      const created = await page.evaluate(async (nameEn) => {
        const session = await (await fetch("/api/v1/auth/me", { credentials: "include" })).json();
        const own = await (await fetch("/api/v1/citizens", { credentials: "include" })).json();
        const geography = own.items.find((c: any) => c.geography?.wardCode)?.geography;
        const r = await fetch("/api/v1/citizens", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
          body: JSON.stringify({
            nameBn: "পূর্ণতা পরীক্ষা",
            nameEn,
            dateOfBirth: "1990-04-05",
            addressBn: "নমুনা গ্রাম ঠিকানা",
            addressEn: "Synthetic village address",
            ...(geography ? { geography } : {}),
          }),
        });
        return { status: r.status, body: await r.json() };
      }, name);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      await page.reload();
      await workspacePage(page, "Citizens").click();
      await page.getByRole("button", { name: `Details: ${name}`, exact: true }).click();
      const indicator = page.locator(".citizen-details-editor [data-testid=profile-completeness]");
      await indicator.getByText("Profile incomplete", { exact: true }).waitFor();
      await indicator.getByText("NID or birth registration number", { exact: true }).waitFor();
      const panel = page.locator(".citizen-details-editor");
      await panel.locator('[id$="-birth-reg"]').fill(`20${String(Date.now()).slice(-13)}11`.slice(0, 17));
      await panel.locator('[id$="-no-mobile"]').check();
      await panel.getByRole("button", { name: "Save details", exact: true }).click();
      await indicator.getByText("Profile complete", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();

      await signIn(page, "admin@alpha.demo.test");
      await workspacePage(page, "Office administration").click();
      await page.getByRole("tab", { name: "Office profile", exact: true }).click();
      const toggle = page.locator("#require-complete-profile");
      await toggle.waitFor();
      assert.equal(await toggle.isChecked(), false);
      await toggle.click();
      await page.getByText("Certificates now require a complete citizen profile.", { exact: true }).waitFor();
      assert.equal(await toggle.isChecked(), true);
      // Leave the shared demo office as seeded.
      await toggle.click();
      await page.getByText("Incomplete profiles now show a warning only.", { exact: true }).waitFor();
      assert.equal(await toggle.isChecked(), false);
    } finally {
      await browser.close();
    }
  },
);

test(
  "identity document browser: staff attach an ID image that stays quarantined, then remove it",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await signIn(page, "staff@alpha.demo.test");
      await workspacePage(page, "Citizens").click();
      const first = page.getByRole("button", { name: /^Details: / }).first();
      await first.click();
      const section = page.locator(".citizen-details-editor .identity-document");
      await section.waitFor();
      if (await section.getByRole("button", { name: "Remove image", exact: true }).count()) {
        await section.getByRole("button", { name: "Remove image", exact: true }).click();
        await section.getByText("No ID document image on file. Adding one is optional.", { exact: true }).waitFor();
      }
      await section.locator("select").selectOption("birth_reg");
      // A minimal well-formed JPEG; it is synthetic test data, never a real document.
      const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(64, 7), Buffer.from([255, 217])]);
      const linked = page.waitForResponse(
        (r) => r.url().includes("/identity-document") && r.request().method() === "PUT",
      );
      await section.locator('input[type="file"]').setInputFiles({ name: "synthetic-id.jpg", mimeType: "image/jpeg", buffer: jpeg });
      assert.equal((await linked).status(), 200);
      await section.locator("strong", { hasText: "Birth registration" }).waitFor();
      await section.getByText(/Waiting for safety check|Safety check in progress|Not yet checked/).first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await section.getByRole("button", { name: "Remove image", exact: true }).click();
      await section.getByText("No ID document image on file. Adding one is optional.", { exact: true }).waitFor();
    } finally {
      await browser.close();
    }
  },
);
