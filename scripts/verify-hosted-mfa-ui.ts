/** Post-deploy read-only browser acceptance. Never enrolls a hosted account. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

const output = "execution/recovery-mfa-live-browser.json";
const evidence: {
  startedAt: string;
  finishedAt?: string;
  baseUrl?: string;
  status: string;
  scope: string;
  viewport: { width: number; height: number };
  checks: { name: string; status: string }[];
  screenshots: string[];
  failedStage?: string;
  pageErrors?: number;
  blockedMutations?: number;
  cleanup?: string;
} = {
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  scope:
    "Existing synthetic QA staff account, read-only MFA availability/state and own security activity in English/Bangla. Login/logout only; no setup, MFA activation, recovery-code generation, password or business-record mutations.",
  viewport: { width: 390, height: 844 },
  checks: [],
  screenshots: [],
};
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  page: Page | undefined;
let base = "",
  stage = "Confirmed HTTPS origin and existing QA account";
let loginAttempted = false,
  signedOut = false,
  pageErrors = 0,
  blockedMutations = 0;
function save() {
  fs.mkdirSync("execution", { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
}
async function check(name: string, action: () => Promise<void>) {
  stage = name;
  try {
    await action();
    evidence.checks.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch {
    evidence.checks.push({ name, status: "FAIL" });
    // Do not expose assertion operands, credential values, traces or response bodies.
    throw new Error("Hosted MFA browser check failed.");
  } finally {
    save();
  }
}
async function mobileLayout() {
  assert.equal(
    await page!.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
}
async function screenshot(name: string) {
  assert.match(name, /^recovery-mfa-live-[a-z-]+\.png$/);
  const panel = page!.locator(".account-mfa");
  // Never capture a setup seed/QR, recovery-code list or a populated password.
  assert.equal(
    await panel.locator("img, .mfa-setup-key, .mfa-code-list").count(),
    0,
  );
  for (const input of await panel.locator("input").all())
    assert.equal(await input.inputValue(), "");
  const destination = `execution/${name}`;
  await panel.screenshot({ path: destination });
  evidence.screenshots.push(destination);
}

try {
  const origin = new URL(process.env.ASTRA_LIVE_URL ?? "");
  assert.equal(origin.protocol, "https:");
  assert.equal(origin.pathname, "/");
  assert.equal(
    origin.username + origin.password + origin.search + origin.hash,
    "",
  );
  base = origin.origin;
  const configuration = JSON.parse(
    fs.readFileSync(".runtime/hosted/credentials.json", "utf8"),
  );
  assert.equal(base, configuration.publicOrigin);
  evidence.baseUrl = base;
  const source = JSON.parse(
    fs.readFileSync("execution/hosted-orders-qa.json", "utf8"),
  );
  assert.equal(source.status, "PASS");
  const qa = JSON.parse(
    fs.readFileSync(".runtime/hosted/qa-credentials.json", "utf8"),
  ).runs.find((run: any) => run.runId === source.runId);
  assert.equal(qa.kind, "HOSTED_ORDERS_QA");
  assert.equal(qa.baseUrl, base);
  assert.equal(qa.lastStatus, "PASS");
  const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((name) => /^chromium-/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
      .find((file) => fs.existsSync(file));
  browser = await chromium.launch({ headless: true, executablePath });
  context = await browser.newContext({ viewport: evidence.viewport });
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const read = ["GET", "HEAD", "OPTIONS"].includes(request.method());
    const sessionWrite =
      request.method() === "POST" &&
      url.origin === base &&
      ["/api/v1/auth/login", "/api/v1/auth/logout"].includes(url.pathname);
    if (!read && !sessionWrite) {
      blockedMutations++;
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", () => pageErrors++);

  await check(
    "01 Blank masked login and keyboard password visibility",
    async () => {
      await page!.goto(`${base}/login`, {
        waitUntil: "networkidle",
        timeout: 120000,
      });
      await page!.getByRole("button", { name: "English", exact: true }).click();
      const form = page!.locator(".login-form");
      await form.waitFor();
      assert.equal(await form.locator("#email").inputValue(), "");
      assert.equal(await form.locator("#password").inputValue(), "");
      assert.equal(
        await form.locator("#password").getAttribute("type"),
        "password",
      );
      await form
        .getByRole("button", { name: "Show password", exact: true })
        .focus();
      await page!.keyboard.press("Space");
      assert.equal(
        await form.locator("#password").getAttribute("type"),
        "text",
      );
      await form
        .getByRole("button", { name: "Hide password", exact: true })
        .click();
      assert.equal(
        await form.locator("#password").getAttribute("type"),
        "password",
      );
      await mobileLayout();
    },
  );

  await check(
    "02 Existing staff password sign-in remains usable before optional enrollment",
    async () => {
      const form = page!.locator(".login-form");
      await form.locator("#email").fill(qa.accounts.staff.email);
      await form.locator("#password").fill(qa.accounts.staff.password);
      const response = page!.waitForResponse(
        (value) =>
          value.url() === `${base}/api/v1/auth/login` &&
          value.request().method() === "POST",
      );
      loginAttempted = true;
      await form.getByRole("button", { name: "Sign in", exact: true }).click();
      assert.equal((await response).status(), 200);
      await page!
        .getByRole("button", { name: "Sign out", exact: true })
        .waitFor();
      assert.equal(await page!.locator(".mfa-challenge").count(), 0);
      await mobileLayout();
    },
  );

  await check(
    "03 English MFA readiness and private own-activity reads",
    async () => {
      const statusResponse = page!.waitForResponse(
        (value) =>
          value.url() === `${base}/api/v1/auth/mfa` &&
          value.request().method() === "GET",
      );
      const historyResponse = page!.waitForResponse(
        (value) =>
          value.url() === `${base}/api/v1/auth/security-events` &&
          value.request().method() === "GET",
      );
      await page!.locator("#workspace-jump").selectOption("security");
      const status = await statusResponse,
        history = await historyResponse;
      assert.equal(status.status(), 200);
      assert.equal(history.status(), 200);
      assert.match(status.headers()["cache-control"], /no-store/);
      assert.match(history.headers()["cache-control"], /no-store/);
      const state = await status.json();
      assert.equal(state.available, true);
      assert.equal(state.enabled, false);
      assert.equal(state.recoveryCodesRemaining, 0);
      assert.equal("secret" in state || "recoveryCodes" in state, false);
      assert.ok(Array.isArray((await history.json()).items));
      const panel = page!.locator(".account-mfa");
      await panel
        .getByTestId("mfa-status")
        .filter({ hasText: /^Not enabled$/ })
        .waitFor();
      await panel
        .getByRole("heading", { name: "Two-step security", exact: true })
        .waitFor();
      assert.match(
        await panel.innerText(),
        /You can add an authenticator code/,
      );
      assert.match(
        await panel.innerText(),
        /No SMS or payment account is needed/,
      );
      const setupPassword = panel.getByLabel("Current password for setup", {
        exact: true,
      });
      assert.equal(await setupPassword.inputValue(), "");
      assert.equal(await setupPassword.getAttribute("type"), "password");
      assert.equal(
        await panel
          .getByRole("button", { name: "Set up authenticator", exact: true })
          .isDisabled(),
        true,
      );
      await panel
        .locator("summary")
        .filter({ hasText: "Recent security activity" })
        .click();
      await panel
        .getByRole("button", { name: "Refresh activity", exact: true })
        .waitFor();
      await mobileLayout();
      await screenshot("recovery-mfa-live-security-en.png");
    },
  );

  await check(
    "04 Bangla mobile MFA description and activity are readable without overflow",
    async () => {
      await page!.getByRole("button", { name: "বাংলা", exact: true }).click();
      const panel = page!.locator(".account-mfa");
      await panel
        .getByRole("heading", { name: "দুই ধাপের নিরাপত্তা", exact: true })
        .waitFor();
      assert.equal(
        await panel.getByTestId("mfa-status").innerText(),
        "চালু হয়নি",
      );
      await panel
        .getByLabel("সেটআপের জন্য বর্তমান পাসওয়ার্ড", { exact: true })
        .waitFor();
      assert.match(await panel.innerText(), /চাইলে পাসওয়ার্ডের পরে/);
      await panel
        .getByRole("button", { name: "কার্যক্রম আবার দেখুন", exact: true })
        .waitFor();
      await mobileLayout();
      await screenshot("recovery-mfa-live-security-bn.png");
      await page!.getByRole("button", { name: "English", exact: true }).click();
    },
  );

  await check(
    "05 Profile exposes the same optional protection with no stored secrets",
    async () => {
      await page!.locator("#workspace-jump").selectOption("profile");
      const panel = page!.locator(".account-mfa");
      await panel
        .getByTestId("mfa-status")
        .filter({ hasText: /^Not enabled$/ })
        .waitFor();
      assert.equal(await panel.getByRole("img").count(), 0);
      assert.equal(
        await panel.locator(".mfa-setup-key, .mfa-code-list").count(),
        0,
      );
      assert.equal(
        await panel
          .getByLabel("Current password for setup", { exact: true })
          .inputValue(),
        "",
      );
      const storage = await context!.storageState();
      assert.ok(
        storage.origins.every((entry) =>
          entry.localStorage.every((item) => item.name === "astra.language"),
        ),
      );
      assert.equal(await page!.evaluate(() => sessionStorage.length), 0);
      assert.equal(new URL(page!.url()).search, "");
      await mobileLayout();
    },
  );

  await check(
    "06 Sign-out clears fields with zero page errors or unexpected writes",
    async () => {
      const response = page!.waitForResponse(
        (value) =>
          value.url() === `${base}/api/v1/auth/logout` &&
          value.request().method() === "POST",
      );
      await page!
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      assert.equal((await response).status(), 200);
      const form = page!.locator(".login-form");
      await form.waitFor();
      signedOut = true;
      assert.equal(await form.locator("#email").inputValue(), "");
      assert.equal(await form.locator("#password").inputValue(), "");
      assert.equal(
        await form.locator("#password").getAttribute("type"),
        "password",
      );
      assert.equal(
        await page!.locator(".account-mfa, .mfa-challenge").count(),
        0,
      );
      assert.equal(pageErrors, 0);
      assert.equal(blockedMutations, 0);
    },
  );
  evidence.status = "PASS";
  console.log(`PASS: ${evidence.checks.length} hosted MFA browser groups.`);
} catch {
  evidence.status = "FAIL";
  evidence.failedStage = stage;
  process.exitCode = 1;
  console.error(
    `Hosted MFA browser verification failed at ${stage}; private values and stack withheld.`,
  );
} finally {
  if (loginAttempted && !signedOut && context && base) {
    try {
      const response = await context.request.get(`${base}/api/v1/auth/me`, {
        timeout: 15000,
      });
      if (response.status() === 401) signedOut = true;
      else {
        assert.equal(response.status(), 200);
        const session = await response.json();
        assert.equal(typeof session.csrfToken, "string");
        signedOut = (
          await context.request.post(`${base}/api/v1/auth/logout`, {
            timeout: 15000,
            headers: { Origin: base, "X-CSRF-Token": session.csrfToken },
          })
        ).ok();
      }
    } catch {
      signedOut = false;
    }
  }
  evidence.cleanup = !loginAttempted
    ? "NO_SESSION_CREATED"
    : signedOut
      ? "SIGNED_OUT"
      : "SESSION_CLEANUP_UNCONFIRMED";
  if (loginAttempted && !signedOut) {
    evidence.status = "FAIL";
    process.exitCode = 1;
  }
  await browser?.close();
  evidence.pageErrors = pageErrors;
  evidence.blockedMutations = blockedMutations;
  evidence.finishedAt = new Date().toISOString();
  save();
}
