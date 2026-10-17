import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { demoPayloads } from "@astra/shared-schemas";

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
async function login(page: Page) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill("staff@alpha.demo.test");
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function assertBlank(page: Page) {
  const form = page.getByTestId("service-application-form");
  await form.waitFor();
  assert.equal(
    await form
      .locator("input:not([type=checkbox]):not([type=file]), textarea, select")
      .evaluateAll((fields) =>
        fields.every((field) => !(field as HTMLInputElement).value),
      ),
    true,
  );
  assert.equal(await form.locator("input[type=checkbox]:checked").count(), 0);
}

test(
  "intake browser: citizen first, empty application, language retention and new citizen return",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      await login(page);
      await nav(page, "Service catalog");
      assert.equal(
        await page.getByTestId("service-application-form").count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Save draft application", exact: true })
          .count(),
        0,
      );
      await page
        .locator("#applicant option:not([value=''])")
        .first()
        .waitFor({ state: "attached" });
      await page.locator("#applicant").selectOption({ index: 1 });
      const firstCitizen = await page.locator("#applicant").inputValue();
      await assertBlank(page);
      await page
        .getByLabel("Purpose (English)", { exact: false })
        .fill("Unsaved applicant entered purpose");
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      assert.equal(await page.locator("#applicant").inputValue(), firstCitizen);
      assert.equal(
        await page.locator("[id$='purpose_en']").inputValue(),
        "Unsaved applicant entered purpose",
      );
      assert.match(await page.locator(".service.selected").innerText(), /45/);
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page
        .getByRole("button", {
          name: "View observed reference fields",
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "Save draft application", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByTestId("service-application-form")
          .locator("input:enabled, textarea:enabled, select:enabled")
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Use independent demo form", exact: true })
        .click();
      assert.equal(
        await page
          .getByLabel("Purpose (English)", { exact: false })
          .inputValue(),
        "Unsaved applicant entered purpose",
      );
      await page.getByRole("button", { name: /42.*Trade license/ }).click();
      await assertBlank(page);
      await page
        .getByRole("button", { name: "Register a new citizen", exact: true })
        .click();
      await page
        .getByLabel("Name (English)", { exact: true })
        .fill(`Intake Browser Citizen ${Date.now()}`);
      await page
        .getByLabel("Name (Bangla)", { exact: true })
        .fill("ইনটেক পরীক্ষার নমুনা নাগরিক");
      await page
        .getByLabel("Date of birth", { exact: true })
        .fill("1992-03-04");
      await page
        .getByLabel("Address (Bangla)", { exact: true })
        .fill("নমুনা পরীক্ষার গ্রাম");
      await page
        .getByLabel("Address (English)", { exact: true })
        .fill("Synthetic Intake Village");
      const union = JSON.parse(
        fs.readFileSync("data/geo/unions.json", "utf8"),
      ).find((row: any) => row.upazilaCode === "upa-001");
      for (const [level, code] of [
        ["division", "div-01"],
        ["district", "dis-01"],
        ["upazila", "upa-001"],
        ["union", union.code],
        ["ward", `${union.code}-w01`],
      ]) {
        await page
          .locator(`#citizen-geo-${level} option[value="${code}"]`)
          .waitFor({ state: "attached" });
        await page.locator(`#citizen-geo-${level}`).selectOption(code);
      }
      const registered = page.waitForResponse(
        (response) =>
          response.url().endsWith("/citizens") &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Register citizen", exact: true })
        .click();
      const response = await registered;
      assert.equal(response.status(), 201, await response.text());
      const created = await response.json();
      await page
        .getByText(
          "Citizen registered and selected. Complete the application below.",
          { exact: true },
        )
        .waitFor();
      assert.equal(await page.locator("#applicant").inputValue(), created.id);
      assert.match(await page.locator(".service.selected").innerText(), /42/);
      await assertBlank(page);
      assert.ok(
        await page
          .getByRole("button", { name: "Fill synthetic example", exact: true })
          .isVisible(),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
    } finally {
      await context.close();
      await browser.close();
    }
  },
);

test(
  "intake browser: hosted hostname hides sample insertion and exact reference opens own application",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page);
      const session = await (
        await page.request.get(`${origin}/api/v1/auth/me`)
      ).json();
      const citizens = await (
        await page.request.get(`${origin}/api/v1/citizens`)
      ).json();
      const create = await page.request.post(`${origin}/api/v1/applications`, {
        headers: { "X-CSRF-Token": session.csrfToken },
        data: {
          citizenId: citizens.items[0].id,
          serviceNo: 45,
          payload: demoPayloads[45],
        },
      });
      assert.equal(create.status(), 201, await create.text());
      const application = await create.json();
      await nav(page, "Applications");
      await page
        .getByLabel("Find application or certificate", { exact: true })
        .fill(application.id);
      await page
        .getByRole("button", { name: "Find record", exact: true })
        .click();
      await page
        .getByText(`APPLICATION ${application.id.slice(0, 8)}`, { exact: true })
        .waitFor();

      // A browser-only reverse proxy exercises the actual app under a non-loopback hostname.
      // All content/API responses still come from the owned local test stack; no external traffic.
      const hosted = await browser.newContext();
      try {
        const cookies = await context.cookies(origin);
        await hosted.addCookies(
          cookies.map((cookie) => ({ ...cookie, domain: "astra-intake.test" })),
        );
        await hosted.routeWebSocket("**", (socket) => socket.close());
        await hosted.route("http://astra-intake.test/**", async (route) => {
          const requested = new URL(route.request().url());
          const response = await route.fetch({
            url: `${origin}${requested.pathname}${requested.search}`,
            headers: {
              ...route.request().headers(),
              host: new URL(origin).host,
              cookie: cookies
                .map((cookie) => `${cookie.name}=${cookie.value}`)
                .join("; "),
            },
          });
          await route.fulfill({ response });
        });
        const hostedPage = await hosted.newPage();
        await hostedPage.goto("http://astra-intake.test/");
        await hostedPage
          .getByRole("button", { name: "Sign out", exact: true })
          .waitFor();
        await nav(hostedPage, "Service catalog");
        await hostedPage
          .locator("#applicant option:not([value=''])")
          .first()
          .waitFor({ state: "attached" });
        await hostedPage.locator("#applicant").selectOption({ index: 1 });
        await assertBlank(hostedPage);
        assert.equal(
          await hostedPage
            .getByRole("button", {
              name: "Fill synthetic example",
              exact: true,
            })
            .count(),
          0,
        );
        assert.ok(
          await hostedPage
            .getByRole("button", {
              name: "Save draft application",
              exact: true,
            })
            .isVisible(),
        );
      } finally {
        await hosted.close();
      }
    } finally {
      await context.close();
      await browser.close();
    }
  },
);
