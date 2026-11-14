import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
/** The development provider writes codes only to the server log and this git-ignored outbox. */
function codeFor(mobile: string): string {
  const lines = fs.readFileSync(".runtime/otp-outbox.log", "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return lines.reverse().find((l: any) => l.mobile === mobile).code;
}

test(
  "Phase 2c registration: verify a mobile with a one-time code, register, then sign in with the mobile",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const unique = Date.now();
    const mobile = `016${String(unique).slice(-8)}`;
    const password = `Otp-${randomUUID()}`; // generated per run
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await page.goto(`${origin}/register`);
      const union = JSON.parse(fs.readFileSync("data/geo/unions.json", "utf8")).find((row: any) => row.upazilaCode === "upa-001");
      for (const [level, code] of [["division", "div-01"], ["district", "dis-01"], ["upazila", "upa-001"], ["union", union.code], ["ward", `${union.code}-w01`]]) {
        await page.locator(`#signup-geo-${level} option[value="${code}"]`).waitFor({ state: "attached" });
        await page.locator(`#signup-geo-${level}`).selectOption(code);
      }
      await page.getByRole("button", { name: "Use a preview office", exact: true }).click();
      const alphaOption = page.locator("#signup-office option").filter({ hasText: "Demo Alpha Union" });
      await alphaOption.waitFor({ state: "attached" });
      await page.getByLabel("Select office", { exact: true }).selectOption((await alphaOption.getAttribute("value"))!);
      for (const [label, value] of Object.entries({
        "Email address": `otp-signup-${unique}@example.test`,
        "Choose password": password,
        "Display name": "OTP Browser Citizen",
        "Name (Bangla)": "নমুনা নাগরিক",
        "Name (English)": "OTP Browser Citizen",
        "Date of birth": "1991-02-03",
        "Address (Bangla)": "নমুনা গ্রাম",
        "Address (English)": "Synthetic Village",
      }))
        await page.getByLabel(label, { exact: true }).fill(value);

      // Mobile verification: send, a wrong code is refused, the right code verifies.
      await page.locator("#signup-mobile").fill(mobile);
      await page.getByRole("button", { name: "Send code" }).click();
      await page.locator("#signup-otp").waitFor();
      await page.getByRole("button", { name: /Resend \(\d+s\)/ }).waitFor();
      const right = codeFor(mobile);
      await page.locator("#signup-otp").fill(right === "000000" ? "111111" : "000000");
      await page.getByRole("button", { name: "Verify code" }).click();
      await page.locator(".mobile-otp").getByText(/not correct/).waitFor();
      await page.locator("#signup-otp").fill(right);
      await page.getByRole("button", { name: "Verify code" }).click();
      await page.locator(".mobile-otp-done").getByText(mobile).waitFor();
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.locator(".mobile-otp").screenshot({ path: "execution/screenshots/phase2c-mobile-verified.png" });

      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.getByRole("heading", { name: "Account created", exact: true }).waitFor();

      // The verified mobile now signs in.
      await page.goto(`${origin}/login`);
      await page.locator("#login-identifier-type").selectOption("mobile");
      await page.locator(".login-form #email").fill(mobile);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
