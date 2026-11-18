import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
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
async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test(
  "platform notices + coupons browser: banner and offers on the portal, owner creates both from the dashboard",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const stamp = Date.now();
    const noticeTitle = `Portal Notice ${stamp}`;
    const offerCode = `PUB${String(stamp).slice(-8)}`;
    const uiCouponCode = `UI${String(stamp).slice(-8)}`;
    const uiNoticeTitle = `UI Notice ${stamp}`;
    // Arrange through the API: one live global notice and one public coupon.
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
    });
    assert.equal(login.status(), 200, await login.text());
    const csrf = (await login.json()).csrfToken;
    const noticeResponse = await owner.request.post(`${origin}/api/v1/owner/notices`, {
      headers: { "X-CSRF-Token": csrf },
      data: {
        titleBn: "পোর্টাল নোটিশ",
        titleEn: noticeTitle,
        bodyBn: "এটি একটি পরীক্ষামূলক গ্লোবাল নোটিশ।",
        bodyEn: "This is a synthetic global notice.",
        linkUrl: null,
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
        endsAt: null,
        published: true,
        reason: "Browser test notice publication",
      },
    });
    assert.equal(noticeResponse.status(), 201, await noticeResponse.text());
    const notice = (await noticeResponse.json()).notice;
    const couponResponse = await owner.request.post(`${origin}/api/v1/owner/coupons`, {
      headers: { "X-CSRF-Token": csrf },
      data: {
        code: offerCode,
        discountKind: "percent",
        discountValue: 15,
        appliesTo: "both",
        planId: null,
        validFrom: new Date(Date.now() - 3600_000).toISOString(),
        validUntil: null,
        maxUses: null,
        perOfficeLimit: null,
        visibility: "public",
        active: true,
        reason: "Browser test coupon publication",
      },
    });
    assert.equal(couponResponse.status(), 201, await couponResponse.text());

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => {
      if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en");
    });
    try {
      // The portal shows the banner and the public offer.
      await page.goto(`${origin}/`);
      await page.locator(".du-global-notice").getByText(noticeTitle).waitFor();
      await page.locator(".du-public-offer").getByText(offerCode).waitFor();

      // Unpublish through the API: the banner leaves the portal on the next load.
      const unpublish = await owner.request.post(`${origin}/api/v1/owner/notices/${notice.id}/publish`, {
        headers: { "X-CSRF-Token": csrf },
        data: { published: false, reason: "Browser test notice unpublish" },
      });
      assert.equal(unpublish.status(), 200, await unpublish.text());
      await page.goto(`${origin}/`);
      await page.waitForLoadState("networkidle");
      assert.equal(await page.getByText(noticeTitle).count(), 0, "unpublished notice is gone from the portal");

      // The owner creates a coupon and a notice from the dashboard sections.
      await signIn(page, "owner@astra.demo.test", "Demo-Phase1!");
      await goToWorkspacePage(page, "Platform management");
      await page.locator('.owner-nav a[href="#owner-coupons"]').click();
      const coupons = page.locator("#owner-coupons");
      await coupons.getByLabel("Reason for the change (required)", { exact: true }).fill("Browser test coupon creation");
      await coupons.getByRole("button", { name: "New coupon", exact: true }).click();
      await coupons.getByLabel("Code", { exact: true }).fill(uiCouponCode);
      await coupons.getByLabel("Discount (%)", { exact: true }).fill("15");
      await coupons.getByRole("button", { name: "Save coupon", exact: true }).click();
      await coupons.locator("tbody").getByText(uiCouponCode).waitFor();
      await coupons.getByText("Coupon saved.", { exact: true }).waitFor();

      await page.locator('.owner-nav a[href="#owner-notices"]').click();
      const notices = page.locator("#owner-notices");
      await notices.getByLabel("Reason for the change (required)", { exact: true }).fill("Browser test notice creation");
      await notices.getByRole("button", { name: "New notice", exact: true }).click();
      await notices.getByLabel("Title (Bangla)", { exact: true }).fill("ইউআই নোটিশ");
      await notices.getByLabel("Title (English)", { exact: true }).fill(uiNoticeTitle);
      await notices.getByLabel("Body (Bangla)", { exact: true }).fill("ড্যাশবোর্ড থেকে তৈরি নোটিশ।");
      await notices.getByLabel("Body (English)", { exact: true }).fill("A notice created from the dashboard.");
      await notices.getByRole("button", { name: "Save notice", exact: true }).click();
      await notices.locator("tbody").getByText(uiNoticeTitle).waitFor();
      await notices.getByText("Notice saved.", { exact: true }).waitFor();

      // …and the notice created in the dashboard is live on the portal.
      await page.goto(`${origin}/`);
      await page.locator(".du-global-notice").getByText(uiNoticeTitle).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    } finally {
      await owner.close();
      await browser.close();
    }
  },
);
