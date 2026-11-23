import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
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
async function signIn(page: Page, email: string, query = "") {
  await page.goto(`${origin}/login${query}`); // B-3: sign-in lives at /login since P2-1(a) removed the embedded home form
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test(
  "Phase 1 UDC dashboard: staff sidebar in guide order, real counts, service tiles, admin keeps its sidebar",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await signIn(page, "staff@alpha.local.test");
      await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor();
      const sidebar = page.getByRole("navigation", { name: "Workspace navigation" });
      // The list may scroll on short screens, but every item is reachable.
      await sidebar.locator(".ax-sidebar-item").last().scrollIntoViewIfNeeded();
      assert.equal(await sidebar.locator(".ax-sidebar-item").last().isVisible(), true);
      const labels = (await sidebar.locator(".ax-sidebar-item > span").allTextContents()).map((s) => s.trim());
      // FULL-UIUX-01: the nav model carries only built destinations — the
      // former "soon" placeholders (BioData/Holding print + applications,
      // Point recharge) are absent entirely, and User guide is a workspace
      // page button, not an external link.
      assert.deepEqual(labels, [
        "Dashboard", "Profile", "Citizens", "All applications", "Pending applications", "New application",
        "Certificate renewal", "Trade licence renewal", "Print certificate",
        "Payments and receipts", "Notifications", "Account security", "User guide",
      ]);
      assert.equal(await sidebar.locator(".is-soon[aria-disabled='true']").count(), 0);
      assert.equal(await sidebar.locator('[data-page="guide"]').count(), 1);

      // Figures match the API the dashboard reads.
      const counts = await page.evaluate(async () => {
        const c = await (await fetch("/api/v1/applications/counts")).json();
        return {
          pending: (c.awaitingReview ?? 0) + (c.awaitingIssuance ?? 0),
          citizens: (await (await fetch("/api/v1/citizens")).json()).total,
          applications: (await (await fetch("/api/v1/applications?pageSize=1")).json()).total,
        };
      });
      const stats = page.locator(".ax-dashboard .ax-stat strong");
      await page.waitForFunction(() => {
        const els = [...document.querySelectorAll(".ax-dashboard .ax-stat strong")];
        return els.length === 3 && els.every((e) => !e.textContent?.includes("—"));
      });
      const figures = (await stats.allTextContents()).map((s) => s.replace(/[^0-9—]/g, ""));
      // REFINEMENT-02 P1-8 (test-expectation update): the staff stats are
      // pending applications first, then citizens and applications. The
      // credit balance stat renders only for roles that may read it — for
      // staff no balance stat renders at all.
      assert.equal(figures[0], String(counts.pending));
      assert.equal(figures[1], String(counts.citizens));
      assert.equal(figures[2], String(counts.applications));
      assert.equal(await page.locator(".ax-dashboard .ax-stat").count(), 3, "staff sees 3 stats and no balance stat");
      // The services grid opens on a capped shortlist (dashboard redesign);
      // the expand button reveals the full catalog.
      const initialCards = await page.locator(".ax-dashboard .svc-card").count();
      assert.ok(initialCards > 0 && initialCards < 47, "dashboard opens on a capped service shortlist");
      await page.getByRole("button", { name: "See all 47 services", exact: true }).click();
      assert.equal(await page.locator(".ax-dashboard .svc-card").count(), 47);
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({ path: "execution/screenshots/phase1-udc-dashboard-desktop.png", fullPage: true });

      await page.locator(".ax-dashboard-search input").fill("42");
      assert.equal(await page.locator(".ax-dashboard .svc-card").count(), 1);
      // Approved slice (iii): a card opens the guided application flow for that service.
      await page.locator('.ax-dashboard .svc-card[data-service="42"]').click();
      await page.locator(".ax-flow").waitFor();
      assert.match((await page.locator(".ax-flow .ax-eyebrow").textContent()) ?? "", /42/);
      assert.equal(await sidebar.locator('[aria-current="page"]').textContent(), "New application");

      await sidebar.getByRole("button", { name: "Certificate renewal" }).click();
      assert.equal(await sidebar.locator('[aria-current="page"]').textContent(), "Certificate renewal");
      await sidebar.getByRole("button", { name: "Dashboard" }).click();
      await page.locator(".ax-dashboard").waitFor();

      // The staff home keeps its role task list below the dashboard.
      assert.equal(await page.locator(".ax-dashboard ~ *").count() > 0, true);
      // Office admins keep the full legacy sidebar (administration, billing, reports) with the dashboard home.
      const plain = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await plain.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await signIn(plain, "admin@alpha.local.test");
      await plain.locator(".ax-dashboard").waitFor();
      assert.equal(await plain.locator(".ax-sidebar-nav").count(), 0);
      assert.equal(
        await plain.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "Office administration" }).count(),
        1,
      );
      // A citizen's workspace is unchanged.
      const citizen = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await citizen.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await signIn(citizen, "citizen@alpha.local.test");
      assert.equal(await citizen.locator(".ax-dashboard").count(), 0);
      assert.equal(await citizen.locator(".ax-sidebar-nav").count(), 0);

      // An office admin may read the balance, so the first figure is a number.
      const admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await admin.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await signIn(admin, "admin@alpha.local.test");
      await admin.locator(".ax-dashboard").waitFor();
      await admin.waitForFunction(() => /\d/.test(document.querySelector(".ax-dashboard .ax-stat strong")?.textContent ?? ""));
      // An office admin may read the balance, so the balance stat renders
      // (for staff above it is absent entirely).
      const adminStatTexts = await admin.locator(".ax-dashboard .ax-stat").allTextContents();
      assert.equal(adminStatTexts.some((s) => s.includes("Office credit balance")), true);
      assert.equal(
        await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
        "no horizontal page scroll at 390px",
      );
      await admin.screenshot({ path: "execution/screenshots/phase1-udc-dashboard-mobile.png", fullPage: true });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
