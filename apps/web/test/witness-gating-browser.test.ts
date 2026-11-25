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

/**
 * F-013 (verify-only; the L-004 fix landed in Stage 2): the witness
 * generator offers nothing until the owner enters its certificate types,
 * so its entry points (home help card, drawer, footer) must hide once
 * the options list is CONFIRMED empty — and reappear when a type is
 * configured. Fail-open while the fetch is in flight is by design and
 * is not asserted here.
 */
test(
  "F-013: witness entry points hide when no witness type is configured and return when one is",
  { timeout: 180000 },
  async () => {
    const browser = await browserInstance();
    const stamp = Date.now();
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
    });
    assert.equal(login.status(), 200, await login.text());
    const csrf = (await login.json()).csrfToken;
    const headers = { "X-CSRF-Token": csrf };
    // Snapshot the pre-existing active types so they can be restored.
    const list = await owner.request.get(`${origin}/api/v1/owner/witness-types`, { headers });
    const before = (await list.json()).items ?? [];
    const activeBefore: string[] = before.filter((t: any) => t.active).map((t: any) => t.id);
    const setActive = async (id: string, active: boolean) =>
      owner.request.patch(`${origin}/api/v1/owner/witness-types/${id}`, { headers, data: { active } });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      // Start from a confirmed-empty options list.
      for (const id of activeBefore) assert.equal((await setActive(id, false)).status(), 200);
      const options = await owner.request.get(`${origin}/api/v1/public/witness/options`);
      assert.deepEqual((await options.json()).items ?? [], [], "options list must be empty for this test");
      await page.goto(`${origin}/`);
      await page.locator(".hx-hero").waitFor({ timeout: 30000 });
      // The availability fetch must have resolved to "empty" before the
      // absence is meaningful — poll until the home help card settles.
      await page.waitForFunction(
        () => (document.querySelectorAll('a[href="/witness"]').length === 0 ? true : null),
        { timeout: 15000 },
      );
      assert.equal(await page.locator('a[href="/witness"]').count(), 0, "no witness entry point while the options list is empty");

      // Configure one type: the entry points return.
      const added = await owner.request.post(`${origin}/api/v1/owner/witness-types`, {
        headers,
        data: { religionBn: "পরীক্ষা ধর্ম", religionEn: `F-013 religion ${stamp}`, nameBn: "পরীক্ষা ধরন", nameEn: "F-013 type" },
      });
      assert.equal(added.status(), 201, await added.text());
      const typeId = (await added.json()).id;
      await page.reload();
      await page.locator(".hx-hero").waitFor({ timeout: 30000 });
      await page.locator('a[href="/witness"]').first().waitFor({ timeout: 15000 });
      assert.ok((await page.locator('a[href="/witness"]').count()) > 0, "witness entry points return once a type is configured");
      // Deactivate again: hidden once more.
      assert.equal((await setActive(typeId, false)).status(), 200);
      await page.reload();
      await page.locator(".hx-hero").waitFor({ timeout: 30000 });
      await page.waitForFunction(
        () => (document.querySelectorAll('a[href="/witness"]').length === 0 ? true : null),
        { timeout: 15000 },
      );
      assert.equal(await page.locator('a[href="/witness"]').count(), 0, "witness entry points hide again after deactivation");
    } finally {
      for (const id of activeBefore) await setActive(id, true);
      await owner.close();
      await browser.close();
    }
  },
);
