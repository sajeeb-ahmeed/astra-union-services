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

const TEST_CONTACT = {
  phone: "+8801712345678",
  email: "support@example.test",
  hoursBn: "শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা",
  hoursEn: "Sat–Thu, 9am–5pm",
};

/** Sign the owner in through the API (page context) and return the CSRF token. */
async function ownerLogin(page: Page): Promise<string> {
  const auth = await page.evaluate(async () => {
    const r = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: "owner@astra.demo.test", password: "Demo-Phase1!" }),
    });
    return { status: r.status, body: await r.json() };
  });
  assert.equal(auth.status, 200, JSON.stringify(auth.body));
  return auth.body.csrfToken as string;
}

async function setContact(page: Page, csrf: string, contact: typeof TEST_CONTACT | { phone: string; email: string; hoursBn: string; hoursEn: string }) {
  const r = await page.evaluate(
    async ({ csrf, contact }) => {
      const res = await fetch("/api/v1/owner/support-contact", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        credentials: "include",
        body: JSON.stringify({ ...contact, reason: "Stage 2 browser test — temporary test contact" }),
      });
      return { status: res.status, body: await res.json() };
    },
    { csrf, contact },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test(
  "F-001/F-002/F-003/F-014/L-004: published contact, eligibility, ask-your-office, recovery contact, hidden witness links",
  { timeout: 180000 },
  async () => {
    const browser = await browserInstance();
    // Two contexts: the owner (sets the contact) and an anonymous citizen
    // (reads the public pages) — the citizen must stay signed out, or
    // "/" would render the workspace instead of the public home.
    const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const citizen = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await citizen.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    citizen.on("pageerror", (error) => errors.push(error.message));
    let original: { phone: string; email: string; hoursBn: string; hoursEn: string } | null = null;
    let csrf = "";
    try {
      // The owner reads the current contact, then publishes the test one.
      await ownerPage.goto(`${origin}/login`);
      csrf = await ownerLogin(ownerPage);
      const current = await ownerPage.evaluate(async () => {
        const r = await fetch("/api/v1/owner/support-contact", { credentials: "include" });
        return r.json();
      });
      original = current;
      await setContact(ownerPage, csrf, TEST_CONTACT);

      // F-001: the utility bar and the footer show the configured contact.
      await citizen.goto(`${origin}/`);
      await citizen.locator(".hx-hero").waitFor({ timeout: 30000 });
      await citizen.locator(".util-bar a[href^=\"tel:\"]").waitFor({ timeout: 15000 });
      assert.ok((await citizen.locator(".util-bar a[href^=\"tel:\"]").textContent())?.includes("+8801712345678"));
      assert.equal(await citizen.locator(".du-footer-contact a[href^=\"mailto:\"]").count(), 1);
      assert.ok((await citizen.locator(".du-footer-contact a[href^=\"mailto:\"]").textContent())?.includes("support@example.test"));

      // F-014: the recovery page shows the platform support contact.
      await citizen.goto(`${origin}/recover`);
      await citizen.locator(".recovery-contact a[href^=\"tel:\"]").waitFor({ timeout: 15000 });
      assert.ok((await citizen.locator(".recovery-contact").textContent())?.includes("+8801712345678"));
      assert.ok((await citizen.locator(".recovery-contact").textContent())?.includes("support@example.test"));

      // F-002 + F-003: the Trade Licence page shows the honest
      // not-published eligibility state, and each unpublished office row
      // links to its office ("Ask this office").
      await citizen.goto(`${origin}/services/trade-license`);
      await citizen.locator(".service-eligibility").waitFor({ timeout: 15000 });
      assert.ok(
        (await citizen.locator(".service-eligibility").textContent())?.includes("Who can apply for this service has not been published yet."),
        "eligibility must render the not-published state, never invented requirements",
      );
      await citizen.locator(".service-office-unpublished").first().waitFor({ timeout: 15000 });
      const unpublished = citizen.locator(".service-office-unpublished");
      assert.ok((await unpublished.count()) >= 1, "expected at least one unpublished office row for Trade Licence");
      assert.ok(
        (await unpublished.first().textContent())?.includes("Has not yet published its fee, time and documents"),
      );
      const askLink = unpublished.first().locator("a[href^=\"/offices/\"]");
      assert.equal(await askLink.count(), 1, "unpublished row must link to its office");
      assert.ok((await askLink.textContent())?.includes("Ask this office"));

      // L-004: with the witness options confirmed empty, every witness
      // entry point is gone — the home help card link detaches once the
      // fetch resolves, and the footer carries no witness link.
      await citizen.goto(`${origin}/`);
      await citizen.locator(".hx-hero").waitFor({ timeout: 30000 });
      await citizen.locator(".hp-links a[href=\"/witness\"]").waitFor({ state: "detached", timeout: 15000 });
      assert.equal(await citizen.locator("footer").getByText("Witness statement", { exact: true }).count(), 0);

      // Restore the contact the test found, then prove the recovery page
      // hides the contact block again (F-014, unconfigured state).
      assert.ok(original, "original contact must have been read");
      await setContact(ownerPage, csrf, original);
      await citizen.goto(`${origin}/recover`);
      await citizen.getByRole("heading", { name: "Account recovery", exact: true }).waitFor({ timeout: 15000 });
      assert.equal(await citizen.locator(".recovery-contact").count(), 0, "no contact block when nothing is configured");
      assert.ok(
        (await citizen.locator(".panel.narrow").textContent())?.includes("Contact your office administrator"),
        "the office-administrator paragraph stands alone when unconfigured",
      );

      assert.deepEqual(errors, []);
    } finally {
      // Best-effort restore if an assertion failed mid-test.
      try {
        if (original && csrf) await setContact(ownerPage, csrf, original);
      } catch {
        // The main assertions already failed; do not mask them.
      }
      await browser.close();
    }
  },
);
