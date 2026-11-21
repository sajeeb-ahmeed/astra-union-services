import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, type Browser, type APIRequestContext } from "playwright";
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

test(
  "price list browser: a public office page shows published fees, urgent surcharge, delivery and charter time at phone width",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    // A separate office keeps the shared demo offices' fee policies untouched.
    const stamp = Date.now();
    const slug = `price-browser-${stamp}`;
    const nameEn = `Price List Browser Office ${stamp}`;
    const adminPassword = randomBytes(12).toString("base64url");
    const owner = await browser.newContext();
    const ownerCsrf = await signIn(owner.request, "owner@astra.demo.test", "Demo-Phase1!");
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": ownerCsrf },
      data: {
        slug,
        nameBn: "মূল্য তালিকা পরীক্ষা অফিস",
        nameEn,
        division: "Test Division",
        district: "Test District",
        upazila: "Test Upazila",
        officeType: "UNION",
        adminEmail: `admin@${slug}.test`,
        adminName: "Synthetic price list admin",
        adminPassword,
      },
    });
    assert.equal(created.status(), 201, await created.text());
    await owner.close();
    const admin = await browser.newContext();
    const adminCsrf = await signIn(admin.request, `admin@${slug}.test`, adminPassword);
    const published = await admin.request.post(`${origin}/api/v1/admin/services/45/order-policies`, {
      headers: { "X-CSRF-Token": adminCsrf },
      data: {
        expectedVersion: 0,
        reason: "Synthetic tariff for the price list browser test",
        statutoryFeeMinor: 1500,
        processingFeeMinor: 75,
        emergencySurchargeMinor: 2000,
        deliveryFeesMinor: { office_collection: 0, digital_copy: 1000 },
        deliveryModes: ["office_collection", "digital_copy"],
        urgencies: ["normal", "urgent"],
        charterDays: 7,
      },
    });
    assert.equal(published.status(), 201, await published.text());
    await admin.close();

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await page.goto(`${origin}/offices`);
      await page.getByLabel("Office name", { exact: true }).fill(nameEn);
      await page.getByRole("button", { name: "Search offices", exact: true }).click();
      await page.getByRole("button", { name: "View office", exact: true }).first().click();
      const details = page.getByRole("region", { name: "Office details" });
      await details.waitFor();
      const list = details.locator(".price-list");
      await list.getByRole("heading", { name: "Service price list", exact: true }).waitFor();
      const rows = list.locator("tbody tr");
      assert.equal(await rows.count(), await details.locator(".service-chips > a").count());
      const priced = rows.filter({ hasText: "৳15.75" });
      assert.equal(await priced.count(), 1, "service 45 shows statutory + processing = ৳15.75");
      const cells = await priced.locator("td").allInnerTexts();
      assert.deepEqual(cells, ["৳15.75", "৳20", "Office collection ৳0 · Digital copy ৳10", "7 days"]);
      assert.equal(await rows.filter({ hasText: "Fee not yet published by the office" }).count(), (await rows.count()) - 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    } finally {
      await browser.close();
    }
  },
);
