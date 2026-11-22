import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { chromium, type Browser, type Page } from "playwright";
import { demoPayloads } from "@astra/shared-schemas";
import { signOut } from "./fixtures/session.js";
import { fillApplicationForm } from "./fixtures/fill-form.js";
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
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(page: Page, name: RegExp) {
  await goToWorkspacePage(page, name);
}
// UIUX-FIX-01: applications run through the guided flow; drafts are saved from its review step.
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
async function request(
  page: Page,
  route: string,
  method = "GET",
  data?: unknown,
) {
  const session = await (await page.request.get(`${origin}/api/v1/auth/me`)).json();
  const response = await page.request.fetch(`${origin}/api/v1${route}`, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), data: await response.json() };
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
      await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(origin);
      // FULL-UIUX-01: "/" is the redesigned public home (hero + popular
      // services subset); the full 47-service catalogue lives on /services.
      await page
        .getByRole("heading", { name: "Your union's certificates, now online" })
        .waitFor();
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({
        path: "execution/screenshots/expanded-home-desktop.png",
        fullPage: true,
      });
      // HOME-REDESIGN-02: the home directory renders services as
      // .hsd-tile links (HomeServiceDirectory) — the first 18 at rest,
      // the rest behind its "Show all" button; .svc-card grids live
      // only on /services (asserted just below).
      await page.locator(".hsd-tile").first().waitFor();
      const homeTiles = await page.locator(".hsd-tile").count();
      assert.equal(homeTiles, 18, `home directory should show the first 18 services at rest, saw ${homeTiles}`);
      await page
        .getByRole("navigation", { name: "Public navigation" })
        .getByRole("link", { name: "Services", exact: true })
        .click();
      await page.waitForURL(/\/services$/);
      // Public grids render ServiceCards as links (href variant); the
      // workspace catalogue renders the same component as buttons.
      await page.locator(".svc-card").first().waitFor();
      assert.equal(await page.locator(".svc-card").count(), 47);
      await page
        .getByLabel("Search public services", { exact: true })
        .fill("Family certificate");
      assert.equal(await page.locator(".svc-card").count(), 1);
      await page.locator(".svc-card").click();
      await page
        .locator(".service-detail h1", { hasText: "Family certificate" })
        .waitFor();
      await page
        .getByRole("navigation", { name: "Public navigation" })
        .getByRole("button", { name: "Help & FAQ", exact: true })
        .click();
      await page
        .getByText("How do I apply?", { exact: true })
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
        .getByLabel("Update preferences", { exact: true })
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
      await ownerContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
        await ownerContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await login(owner, "owner@astra.demo.test");
      const marker = `Directory${Date.now()}`;
      for (let i = 0; i < 3; i++) {
        const result = await request(owner, "/owner/tenants", "POST", {
          slug: `directory-${Date.now()}-${i}`,
          nameBn: `নমুনা অফিস ${i}`,
          nameEn: `${marker} ${i}`,
          geography: { divisionCode: "div-02", districtCode: "dis-19", upazilaCode: "upa-089", unionCode: "uni-0001" },
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
      await page.locator('#directory-geo-division option[value="div-02"]').waitFor({ state: "attached" });
      await page.locator("#directory-geo-division").selectOption("div-02");
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
        new URL(page.url()).searchParams.get("divisionCode"),
        "div-02",
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
      assert.equal(await page.locator(".service-chips > a").count(), 47);
      await page.screenshot({
        path: "execution/screenshots/expanded-directory.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(origin);
      await page
        .getByRole("heading", { name: "Your union's certificates, now online" })
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
      await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const adminEmail = `ui-admin-${unique}@example.test`,
      approverEmail = `ui-approver-${unique}@example.test`,
      password = "Demo-Browser-2026!";
    try {
      await login(page, "owner@astra.demo.test");
      // FULL-UIUX-01: the owner lands directly on the owner console.
      await page.locator(".owner-nav").waitFor();
      // OWNER-REDESIGN-01: the onboarding form lives in the Offices section.
      await page.locator('.owner-nav a[href="#owner-offices"]').click();
      for (const [label, value] of Object.entries({
        "Unique office slug": `browser-office-${unique}`,
        "Office name (Bangla)": "নমুনা ব্রাউজার পরিষদ",
        "Office name (English)": `Browser Office ${unique}`,
        "Administrator email": adminEmail,
        "Administrator display name": "Browser Administrator",
        "Administrator initial password": password,
      }))
        await page.getByLabel(label, { exact: true }).fill(value);
      for (const [level, code] of [["division", "div-02"], ["district", "dis-19"], ["upazila", "upa-089"], ["union", "uni-0001"]]) {
        await page.locator(`#owner-geo-${level} option[value="${code}"]`).waitFor({ state: "attached" });
        await page.locator(`#owner-geo-${level}`).selectOption(code);
      }
      await page
        .getByRole("button", { name: "Create office", exact: true })
        .click();
      await page
        .getByText("Office and initial administrator created.", { exact: true })
        .waitFor();
      await signOut(page);
      await login(page, adminEmail, password);
      await nav(page, /Office administration/);
      // FULL-UIUX-01: the admin workspace opens on fee policies; staff
      // accounts live behind their own tab.
      await page
        .getByRole("tab", { name: "Staff accounts", exact: true })
        .click();
      await page.getByLabel("Staff email", { exact: true }).fill(approverEmail);
      await page
        .getByLabel("Staff display name", { exact: true })
        .fill("Browser Approver");
      await page.getByLabel("Initial password", { exact: true }).fill(password);
      await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name: "বাংলা", exact: true }).click();
      await page.locator('select[name="role"]').selectOption("approver");
      const staffCreated = page.waitForResponse(r => r.url().endsWith("/admin/users") && r.request().method() === "POST");
      await page
        .getByRole("button", { name: "কর্মীর অ্যাকাউন্ট তৈরি করুন", exact: true })
        .click();
      const staffResponse = await staffCreated;
      assert.equal(staffResponse.status(), 201);
      assert.equal(staffResponse.request().postDataJSON().role, "approver", "Bengali label must preserve canonical role value");
      await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name: "English", exact: true }).click();
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
      await recoveryContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
        await recoveryContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await recoveryPage.goto(recovery.recoveryUrl);
      await recoveryPage
        .getByLabel("New password", { exact: true })
        .fill("Rec-Browser-2026!");
      await recoveryPage
        .getByLabel("Confirm new password", { exact: true })
        .fill("Rec-Browser-2026!");
      await recoveryPage
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
      await recoveryPage.getByText(/Password reset completed/).waitFor();
      await login(recoveryPage, approverEmail, "Rec-Browser-2026!");
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
      await page.locator('#admin-geo-union option[value="uni-0002"]').waitFor({ state: "attached" });
      await page.locator("#admin-geo-union").selectOption("uni-0002");
      await page
        .getByRole("button", { name: "Save office profile", exact: true })
        .click();
      await page.getByText("Office profile saved.", { exact: true }).waitFor();
      await page
        .getByRole("tab", { name: "Service settings", exact: true })
        .click();
      // Phase 3D: the legacy per-office credit-cost editor was removed from this
      // screen — since 3B the value no longer charges anyone (the owner's Pricing
      // panel sets the price a submit pays), so the row now only carries the
      // availability toggle.
      const service = page.getByRole("row").filter({ hasText: "#47" });
      assert.equal(
        await service
          .getByLabel("Credit cost for service 47", { exact: true })
          .count(),
        0,
        "the legacy credit-cost editor must not be offered to office admins",
      );
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
      await anonymous.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
        await anonymous.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
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
        .getByRole("heading", { name: "Notices", exact: true })
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
      await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      // Phase 3E (§3.6): registration only offers offices that serve the selected
      // union — onboard a mapped office for this test's union first.
      const union = JSON.parse(fs.readFileSync("data/geo/unions.json", "utf8")).find((row: any) => row.upazilaCode === "upa-001");
      const officeName = `Signup Union Office ${unique}`;
      {
        const setup = await browser.newContext();
        const login = await setup.request.post(`${origin}/api/v1/auth/login`, {
          data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
        });
        const created = await setup.request.post(`${origin}/api/v1/owner/tenants`, {
          headers: { "X-CSRF-Token": (await login.json()).csrfToken },
          data: {
            slug: `signup-union-${unique}`,
            nameBn: "নিবন্ধন ইউনিয়ন অফিস",
            nameEn: officeName,
            officeType: "UNION",
            geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: union.code },
            adminEmail: `admin@signup-union-${unique}.test`,
            adminName: "Signup Union Admin",
            adminPassword: "Signup-Union-Ad1!",
          },
        });
        assert.equal(created.status(), 201, await created.text());
        await setup.close();
      }
      // REG-UX Phase 1: one-screen signup. With no configured default office and
      // several listed, the "Change" picker opens by itself; choosing the office
      // closes it and the three-field form remains.
      await page.goto(`${origin}/register`);
      for (const [level, code] of [["division", "div-01"], ["district", "dis-01"], ["upazila", "upa-001"], ["union", union.code]]) {
        await page.locator(`#signup-geo-${level} option[value="${code}"]`).waitFor({ state: "attached" });
        await page.locator(`#signup-geo-${level}`).selectOption(code);
      }
      const officeOption = page.locator("#signup-office option").filter({ hasText: officeName });
      await officeOption.waitFor({ state: "attached" });
      const officeId = await officeOption.getAttribute("value");
      assert.ok(officeId);
      await page.locator("#signup-office").selectOption(officeId);
      await page.locator(".du-signup-office-name").getByText(officeName).waitFor();
      await page.locator("#signup-name").fill("Browser Citizen");
      await page.locator("#signup-mobile").fill(`015${String(unique).slice(-8)}`);
      await page.locator("#signup-password").fill(password);
      await page.locator("#signup-email").fill(email);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page
        .getByRole("heading", { name: "Account created", exact: true })
        .waitFor();
      await login(page, email, password);
      await nav(page, /Service catalog|সেবার তালিকা/);
      await page
        .locator("button.svc-card", { hasText: "Holding tax" })
        .click();
      // The first application asks, inline, for only what signup deferred:
      // the Bangla name, date of birth, permanent address and the ward.
      await page.locator(".du-profile-completion").waitFor();
      assert.equal(await page.locator("#pc-nameEn").count(), 0, "the English name from signup is not asked again");
      await page.locator("#pc-nameBn").fill("নমুনা নাগরিক");
      await page.locator("#pc-dateOfBirth").fill("1990-01-01");
      await page.locator("#pc-addressBn").fill("নমুনা গ্রাম");
      await page.locator("#pc-addressEn").fill("Synthetic Village");
      await page.locator(`#pc-geo-ward option[value="${union.code}-w01"]`).waitFor({ state: "attached" });
      await page.locator("#pc-geo-ward").selectOption(`${union.code}-w01`);
      await page.screenshot({ path: "execution/screenshots/reg-ux-profile-completion-mobile.png", fullPage: true });
      await page.getByRole("button", { name: "Save and continue to the form", exact: true }).click();
      await page.locator(".du-profile-completion").waitFor({ state: "detached" });
      // FULL-UIUX-01 (UX M14): a signed-in citizen applying for themselves
      // skips the citizen step — the flow opens on the application form.
      await fillApplicationForm(page, demoPayloads[1]);
      await page
        .getByRole("button", { name: "Next: fees and delivery", exact: true })
        .click();
      await completeFees(page);
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/applications") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save as draft only", exact: true })
        .click();
      const response = await saved;
      assert.equal(response.status(), 201, await response.text());
      const application = await response.json();
      assert.equal(application.serviceNo, 1);
      await page
        .getByText("The application is saved as a draft; it is not submitted yet.", { exact: true })
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
        .fill("Changed-Browser-1!");
      await page
        .getByRole("button", { name: "Update password", exact: true })
        .click();
      await page
        .getByText("Password updated. Other sessions have been expired.", {
          exact: true,
        })
        .waitFor();
      await signOut(page);
      await login(page, email, "Changed-Browser-1!");
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
      await reviewContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await approveContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await publicContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await staffContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const staff = await staffContext.newPage(),
      reviewer = await reviewContext.newPage(),
      approver = await approveContext.newPage(),
      publicPage = await publicContext.newPage();
    await staffContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await login(staff, "staff@alpha.local.test");
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
      // Phase W: no secretary review — the Chairman approves the submitted
      // application and his approval issues the certificate.
      await login(approver, "approver@alpha.local.test");
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
      assert.equal(issued.status, 200, JSON.stringify(issued.data));
      const before = await request(approver, "/wallet");
      await nav(staff, /Applications/);
      // FULL-UIUX-01: the exact lookup lives in the collapsed filters
      // details and takes the application's 16-digit public reference;
      // submitting it opens the record directly.
      await staff.locator("details.app-more-filters > summary").click();
      await staff.locator("#application-reference").fill(source.reference);
      await staff
        .getByRole("button", { name: "Find record", exact: true })
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
      await staff
        .getByText(/This is a renewal application\. Source certificate number:/)
        .waitFor();
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
        .getByRole("status")
        .filter({ hasText: "Application submitted." })
        .waitFor();
      await publicPage.goto(`${origin}/tracking`);
      await publicPage
        .getByLabel("Application reference", { exact: true })
        .fill(renewal.id);
      await publicPage
        .locator("#public-content")
        .getByRole("button", { name: "Track application", exact: true })
        .click();
      // FULL-UIUX-01 (B16): the public result uses the shared status badge
      // language, never the raw enum.
      await publicPage.getByText("Submitted", { exact: true }).waitFor();
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
