import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
const base = "http://127.0.0.1:5173";
async function launch() {
  const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((n) => /^chromium-/.test(n))
      .sort()
      .reverse()
      .map((n) => path.join(local, n, "chrome-win64", "chrome.exe"))
      .find((f) => fs.existsSync(f));
  return chromium.launch({ headless: true, executablePath });
}
async function login(page: Page, role = "staff") {
  await page.goto(`${base}/login`);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${role}@alpha.demo.test`);
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "What would you like to do?", exact: true })
    .waitFor();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name, exact: true })
    .click();
}

test(
  "workspace usability: mobile task entry, bilingual search, actionable validation and draft-to-submit guidance",
  { timeout: 90000 },
  async () => {
    const browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await login(page);
      assert.equal(await page.locator(".workspace-tasks button").count(), 3);
      await page.getByRole("button", { name: /Start an application/ }).click();
      await page.getByRole("list", { name: "Application steps" }).waitFor();
      await page.locator("#service-search").fill("৪৫");
      assert.equal(await page.locator(".catalog .service").count(), 1);
      await page.locator("#service-search").fill("no-such-service-ux");
      await page
        .getByText(
          "No matching service. Try a different name or service number.",
        )
        .waitFor();
      await page
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      assert.equal(await page.locator(".catalog .service").count(), 47);
      await page
        .locator('#applicant option:not([value=""])')
        .first()
        .waitFor({ state: "attached" });
      await page.locator("#applicant").selectOption({ index: 1 });
      const firstCitizen = await page.locator("#applicant").inputValue();
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      await page.getByRole("list", { name: "আবেদনের ধাপ" }).waitFor();
      assert.equal(await page.locator("#applicant").inputValue(), firstCitizen);
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page.getByRole("link", { name: "Go to form", exact: true }).click();
      await page
        .getByRole("button", { name: "Save draft application", exact: true })
        .click();
      await page.locator(".error-summary").waitFor();
      await page.waitForFunction(() =>
        document.activeElement?.classList.contains("error-summary"),
      );
      const firstError = page.locator(".error-summary button").first();
      assert.doesNotMatch(
        await firstError.innerText(),
        /purpose_en|delivery_language|applicant_/,
      );
      await firstError.click();
      assert.ok(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("data-field-path"),
        ),
      );
      await page
        .getByRole("button", { name: "Fill synthetic example", exact: true })
        .click();
      const created = page.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save draft application", exact: true })
        .click();
      assert.equal((await created).status(), 201);
      await page
        .getByText("Draft saved. Open the draft and submit it when ready.", {
          exact: true,
        })
        .waitFor();
      await page.locator(".application-guidance").waitFor();
      assert.match(
        await page.locator(".application-guidance").innerText(),
        /draft|submit/i,
      );
      const submitted = page.waitForResponse(
        (r) =>
          r.url().includes("/transition") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Submit application", exact: true })
        .click();
      assert.equal((await submitted).status(), 200);
      await page
        .getByText("Submit application completed.", { exact: true })
        .waitFor();
      assert.match(
        await page.locator(".application-guidance").innerText(),
        /review|office/i,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Approve application", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({
        path: "execution/screenshots/usability-workspace-detail.png",
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    } finally {
      await browser.close();
    }
  },
);

test(
  "workspace usability: mobile page picker, empty search recovery and language retention",
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    try {
      await login(page);
      await page.locator("#workspace-jump").selectOption("applications");
      await page
        .locator("#application-search")
        .fill("no-existing-application-ux-unique");
      await page
        .getByRole("heading", { name: "No matching applications", exact: true })
        .waitFor();
      await page.locator("#state-filter").selectOption("CANCELLED");
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      assert.equal(
        await page.locator("#state-filter").inputValue(),
        "CANCELLED",
      );
      await page
        .getByRole("button", { name: "সব ফিল্টার মুছুন", exact: true })
        .click();
      assert.equal(await page.locator("#application-search").inputValue(), "");
      assert.equal(await page.locator("#state-filter").inputValue(), "");
      await page.locator("tbody tr").first().waitFor();
      await page.locator("#workspace-jump").selectOption("home");
      await page
        .getByRole("heading", { name: "আজ কী করতে চান?", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: "execution/screenshots/usability-workspace-home-bn.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: "execution/screenshots/usability-workspace-home-en.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    } finally {
      await browser.close();
    }
  },
);

test(
  "workspace usability: role-specific tasks route to authorized queues without approving",
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    try {
      for (const [role, label, state] of [
        ["reviewer", "Review submitted applications", "SUBMITTED"],
        ["approver", "Review for approval", "UNDER_REVIEW"],
        ["finance", "View payments and receipts", ""],
      ] as const) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await login(page, role);
        assert.equal(
          await page
            .getByRole("button", { name: /Start an application/ })
            .count(),
          0,
        );
        await page.getByRole("button", { name: new RegExp(label) }).click();
        if (state) {
          await page.locator("#state-filter").waitFor();
          assert.equal(await page.locator("#state-filter").inputValue(), state);
        } else {
          await page.locator(".payments-workspace").waitFor();
          assert.equal(await page.locator("#state-filter").count(), 0);
        }
        await page
          .getByRole("button", { name: "Sign out", exact: true })
          .click();
        await context.close();
      }
    } finally {
      await browser.close();
    }
  },
);
