import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { fillApplicationForm } from "./fixtures/fill-form.js";
import { chromium, type Browser, type Page } from "playwright";
import { demoPayloads } from "@astra/shared-schemas";

// UIUX-FIX-01: the services page is now a launch catalog — every application (staff or citizen) runs
// through the guided ServiceFlow. These tests drive that flow: catalog tile → citizen step → form step
// → fees step → review step (where drafts are saved). The retired intake-only reference-fields preview
// has no equivalent and its assertions were dropped with the capability.
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
  await page.getByLabel("Email", { exact: true }).fill("staff@alpha.local.test");
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(page: Page, name: string) {
  await goToWorkspacePage(page, name);
}
// FULL-UIUX-01: catalog entries are ServiceCards named by category +
// service name; the internal service number is not the card's lead text.
const serviceNames: Record<string, string> = {
  "42": "Trade license",
  "45": "Permanent resident certificate",
};
function catalogTile(page: Page, serviceNo: string) {
  return page.locator("button.svc-card", {
    hasText: serviceNames[serviceNo],
  });
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
async function completeFees(page: Page) {
  const next = page.getByRole("button", {
    name: "Next: review and submit",
    exact: true,
  });
  const draftButton = page.getByRole("button", {
    name: "Save as draft only",
    exact: true,
  });
  const language = page.locator("#order-language");
  // The fees step settles asynchronously: the office's fee settings load
  // first, then the step either shows the order panel (language select) or —
  // when the office has no fee policy for the service (FULL-UIUX-01 FE S8) —
  // is skipped straight to the review step. Wait for either outcome instead
  // of racing the loading state.
  for (let i = 0; i < 80; i++) {
    if (await draftButton.isVisible().catch(() => false)) return;
    if (await language.isVisible().catch(() => false)) break;
    await page.waitForTimeout(250);
  }
  if (await draftButton.isVisible().catch(() => false)) return;
  try {
    await page.waitForFunction(
      () =>
        !(
          document.querySelector(
            ".ax-flow-actions button:last-child",
          ) as HTMLButtonElement
        )?.disabled,
      undefined,
      { timeout: 8000 },
    );
    await next.click();
    return;
  } catch {}
  if (await language.count()) {
    if (!(await language.inputValue())) await language.selectOption("bn");
  }
  const review = page.getByRole("button", { name: "Review fees" });
  if (await review.count()) await review.click();
  const accept = page.locator(".ax-flow input[type=checkbox]").last();
  await accept.waitFor();
  await accept.check();
  await page.waitForFunction(
    () =>
      !(
        document.querySelector(
          ".ax-flow-actions button:last-child",
        ) as HTMLButtonElement
      )?.disabled,
  );
  await next.click();
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
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await login(page);
      await nav(page, "Service catalog");
      // The catalog itself carries no form and no draft button: choosing a service launches the flow.
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
      await catalogTile(page, "45").click();
      // Citizen step comes first; the first listed citizen is pre-listed and selectable.
      const firstCitizen = page.locator(".ax-citizen input").first();
      await firstCitizen.waitFor();
      await firstCitizen.check();
      const chosenCitizenLabel = await page
        .locator("label.ax-citizen")
        .first()
        .innerText();
      await page
        .getByRole("button", { name: "Next: application form", exact: true })
        .click();
      await assertBlank(page);
      await page
        .getByLabel("Purpose (English)", { exact: false })
        .fill("Unsaved applicant entered purpose");
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      assert.equal(
        await page.locator("[id$='purpose_en']").inputValue(),
        "Unsaved applicant entered purpose",
      );
      assert.match(await page.locator(".ax-eyebrow").innerText(), /৪৫/);
      // The chosen citizen survives the language switch: going back shows the same citizen checked.
      await page.getByRole("button", { name: "← নাগরিক", exact: true }).click();
      assert.equal(await page.locator(".ax-citizen input:checked").count(), 1);
      // The label localises the citizen's name with the UI language; the reference is stable.
      // Citizens may carry a legacy REF-… reference, a Phase 5 reference
      // (dddddd-dddddd-dddddd) or the CERTNO-01 16-digit format.
      const refOf = (text: string) => text.match(/REF-[0-9a-f-]+|\d{6}-\d{6}-\d{6}|\d{16}/)?.[0];
      assert.equal(
        refOf(await page.locator("label.ax-citizen:has(input:checked)").innerText()),
        refOf(chosenCitizenLabel),
      );
      await page.getByRole("button", { name: "English", exact: true }).click();
      // A different service starts a fresh, empty application.
      await page
        .getByRole("button", { name: "Cancel and return to dashboard", exact: true })
        .click();
      await nav(page, "Service catalog");
      await catalogTile(page, "42").click();
      await page.locator(".ax-citizen input").first().check();
      await page
        .getByRole("button", { name: "Next: application form", exact: true })
        .click();
      await assertBlank(page);
      // Registering a new citizen from inside the flow returns to the same service with them chosen.
      await page.getByRole("button", { name: "← Citizen", exact: true }).click();
      await page
        .getByRole("button", { name: "Register a new citizen", exact: true })
        .click();
      const newName = `Intake Browser Citizen ${Date.now()}`;
      await page
        .getByLabel("Name (English)", { exact: true })
        .fill(newName);
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
      // BUNDLE06-R5 E1: the citizen registration form is the P2-7 stepper
      // (Identity → Area & address → Identity details). Advance through
      // the steps with "Continue"; only the last step submits.
      await page
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await page.locator("#citizen-geo-division").waitFor();
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
      await page
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Register citizen", exact: true })
        .waitFor();
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
      // Back in the flow for service 42, at the form step, with the new citizen as applicant.
      await page.locator(".ax-flow").waitFor();
      assert.match(await page.locator(".ax-flow").innerText(), new RegExp(newName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(await page.locator(".ax-flow-title").innerText(), /Trade licen/);
      await assertBlank(page);
      // Sample insertion was removed from the product entirely: the flow
      // offers no "Fill example" shortcut on any hostname.
      assert.equal(
        await page
          .getByRole("button", { name: "Fill example", exact: true })
          .count(),
        0,
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
  "intake browser: hosted hostname has no sample insertion and exact reference opens own application",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
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
      // FULL-UIUX-01: the reference lookup lives inside the collapsed
      // "More filters & reference lookup" details; the detail header shows
      // the application's 16-digit reference (RefChip), not a truncated id.
      assert.ok(application.reference, "created application carries its public reference");
      await page.locator("details.app-more-filters > summary").click();
      await page.locator("#application-reference").fill(application.id);
      await page
        .getByRole("button", { name: "Find record", exact: true })
        .click();
      await page
        .locator(".ax-refchip")
        .filter({ hasText: application.reference })
        .first()
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
        await hosted.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
        await hostedPage.goto("http://astra-intake.test/");
        await hostedPage
          .getByRole("button", { name: "Sign out", exact: true })
          .waitFor();
        await nav(hostedPage, "Service catalog");
        await catalogTile(hostedPage, "45").click();
        await hostedPage.locator(".ax-citizen input").first().waitFor();
        await hostedPage.locator(".ax-citizen input").first().check();
        await hostedPage
          .getByRole("button", { name: "Next: application form", exact: true })
          .click();
        await assertBlank(hostedPage);
        assert.equal(
          await hostedPage
            .getByRole("button", {
              name: "Fill example",
              exact: true,
            })
            .count(),
          0,
        );
        // Draft saving lives on the flow's review step on every hostname.
        await fillApplicationForm(hostedPage, demoPayloads[45]);
        await hostedPage
          .getByRole("button", { name: "Next: fees and delivery", exact: true })
          .click();
        await completeFees(hostedPage);
        assert.ok(
          await hostedPage
            .getByRole("button", {
              name: "Save as draft only",
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
