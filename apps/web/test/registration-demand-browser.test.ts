import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test(
  "demand list browser: a gate-blocked signup appears in the owner's Registration demand section",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const unique = Date.now();
    const mobile = `015${String(unique).slice(-8)}`;
    // Target union: the last union of upa-001 — other suites onboard offices
    // for the first one; no office serves this one, so the gate refuses it.
    const unions = JSON.parse(fs.readFileSync("data/geo/unions.json", "utf8")).filter(
      (row: any) => row.upazilaCode === "upa-001",
    );
    const target = unions[unions.length - 1];
    const ward = JSON.parse(fs.readFileSync("data/geo/wards.json", "utf8")).find(
      (row: any) => row.unionCode === target.code,
    );
    let tenantId = "";
    {
      const owner = await browser.newContext();
      const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
      });
      assert.equal(login.status(), 200, await login.text());
      const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
        headers: { "X-CSRF-Token": (await login.json()).csrfToken },
        data: {
          slug: `demand-web-${unique}`,
          nameBn: "চাহিদা ওয়েব অফিস",
          nameEn: `Demand Web Office ${unique}`,
          division: "Test Division",
          district: "Test District",
          upazila: "Test Upazila",
          officeType: "UNION",
          adminEmail: `admin@demand-web-${unique}.test`,
          adminName: "Demand Web Admin",
          adminPassword: randomBytes(12).toString("base64url"),
        },
      });
      assert.equal(created.status(), 201, await created.text());
      tenantId = (await created.json()).id;
      await owner.close();
    }
    {
      // The blocked attempt itself, from a session-free context (the public
      // signup endpoint; the gate fires before the one-time code is consumed,
      // so a format-valid token is enough to reach it).
      const anon = await browser.newContext();
      const blocked = await anon.request.post(`${origin}/api/v1/auth/signup`, {
        data: {
          email: `demand-web-${unique}@example.test`,
          password: randomBytes(12).toString("base64url"),
          displayName: "Demand Web Citizen",
          tenantId,
          nameBn: "চাহিদা ওয়েব নাগরিক",
          nameEn: "Demand Web Citizen",
          dateOfBirth: "1996-03-04",
          addressBn: "চাহিদা ঠিকানা",
          addressEn: "Demand address",
          geography: {
            divisionCode: "div-01",
            districtCode: "dis-01",
            upazilaCode: "upa-001",
            unionCode: target.code,
            wardCode: ward.code,
          },
          mobile,
          otpToken: "a".repeat(64),
        },
      });
      assert.equal(blocked.status(), 422, await blocked.text());
      await anon.close();
    }
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() => {
        if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en");
      });
      await signIn(page, "owner@astra.demo.test", "Demo-Phase1!");
      await goToWorkspacePage(page, "Platform management");
      const nav = page.getByRole("navigation", { name: "Platform management sections" });
      await nav.getByRole("link", { name: "Registration demand", exact: true }).click();
      const section = page.locator("#owner-demand");
      await section
        .getByRole("heading", { name: "Registration demand", exact: true })
        .waitFor();
      // The per-union totals name the union, and the attempt itself is listed
      // with the mobile number the form collected.
      await section.getByText(target.nameEn, { exact: false }).first().waitFor();
      await section.getByText(mobile, { exact: true }).waitFor();
      await context.close();
    } finally {
      await browser.close();
    }
  },
);
