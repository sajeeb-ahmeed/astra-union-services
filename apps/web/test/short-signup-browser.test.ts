/**
 * REG-UX Phase 1 — one-screen citizen signup in a real browser (design note §6.2/§6.3).
 *
 * Replaces the Phase 2c wizard walk (area → office → details → OTP): the account is
 * created from three typed fields on one screen with the office preselected, the
 * citizen signs in with the mobile number, and errors land at their field.
 * The timed walkthrough's numbers are written to execution/reg-ux-walkthrough.json.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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

test(
  "REG-UX 1: one screen, three typed fields — the office is preselected, the account signs in with its mobile",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const unique = Date.now();
    const mobile = `016${String(unique).slice(-8)}`;
    const password = randomBytes(12).toString("base64url"); // generated per run
    const union = JSON.parse(fs.readFileSync("data/geo/unions.json", "utf8")).find((row: any) => row.upazilaCode === "upa-001");
    const slug = `short-union-${unique}`;
    const officeName = `Short Signup Union ${unique}`;
    {
      const owner = await browser.newContext();
      const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
      });
      const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
        headers: { "X-CSRF-Token": (await login.json()).csrfToken },
        data: {
          slug,
          nameBn: "সংক্ষিপ্ত নিবন্ধন ইউনিয়ন",
          nameEn: officeName,
          officeType: "UNION",
          geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: union.code },
          adminEmail: `admin@${slug}.test`,
          adminName: "Short Signup Admin",
          adminPassword: randomBytes(12).toString("base64url"),
        },
      });
      assert.equal(created.status(), 201, await created.text());
      await owner.close();
    }
    try {
      fs.mkdirSync("execution/screenshots", { recursive: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("astra.language", "en"));
      const started = Date.now();
      // The office comes preselected (here from ?office=<slug>; in production from the
      // configured default) — no area cascade on screen until "Change" is chosen.
      await page.goto(`${origin}/register?office=${slug}`);
      await page.locator(".du-signup-office-name").getByText(officeName).waitFor();
      assert.equal(await page.locator("#signup-geo-division").count(), 0, "no cascade up front");
      const typed = page.locator(".du-short-signup input:not([type=file])");
      assert.equal(await typed.count(), 4, "name, mobile, password and the optional email");
      assert.equal(await page.locator(".du-short-signup input[required]").count(), 3, "three required fields");
      await page.screenshot({ path: "execution/screenshots/reg-ux-signup-mobile.png", fullPage: true });

      // A malformed mobile is refused by the API and shown at the mobile field, focused.
      await page.locator("#signup-name").fill("Short Browser Citizen");
      await page.locator("#signup-mobile").fill("12345");
      await page.locator("#signup-password").fill(password);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.locator("#signup-mobile-error").getByText(/11-digit/).waitFor();
      assert.equal(await page.locator("#signup-mobile").getAttribute("aria-invalid"), "true");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "signup-mobile");
      assert.equal(await page.locator("#signup-name").inputValue(), "Short Browser Citizen", "typed values are kept");

      await page.locator("#signup-mobile").fill(mobile);
      await page.locator("#signup-password").fill(password);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.getByRole("heading", { name: "Account created", exact: true }).waitFor();
      const seconds = (Date.now() - started) / 1000;
      fs.writeFileSync(
        "execution/reg-ux-walkthrough.json",
        JSON.stringify(
          { flow: "one-screen signup (automated)", screens: 1, requiredTypedFields: 3, secondsToAccount: Number(seconds.toFixed(1)) },
          null,
          2,
        ),
      );
      assert.ok(seconds < 60, `account created in ${seconds}s`);

      // The success screen hands over to a sign-in form prefilled with the mobile.
      await page.getByRole("button", { name: "Go to sign in", exact: true }).click();
      await page.locator("#login-identifier-type").waitFor();
      assert.equal(await page.locator("#login-identifier-type").inputValue(), "mobile");
      assert.equal(await page.locator(".login-form #email").inputValue(), mobile);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.getByRole("button", { name: "Sign out", exact: true }).click();

      // The same mobile again: refused at the mobile field, with a sign-in button there.
      await page.goto(`${origin}/register?office=${slug}`);
      await page.locator(".du-signup-office-name").getByText(officeName).waitFor();
      await page.locator("#signup-name").fill("Second Person");
      await page.locator("#signup-mobile").fill(mobile);
      await page.locator("#signup-password").fill(password);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      const taken = page.locator("#signup-mobile-error");
      await taken.getByText(/already has an account/).waitFor();
      await taken.getByRole("button", { name: "Sign in", exact: true }).waitFor();
      assert.equal(await page.locator("#signup-password").inputValue(), "", "the password is cleared after a refusal");

      // "Change" reveals the area cascade for those who need another office.
      await page.getByRole("button", { name: "Change", exact: true }).click();
      await page.locator("#signup-geo-division").waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(errors, []);

      const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await desktop.addInitScript(() => localStorage.setItem("astra.language", "bn"));
      await desktop.goto(`${origin}/register?office=${slug}`);
      await desktop.locator(".du-signup-office-name").getByText("সংক্ষিপ্ত নিবন্ধন ইউনিয়ন").waitFor();
      await desktop.screenshot({ path: "execution/screenshots/reg-ux-signup-desktop.png", fullPage: true });
    } finally {
      await browser.close();
    }
  },
);
