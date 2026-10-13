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
          .filter((n) => /^chromium-/.test(n))
          .sort()
          .reverse()
          .map((n) => path.join(local, n, "chrome-win64", "chrome.exe"))
          .find((p) => fs.existsSync(p))
      : undefined);
  return chromium.launch({ headless: true, executablePath: executable });
}
async function login(page: Page, email: string, password = "Demo-Phase1!") {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(page: Page, name: RegExp) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name })
    .click();
}
async function request(
  page: Page,
  route: string,
  method = "GET",
  data?: unknown,
) {
  return page.evaluate(
    async ({ route, method, data }) => {
      const session = await (await fetch("/api/v1/auth/me")).json();
      const response = await fetch(`/api/v1${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: response.status, data: await response.json() };
    },
    { route, method, data },
  );
}
test(
  "expanded browser: public 47-service discovery, retained directory pagination, help, feedback and newsletter persistence",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance(),
      context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(origin);
      await page
        .getByRole("heading", { name: /ঘরে বসেই নাগরিক সেবা/ })
        .waitFor();
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({
        path: "execution/screenshots/expanded-home-desktop.png",
        fullPage: true,
      });
      await page
        .getByRole("navigation", { name: "Public navigation" })
        .getByRole("button", { name: /নাগরিক সেবা/ })
        .click();
      assert.equal(await page.locator(".public-service").count(), 47);
      await page
        .getByLabel("সেবা খুঁজুন / Search public services", { exact: true })
        .fill("Family certificate");
      assert.equal(await page.locator(".public-service").count(), 1);
      await page.locator(".public-service").click();
      await page.getByRole("region", { name: "Service information" }).waitFor();
      await page
        .getByRole("navigation", { name: "Public navigation" })
        .getByRole("button", { name: /সহায়িকা/ })
        .click();
      await page
        .getByText("কীভাবে আবেদন করব? / How do I apply?", { exact: true })
        .click();
      await page
        .getByLabel("Your name", { exact: true })
        .fill("Synthetic Browser Visitor");
      await page
        .getByLabel("Subject", { exact: true })
        .fill("Browser help journey");
      await page
        .getByLabel("Message", { exact: true })
        .fill("Synthetic feedback submitted by the browser acceptance test.");
      const feedback = page.waitForResponse(
        (r) =>
          r.url().endsWith("/public/feedback") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Submit feedback", exact: true })
        .click();
      assert.equal((await feedback).status(), 201);
      await page
        .getByText("Feedback saved to the support inbox.", { exact: true })
        .waitFor();
      await page.goto(origin);
      await page
        .getByLabel("সেবার আপডেটের জন্য নিবন্ধন / Update preferences")
        .fill(`browser-${Date.now()}@example.test`);
      const subscription = page.waitForResponse(
        (r) =>
          r.url().endsWith("/public/subscribe") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save subscription", exact: true })
        .click();
      assert.equal((await subscription).status(), 202);
      await page
        .getByText(
          "Subscription preference saved locally. Email delivery is not connected.",
          { exact: true },
        )
        .waitFor();
      const ownerContext = await browser.newContext(),
        owner = await ownerContext.newPage();
      await login(owner, "owner@astra.demo.test");
      const marker = `Directory${Date.now()}`;
      for (let i = 0; i < 3; i++) {
        const result = await request(owner, "/owner/tenants", "POST", {
          slug: `directory-${Date.now()}-${i}`,
          nameBn: `নমুনা অফিস ${i}`,
          nameEn: `${marker} ${i}`,
          division: "Demo Division",
          district: "Demo District",
          upazila: "Demo Upazila",
          officeType: "UNION",
          adminEmail: `${marker.toLowerCase()}-${i}@example.test`,
          adminName: "Synthetic Directory Administrator",
          adminPassword: "Demo-Browser-2026!",
        });
        assert.equal(result.status, 201, JSON.stringify(result.data));
      }
      await ownerContext.close();
      await page.goto(`${origin}/offices`);
      await page.getByLabel("Office name", { exact: true }).fill(marker);
      await page.getByLabel("Division", { exact: true }).fill("Demo Division");
      await page
        .getByLabel("Offices per page", { exact: true })
        .selectOption("2");
      await page
        .getByRole("button", { name: "Search offices", exact: true })
        .click();
      await page
        .getByText("3 matching offices · Page 1", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".office-card").count(), 2);
      await page
        .getByRole("button", { name: "Next offices", exact: true })
        .click();
      await page
        .getByText("3 matching offices · Page 2", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".office-card").count(), 1);
      assert.equal(
        new URL(page.url()).searchParams.get("division"),
        "Demo Division",
      );
      assert.equal(new URL(page.url()).searchParams.get("q"), marker);
      await page.reload();
      await page
        .getByText("3 matching offices · Page 2", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("Office name", { exact: true }).inputValue(),
        marker,
      );
      await page
        .getByRole("button", { name: "View office", exact: true })
        .click();
      await page.getByRole("region", { name: "Office details" }).waitFor();
      assert.equal(await page.locator(".service-chips span").count(), 47);
      await page.screenshot({
        path: "execution/screenshots/expanded-directory.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(origin);
      await page
        .getByRole("heading", { name: /ঘরে বসেই নাগরিক সেবা/ })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: "execution/screenshots/expanded-home-mobile.png",
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
    }
  },
);

test(
  "expanded browser: owner onboarding, staff/service administration, explicit authorization and public notice controls",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance(),
      context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      }),
      page = await context.newPage(),
      unique = Date.now();
    const adminEmail = `ui-admin-${unique}@example.test`,
      approverEmail = `ui-approver-${unique}@example.test`,
      password = "Demo-Browser-2026!";
    try {
      await login(page, "owner@astra.demo.test");
      await nav(page, /Platform management/);
      for (const [label, value] of Object.entries({
        "Unique office slug": `browser-office-${unique}`,
        "Office name (Bangla)": "নমুনা ব্রাউজার পরিষদ",
        "Office name (English)": `Browser Office ${unique}`,
        Division: "Demo Division",
        District: "Demo District",
        Upazila: "Demo Upazila",
        "Administrator email": adminEmail,
        "Administrator display name": "Browser Administrator",
        "Administrator initial password": password,
      }))
        await page.getByLabel(label, { exact: true }).fill(value);
      await page
        .getByRole("button", { name: "Create demo office", exact: true })
        .click();
      await page
        .getByText("Office and initial administrator created.", { exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await login(page, adminEmail, password);
      await nav(page, /Office administration/);
      await page.getByLabel("Staff email", { exact: true }).fill(approverEmail);
      await page
        .getByLabel("Staff display name", { exact: true })
        .fill("Browser Approver");
      await page.getByLabel("Initial password", { exact: true }).fill(password);
      await page
        .getByLabel("Staff role", { exact: true })
        .selectOption("approver");
      await page
        .getByRole("button", { name: "Create staff account", exact: true })
        .click();
      await page.getByText("Staff account created.", { exact: true }).waitFor();
      const member = page.getByRole("row").filter({ hasText: approverEmail });
      const recoveryResponse = page.waitForResponse(
        (r) => r.url().endsWith("/recovery") && r.request().method() === "POST",
      );
      await member
        .getByRole("button", { name: "Generate recovery link", exact: true })
        .click();
      const recoveryResult = await recoveryResponse;
      assert.equal(recoveryResult.status(), 201, await recoveryResult.text());
      const recovery = await recoveryResult.json();
      const recoveryContext = await browser.newContext(),
        recoveryPage = await recoveryContext.newPage();
      await recoveryPage.goto(recovery.recoveryUrl);
      await recoveryPage
        .getByLabel("New password", { exact: true })
        .fill("Recovered-Browser-2026!");
      await recoveryPage
        .getByLabel("Confirm new password", { exact: true })
        .fill("Recovered-Browser-2026!");
      await recoveryPage
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
      await recoveryPage.getByText(/Password reset completed/).waitFor();
      await login(recoveryPage, approverEmail, "Recovered-Browser-2026!");
      await recoveryContext.close();
      await page
        .getByRole("button", { name: "Dismiss recovery link", exact: true })
        .click();
      await member
        .getByRole("button", { name: "Suspend", exact: true })
        .click();
      await page
        .getByText("Account access updated.", { exact: true })
        .waitFor();
      await member
        .getByRole("button", { name: "Activate", exact: true })
        .click();
      await member.getByText("Active", { exact: true }).waitFor();
      await page
        .getByRole("tab", { name: "Office profile", exact: true })
        .click();
      await page
        .getByLabel("Upazila", { exact: true })
        .fill("Updated Demo Upazila");
      await page
        .getByRole("button", { name: "Save office profile", exact: true })
        .click();
      await page.getByText("Office profile saved.", { exact: true }).waitFor();
      await page
        .getByRole("tab", { name: "Service settings", exact: true })
        .click();
      const service = page.getByRole("row").filter({
        has: page.getByLabel("Credit cost for service 47", { exact: true }),
      });
      await service
        .getByLabel("Credit cost for service 47", { exact: true })
        .fill("2");
      await service
        .getByRole("button", { name: "Save credits", exact: true })
        .click();
      await page
        .getByText("Service credit cost saved.", { exact: true })
        .waitFor();
      await service
        .getByRole("button", { name: "Disable service", exact: true })
        .click();
      await page
        .getByText("Service availability saved.", { exact: true })
        .waitFor();
      await service
        .getByRole("button", { name: "Enable service", exact: true })
        .click();
      await service
        .getByRole("button", { name: "Disable service", exact: true })
        .waitFor();
      await page
        .getByRole("tab", { name: "Approval authority", exact: true })
        .click();
      await page
        .getByLabel("Approver", { exact: true })
        .selectOption({ label: approverEmail });
      await page
        .getByLabel("Authorized service", { exact: true })
        .selectOption("47");
      await page
        .getByLabel("Authority note", { exact: true })
        .fill("Synthetic browser authorization for service 47");
      await page
        .getByRole("button", { name: "Save authorization", exact: true })
        .click();
      await page
        .getByText("Approval authorization recorded.", { exact: true })
        .waitFor();
      await page
        .getByRole("tab", { name: "Office notices", exact: true })
        .click();
      await page
        .getByLabel("Notice title (Bangla)", { exact: true })
        .fill("নমুনা সেবা বিজ্ঞপ্তি");
      await page
        .getByLabel("Notice title (English)", { exact: true })
        .fill(`Browser published notice ${unique}`);
      await page
        .getByLabel("Notice body (Bangla)", { exact: true })
        .fill("এটি সফটওয়্যার পরীক্ষার নমুনা বিজ্ঞপ্তি।");
      await page
        .getByLabel("Notice body (English)", { exact: true })
        .fill("A synthetic notice saved by the browser acceptance test.");
      await page
        .getByLabel("Publication", { exact: true })
        .selectOption("true");
      await page
        .getByRole("button", { name: "Save notice", exact: true })
        .click();
      await page.getByText("Office notice saved.", { exact: true }).waitFor();
      const anonymous = await browser.newContext(),
        publicPage = await anonymous.newPage();
      await publicPage.goto(`${origin}/notices`);
      await publicPage
        .getByRole("heading", {
          name: `Browser published notice ${unique}`,
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: "execution/screenshots/expanded-admin-notices.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Unpublish notice", exact: true })
        .click();
      await page
        .getByText("Notice publication updated.", { exact: true })
        .waitFor();
      await publicPage.reload();
      await publicPage
        .getByRole("heading", { name: "প্রকাশিত বিজ্ঞপ্তি", exact: true })
        .waitFor();
      assert.equal(
        await publicPage
          .getByRole("heading", {
            name: `Browser published notice ${unique}`,
            exact: true,
          })
          .count(),
        0,
      );
      const noticeMarker = `NoticePagination${unique}`;
      for (let n = 0; n < 7; n++) {
        const saved = await request(page, "/admin/notices", "POST", {
          titleBn: `নমুনা বিজ্ঞপ্তি ${n}`,
          titleEn: `${noticeMarker} ${n}`,
          bodyBn: "ব্রাউজার পরীক্ষার নমুনা বিজ্ঞপ্তি",
          bodyEn: "Synthetic browser pagination evidence",
          published: true,
        });
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
      }
      await publicPage
        .getByLabel("Search notices", { exact: true })
        .fill(noticeMarker);
      await publicPage
        .getByRole("button", { name: "Find notices", exact: true })
        .click();
      await publicPage
        .getByText("7 published notices · Page 1", { exact: true })
        .waitFor();
      assert.equal(await publicPage.locator("article.panel").count(), 6);
      await publicPage
        .getByRole("button", { name: "Next notices", exact: true })
        .click();
      await publicPage
        .getByText("7 published notices · Page 2", { exact: true })
        .waitFor();
      assert.equal(await publicPage.locator("article.panel").count(), 1);
      assert.equal(
        new URL(publicPage.url()).searchParams.get("q"),
        noticeMarker,
      );
      await publicPage.reload();
      await publicPage
        .getByText("7 published notices · Page 2", { exact: true })
        .waitFor();
      await publicPage
        .getByText(`Browser Office ${unique}`, { exact: true })
        .waitFor();
      await anonymous.close();
    } finally {
      await context.close();
      await browser.close();
    }
  },
);

test(
  "expanded browser: synthetic self-registration, new catalog application and secure password change",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance(),
      context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      page = await context.newPage(),
      unique = Date.now(),
      email = `signup-${unique}@example.test`,
      password = "Demo-Browser-2026!";
    try {
      await page.goto(`${origin}/register`);
      await page
        .getByLabel("Select office", { exact: true })
        .selectOption({ label: "Demo Alpha Union" });
      for (const [label, value] of Object.entries({
        "Email address": email,
        "Choose password": password,
        "Display name": "Browser Citizen",
        "Synthetic name (Bangla)": "নমুনা নাগরিক",
        "Synthetic name (English)": "Browser Citizen",
        "Date of birth": "1990-01-01",
        "Synthetic address (Bangla)": "নমুনা গ্রাম",
        "Synthetic address (English)": "Synthetic Village",
        "Unique demo reference": `DEMO-BROWSER-${unique}`,
      }))
        await page.getByLabel(label, { exact: true }).fill(value);
      await page
        .getByRole("button", { name: "Create synthetic account", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Account created", exact: true })
        .waitFor();
      await login(page, email, password);
      await nav(page, /Service catalog|সেবার তালিকা/);
      await page.getByRole("button", { name: /^01.*/ }).click();
      await page
        .getByLabel("Citizen / নাগরিক", { exact: true })
        .selectOption({ index: 1 });
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save draft application", exact: true })
        .click();
      const response = await saved;
      assert.equal(response.status(), 201, await response.text());
      const application = await response.json();
      assert.equal(application.serviceNo, 1);
      await page
        .getByText("Draft saved to PostgreSQL.", { exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await nav(page, /Account security|অ্যাকাউন্ট নিরাপত্তা/);
      await page.getByLabel("Current password", { exact: true }).fill(password);
      await page
        .getByLabel("New password", { exact: true })
        .fill("Changed-Browser-2026!");
      await page
        .getByRole("button", { name: "Update password", exact: true })
        .click();
      await page
        .getByText("Password updated. Other sessions have been expired.", {
          exact: true,
        })
        .waitFor();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await login(page, email, "Changed-Browser-2026!");
      await page.screenshot({
        path: "execution/screenshots/expanded-citizen-mobile.png",
        fullPage: true,
      });
    } finally {
      await context.close();
      await browser.close();
    }
  },
);

test(
  "expanded browser: trade renewal links a real issued source without charging, and public application tracking remains minimal",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance(),
      staffContext = await browser.newContext(),
      reviewContext = await browser.newContext(),
      approveContext = await browser.newContext(),
      publicContext = await browser.newContext();
    const staff = await staffContext.newPage(),
      reviewer = await reviewContext.newPage(),
      approver = await approveContext.newPage(),
      publicPage = await publicContext.newPage();
    try {
      await login(staff, "staff@alpha.demo.test");
      const citizenList = await request(staff, "/citizens");
      const citizens = Array.isArray(citizenList.data)
        ? citizenList.data
        : citizenList.data.items;
      const created = await request(staff, "/applications", "POST", {
        citizenId: citizens[0].id,
        serviceNo: 42,
        payload: demoPayloads[42],
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const source = created.data;
      assert.equal(
        (
          await request(
            staff,
            `/applications/${source.id}/transition`,
            "POST",
            { action: "submit" },
          )
        ).status,
        200,
      );
      await login(reviewer, "reviewer@alpha.demo.test");
      assert.equal(
        (
          await request(
            reviewer,
            `/applications/${source.id}/transition`,
            "POST",
            { action: "review" },
          )
        ).status,
        200,
      );
      await login(approver, "approver@alpha.demo.test");
      assert.equal(
        (
          await request(
            approver,
            `/applications/${source.id}/transition`,
            "POST",
            { action: "approve" },
          )
        ).status,
        200,
      );
      const issued = await request(
        approver,
        `/applications/${source.id}/issue`,
        "POST",
        {},
      );
      assert.equal(issued.status, 201, JSON.stringify(issued.data));
      const before = await request(approver, "/wallet");
      await nav(staff, /Applications/);
      await staff
        .getByLabel("Search applications", { exact: true })
        .fill(source.id);
      const row = staff
        .getByRole("row")
        .filter({ hasText: source.id.slice(0, 8) });
      await row
        .getByRole("button", { name: "Open application", exact: true })
        .click();
      await staff
        .getByRole("button", {
          name: "Start trade license renewal",
          exact: true,
        })
        .waitFor();
      const renewalResponse = staff.waitForResponse(
        (r) => r.url().endsWith("/renew") && r.request().method() === "POST",
      );
      await staff
        .getByRole("button", {
          name: "Start trade license renewal",
          exact: true,
        })
        .click();
      const response = await renewalResponse;
      assert.equal(response.status(), 201, await response.text());
      const renewal = await response.json();
      await staff
        .getByText("Renewal draft created with linked source certificate.", {
          exact: true,
        })
        .waitFor();
      assert.notEqual(renewal.id, source.id);
      await staff.getByText(/Renewal lineage:/).waitFor();
      assert.equal(
        (await request(approver, "/wallet")).data.balance,
        before.data.balance,
      );
      assert.equal(
        (
          await publicContext.request.get(
            `${origin}/api/v1/track/${renewal.id}`,
          )
        ).status(),
        404,
        "Drafts stay private before submission",
      );
      const submittedResponse=staff.waitForResponse(r=>r.url().endsWith(`/applications/${renewal.id}/transition`)&&r.request().method()==="POST");
      await staff
        .getByRole("button", { name: "Submit application", exact: true })
        .click();
      const submitted=await submittedResponse;assert.equal(submitted.status(),200,await submitted.text());
      await staff
        .getByText("Submit application completed.", { exact: true })
        .waitFor();
      await publicPage.goto(`${origin}/tracking`);
      await publicPage
        .getByLabel("Application reference", { exact: true })
        .fill(renewal.id);
      await publicPage
        .getByRole("button", { name: "Track application", exact: true })
        .click();
      await publicPage.getByText("SUBMITTED", { exact: true }).waitFor();
      assert.equal(
        await publicPage.getByText(citizens[0].nameEn, { exact: true }).count(),
        0,
      );
      const publicResult = await publicContext.request.get(
          `${origin}/api/v1/track/${renewal.id}`,
        ),
        result = await publicResult.json();
      assert.equal(result.status, "SUBMITTED");
      assert.equal("citizenId" in result, false);
      assert.equal("nameEn" in result, false);
      await publicPage.screenshot({
        path: "execution/screenshots/expanded-application-tracking.png",
        fullPage: true,
      });
      await staff.screenshot({
        path: "execution/screenshots/expanded-trade-renewal.png",
        fullPage: true,
      });
    } finally {
      await Promise.all([
        staffContext.close(),
        reviewContext.close(),
        approveContext.close(),
        publicContext.close(),
      ]);
      await browser.close();
    }
  },
);
