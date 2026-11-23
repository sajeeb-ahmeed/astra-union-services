import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, type Browser, type APIRequestContext, type Page } from "playwright";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
import catalog from "../src/public-service-catalog.json" with { type: "json" };

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
async function signIn(api: APIRequestContext, email: string, password: string) {
  const r = await api.post(`${origin}/api/v1/auth/login`, { data: { email, password } });
  assert.equal(r.status(), 200, await r.text());
  return (await r.json()).csrfToken as string;
}
async function loginUi(page: Page, email: string, password: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
// Synthetic test-only values: this office and its tariff exist only inside this test run.
const documents = [
  { bn: "জাতীয় পরিচয়পত্রের অনুলিপি", en: "Copy of the national identity card" },
  { bn: "সাম্প্রতিক ছবি", en: "Recent photograph" },
];

test(
  "service content browser: published fee, charter time and documents appear exactly on the public service page, and the editor reloads them",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const stamp = Date.now();
    const slug = `content-browser-${stamp}`;
    const nameEn = `Service Content Browser Office ${stamp}`;
    const adminPassword = randomBytes(12).toString("base64url");
    const owner = await browser.newContext();
    const ownerCsrf = await signIn(owner.request, "owner@astra.demo.test", "Demo-Phase1!");
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": ownerCsrf },
      data: {
        slug,
        nameBn: "সেবা তথ্য পরীক্ষা অফিস",
        nameEn,
        division: "Test Division",
        district: "Test District",
        upazila: "Test Upazila",
        officeType: "UNION",
        adminEmail: `admin@${slug}.test`,
        adminName: "Synthetic service content admin",
        adminPassword,
      },
    });
    assert.equal(created.status(), 201, await created.text());
    await owner.close();
    const adminApi = await browser.newContext();
    const adminCsrf = await signIn(adminApi.request, `admin@${slug}.test`, adminPassword);
    const published = await adminApi.request.post(`${origin}/api/v1/admin/services/45/order-policies`, {
      headers: { "X-CSRF-Token": adminCsrf },
      data: {
        expectedVersion: 0,
        reason: "Synthetic tariff for the service content browser test",
        statutoryFeeMinor: 1500,
        processingFeeMinor: 75,
        emergencySurchargeMinor: 2000,
        deliveryFeesMinor: { office_collection: 0, digital_copy: 1000 },
        deliveryModes: ["office_collection", "digital_copy"],
        urgencies: ["normal", "urgent"],
        charterDays: 7,
        requiredDocuments: documents,
      },
    });
    assert.equal(published.status(), 201, await published.text());
    await adminApi.close();

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => {
      if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en");
    });
    try {
      await page.goto(`${origin}/services?service=45`);
      const detail = page.locator(".service-detail");
      await detail.getByRole("heading", { name: "Permanent resident certificate", exact: true }).waitFor();
      assert.ok(
        (await detail.locator(".eyebrow").innerText()).includes("Identity and citizenship"),
        "the category leads the detail page eyebrow",
      );
      const info = detail.locator(".service-office-info");
      const mine = info.locator(".service-office-entry").filter({ hasText: nameEn });
      await mine.waitFor();
      const mineText = await mine.innerText();
      assert.ok(mineText.includes("Office service fee: ৳15.75"), mineText);
      assert.ok(mineText.includes("Office collection ৳0 · Digital copy ৳10"), mineText);
      assert.ok(mineText.includes("Urgent (extra) ৳20"), mineText);
      assert.ok(mineText.includes("Service time: 7 days"), mineText);
      assert.deepEqual(
        await mine.locator("li").allInnerTexts(),
        ["Copy of the national identity card", "Recent photograph"],
        "the published documents are listed exactly",
      );
      // A seeded office that never published collapses to a one-line muted
      // row (REFINEMENT-02 P1-6) instead of showing invented values.
      const alpha = info.locator(".service-office-unpublished").filter({ hasText: "Alpha Union" });
      await alpha.waitFor();
      const alphaText = await alpha.innerText();
      assert.ok(
        alphaText.includes("Has not yet published its fee, time and documents"),
        alphaText,
      );
      assert.ok(!alphaText.includes("৳"), "no fee is invented for an unpublished office");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);

      // The office admin editor reloads exactly what was published, documents included.
      await loginUi(page, `admin@${slug}.test`, adminPassword);
      await goToWorkspacePage(page, "Office administration");
      await page.getByRole("tab", { name: "Application fee policies", exact: true }).click();
      await page.locator("#order-policy-service").selectOption("45");
      await page.locator("#order-fee-statutory").waitFor();
      assert.equal(await page.locator("#order-policy-charter-days").inputValue(), "7");
      assert.equal(await page.locator("#order-document-bn-0").inputValue(), documents[0].bn);
      assert.equal(await page.locator("#order-document-en-0").inputValue(), documents[0].en);
      assert.equal(await page.locator("#order-document-bn-1").inputValue(), documents[1].bn);
      assert.equal(await page.locator("#order-document-en-1").inputValue(), documents[1].en);
    } finally {
      await browser.close();
    }
  },
);

test(
  "service content browser: category filters narrow the public grid, and the office directory lists offices without a search click",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en");
    });
    try {
      await page.goto(`${origin}/services`);
      const cards = page.locator(".public-service-grid .svc-card");
      await cards.first().waitFor();
      assert.equal(await cards.count(), 47);
      assert.ok((await page.locator('[role="status"]').first().innerText()).includes("47 services found"));
      const identityCount = catalog.filter((s) => s.category_en === "Identity and citizenship").length;
      assert.ok(identityCount > 0 && identityCount < 47);
      await page
        .locator(".service-category-filters")
        .getByRole("button", { name: "Identity and citizenship", exact: true })
        .click();
      assert.equal(await cards.count(), identityCount);
      assert.ok((await page.locator('[role="status"]').first().innerText()).includes(`${identityCount} services found`));
      const names = await cards.locator("strong").allInnerTexts();
      assert.ok(names.includes("Permanent resident certificate"), names.join(", "));
      assert.ok(!names.includes("Holding tax"), "another category's service is filtered out");
      const eyebrows = await cards.locator(".svc-card-category").allInnerTexts();
      // REFINEMENT-02 P1-7 (test-expectation update): the card eyebrow now
      // carries the service number — "Service {no} · {category}" — and
      // renders in uppercase by design.
      assert.deepEqual(
        eyebrows.map((text) => Number(text.match(/^SERVICE (\d+) · IDENTITY AND CITIZENSHIP$/)?.[1])),
        catalog.filter((s) => s.category_en === "Identity and citizenship").map((s) => s.service_no),
        "every visible card eyebrow carries its service number and the selected category label",
      );
      await page
        .locator(".service-category-filters")
        .getByRole("button", { name: "All categories", exact: true })
        .click();
      assert.equal(await cards.count(), 47);

      // F3: the directory renders its list on arrival — no search click needed.
      await page.goto(`${origin}/offices`);
      const officeCards = page.locator(".office-card");
      await officeCards.first().waitFor();
      assert.ok((await officeCards.count()) >= 1, "offices are listed on arrival");
      assert.ok((await page.locator(".office-grid").innerText()).includes("Alpha Union"));
    } finally {
      await browser.close();
    }
  },
);
