import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { signOut } from "./fixtures/session.js";

const origin = "http://127.0.0.1:5173";
const password = "Synth-Mfa-Brows1!";
async function launch() {
  const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((name) => /^chromium-/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
      .find((name) => fs.existsSync(name));
  return chromium.launch({ headless: true, executablePath });
}
function totp(secret: string, step = Math.floor(Date.now() / 30_000)) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((value) => alphabet.indexOf(value).toString(2).padStart(5, "0"))
    .join("");
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8)
    bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto
    .createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  return ((mac.readUInt32BE(mac[mac.length - 1] & 15) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}
async function createUser(browser: Browser, label: string) {
  const admin = await browser.newContext();
  const email = `mfa-browser-${label}-${crypto.randomUUID()}@example.test`;
  try {
    const login = await admin.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "admin@alpha.local.test", password: "Demo-Phase1!" },
    });
    assert.equal(login.status(), 200);
    const created = await admin.request.post(`${origin}/api/v1/admin/users`, {
      headers: { "X-CSRF-Token": (await login.json()).csrfToken },
      data: {
        email,
        password,
        displayName: "Synthetic MFA Browser",
        role: "staff",
      },
    });
    assert.equal(
      created.status(),
      201,
      "Synthetic MFA account creation failed.",
    );
    return email;
  } finally {
    await admin.close();
  }
}
async function login(page: Page, email: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
}
async function openSecurity(page: Page) {
  await goToWorkspacePage(page, "security");
  const panel = page.locator(".account-mfa");
  await panel.getByTestId("mfa-status").waitFor();
  return panel;
}
async function noStoredSecrets(context: BrowserContext, page: Page) {
  const storage = await context.storageState();
  assert.ok(
    storage.origins.every((entry) =>
      entry.localStorage.every((item) => item.name === "astra.language"),
    ),
    "MFA must not persist secrets in local storage.",
  );
  assert.equal(
    await page.evaluate(() => sessionStorage.length),
    0,
    "MFA must not persist secrets in session storage.",
  );
  assert.equal(
    new URL(page.url()).search,
    "",
    "MFA must not put secrets in the URL.",
  );
}

test(
  "MFA browser: unavailable setup is honest; cancelled setup clears secret on navigation and keeps login unchanged",
  { timeout: 90000 },
  async () => {
    const browser = await launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      const email = await createUser(browser, "cancel");
      await login(page, email);
      await page.route("**/api/v1/auth/mfa", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        assert.equal(
          body.available,
          true,
          "Browser QA requires the synthetic MFA encryption key.",
        );
        await route.fulfill({ response, json: { ...body, available: false } });
      });
      let panel = await openSecurity(page);
      await panel
        .getByText(
          "Authenticator setup is unavailable on this site. Check again later or contact support.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await panel
          .getByRole("button", { name: "Set up authenticator", exact: true })
          .count(),
        0,
      );
      await page.unroute("**/api/v1/auth/mfa");
      await goToWorkspacePage(page, "home");
      panel = await openSecurity(page);
      await panel
        .getByLabel("Current password for setup", { exact: true })
        .fill(password);
      await panel
        .getByRole("button", { name: "Set up authenticator", exact: true })
        .click();
      await panel
        .getByRole("img", {
          name: "Private authenticator setup QR",
          exact: true,
        })
        .waitFor();
      assert.equal(
        (await (await context.request.get(`${origin}/api/v1/auth/mfa`)).json())
          .enabled,
        false,
        "Displaying a QR must not enable MFA.",
      );
      await goToWorkspacePage(page, "home");
      panel = await openSecurity(page);
      assert.equal(await panel.getByRole("img").count(), 0);
      assert.equal(await panel.getByTestId("mfa-setup-key").count(), 0);
      await panel
        .getByLabel("Current password for setup", { exact: true })
        .waitFor();
      assert.equal(
        await panel
          .getByLabel("Current password for setup", { exact: true })
          .inputValue(),
        "",
      );
      // The server may complete setup after the page is hidden. Its delayed
      // response must not repopulate a private QR in a restored browser page.
      let releaseEnrollment = () => {};
      let capturedEnrollment = () => {};
      const delayed = new Promise<void>((resolve) => {
        releaseEnrollment = resolve;
      });
      const captured = new Promise<void>((resolve) => {
        capturedEnrollment = resolve;
      });
      await page.route("**/api/v1/auth/mfa/enrollment", async (route) => {
        const response = await route.fetch();
        capturedEnrollment();
        await delayed;
        await route.fulfill({ response });
      });
      await panel
        .getByLabel("Current password for setup", { exact: true })
        .fill(password);
      await panel
        .getByRole("button", { name: "Set up authenticator", exact: true })
        .click();
      await captured;
      await page.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pagehide")),
      );
      const finishedEnrollment = page.waitForResponse((response) =>
        response.url().endsWith("/auth/mfa/enrollment"),
      );
      releaseEnrollment();
      await (await finishedEnrollment).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      assert.equal(
        await panel.getByRole("img").count(),
        0,
        "A delayed response after pagehide must not reveal the setup QR.",
      );
      assert.equal(await panel.getByTestId("mfa-setup-key").count(), 0);
      assert.equal(
        await panel
          .getByLabel("Current password for setup", { exact: true })
          .inputValue(),
        "",
      );
      await page.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pageshow")),
      );
      await page.unroute("**/api/v1/auth/mfa/enrollment");
      await noStoredSecrets(context, page);
      await signOut(page);
      await login(page, email);
      await page
        .getByRole("button", { name: "Sign out", exact: true })
        .waitFor();
    } finally {
      await browser.close();
    }
  },
);

test(
  "MFA browser: real enrollment, rejected/replayed codes, recovery login, rotation and disable work with bilingual mobile guidance",
  { timeout: 150000 },
  async () => {
    const browser = await launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const other = await browser.newContext();
    const page = await context.newPage();
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const email = await createUser(browser, "full");
      assert.equal(
        (
          await other.request.post(`${origin}/api/v1/auth/login`, {
            data: { email, password },
          })
        ).status(),
        200,
      );
      await login(page, email);
      let panel = await openSecurity(page);
      await panel
        .getByLabel("Current password for setup", { exact: true })
        .fill("wrong-password");
      await panel
        .getByRole("button", { name: "Set up authenticator", exact: true })
        .click();
      await panel.getByRole("alert").waitFor();
      assert.equal(
        await panel
          .getByLabel("Current password for setup", { exact: true })
          .inputValue(),
        "",
      );
      await panel
        .getByLabel("Current password for setup", { exact: true })
        .fill(password);
      const enrollmentResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/auth/mfa/enrollment") &&
          response.status() === 201,
      );
      await panel
        .getByRole("button", { name: "Set up authenticator", exact: true })
        .click();
      const enrollment = await (await enrollmentResponse).json();
      await panel
        .getByRole("img", {
          name: "Private authenticator setup QR",
          exact: true,
        })
        .waitFor();
      const activationStep = Math.floor(Date.now() / 30_000);
      const activationCode = totp(enrollment.secret, activationStep);
      await panel
        .getByLabel("6-digit authenticator code", { exact: true })
        .fill(activationCode);
      await panel
        .getByRole("button", { name: "Verify and enable", exact: true })
        .click();
      await panel
        .getByRole("heading", {
          name: "Save your recovery codes now",
          exact: true,
        })
        .waitFor();
      const recoveryCodes = await panel
        .locator(".mfa-code-list code")
        .allTextContents();
      assert.equal(recoveryCodes.length, 10);
      assert.equal(
        await panel.getByRole("img").count(),
        0,
        "The setup QR must disappear after activation.",
      );
      assert.equal(await panel.getByTestId("mfa-setup-key").count(), 0);
      assert.equal(
        (await other.request.get(`${origin}/api/v1/auth/me`)).status(),
        401,
        "Enabling MFA must revoke other sessions.",
      );
      await panel
        .getByRole("button", { name: "I saved them — hide codes", exact: true })
        .click();
      assert.equal(await panel.locator(".mfa-code-list code").count(), 0);
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      await panel
        .getByRole("heading", { name: "দুই ধাপের নিরাপত্তা", exact: true })
        .waitFor();
      assert.equal(
        await panel.getByTestId("mfa-status").innerText(),
        "চালু আছে",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.getByRole("button", { name: "English", exact: true }).click();
      await noStoredSecrets(context, page);
      await signOut(page);
      await login(page, email);
      const challenge = page.locator(".mfa-challenge");
      await challenge
        .getByRole("heading", { name: "One more step to sign in", exact: true })
        .waitFor();
      // QAFIX-09 (B3): a cookie-less /auth/me now answers 200 with
      // an anonymous body instead of 401, so the property is read
      // from the body — it must carry no session user.
      const passwordOnlyMe = await (
        await context.request.get(`${origin}/api/v1/auth/me`)
      ).json();
      assert.equal(
        passwordOnlyMe.user,
        null,
        "Password alone must not establish a session.",
      );
      assert.equal(
        await page
          .getByRole("navigation", { name: "Workspace navigation" })
          .count(),
        0,
      );
      await challenge
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(activationCode);
      await challenge
        .getByRole("button", { name: "Verify and sign in", exact: true })
        .click();
      await challenge.getByRole("alert").waitFor();
      // QAFIX-09 (B3): same anonymous-body contract as above.
      const replayMe = await (
        await context.request.get(`${origin}/api/v1/auth/me`)
      ).json();
      assert.equal(
        replayMe.user,
        null,
        "The enrollment code must not be replayable.",
      );
      assert.equal(
        await challenge
          .getByLabel("Authenticator or recovery code", { exact: true })
          .inputValue(),
        "",
      );
      await challenge
        .getByRole("button", { name: "← Back to sign in", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Password", { exact: true }).inputValue(),
        "",
      );
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page
        .locator(".login-form")
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await challenge
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(recoveryCodes[0]);
      await challenge
        .getByRole("button", { name: "Verify and sign in", exact: true })
        .click();
      panel = await openSecurity(page);
      await panel
        .getByTestId("mfa-code-count")
        .filter({ hasText: /^9$/ })
        .waitFor();
      // A consumed time step cannot authenticate twice. Exercise a real next-step
      // authenticator login as well as the recovery-code path without bypassing time.
      await signOut(page);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, (activationStep + 1) * 30_000 - Date.now() + 500),
        ),
      );
      await login(page, email);
      await challenge
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(totp(enrollment.secret));
      await challenge
        .getByRole("button", { name: "Verify and sign in", exact: true })
        .click();
      panel = await openSecurity(page);
      await panel
        .getByTestId("mfa-code-count")
        .filter({ hasText: /^9$/ })
        .waitFor();
      await panel
        .getByRole("button", { name: "Replace recovery codes", exact: true })
        .click();
      await panel
        .getByLabel("Confirm current password", { exact: true })
        .fill(password);
      await panel
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(recoveryCodes[1]);
      await panel
        .getByRole("button", { name: "Confirm replacement", exact: true })
        .click();
      await panel
        .getByRole("heading", {
          name: "Save your recovery codes now",
          exact: true,
        })
        .waitFor();
      const newCodes = await panel
        .locator(".mfa-code-list code")
        .allTextContents();
      assert.equal(newCodes.length, 10);
      assert.ok(
        newCodes.every((value) => !recoveryCodes.includes(value)),
        "Replacement codes must be new.",
      );
      await panel
        .getByRole("button", { name: "I saved them — hide codes", exact: true })
        .click();
      await panel
        .getByRole("button", {
          name: "Turn off two-step security",
          exact: true,
        })
        .click();
      await panel
        .getByLabel("Confirm current password", { exact: true })
        .fill(password);
      await panel
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(recoveryCodes[2]);
      await panel
        .getByRole("button", { name: "Confirm turn off", exact: true })
        .click();
      await panel.getByRole("alert").waitFor();
      assert.equal(
        (await (await context.request.get(`${origin}/api/v1/auth/mfa`)).json())
          .enabled,
        true,
        "Replaced recovery codes must not disable MFA.",
      );
      await panel
        .getByLabel("Confirm current password", { exact: true })
        .fill(password);
      await panel
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(newCodes[0]);
      await panel
        .getByRole("button", { name: "Confirm turn off", exact: true })
        .click();
      await panel
        .getByTestId("mfa-status")
        .filter({ hasText: /^Not enabled$/ })
        .waitFor();
      await panel
        .locator("summary")
        .filter({ hasText: "Recent security activity" })
        .click();
      await panel
        .getByText("Two-step security enabled", { exact: true })
        .waitFor();
      await panel
        .getByText("Two-step security disabled", { exact: true })
        .waitFor();
      await noStoredSecrets(context, page);
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await panel.screenshot({
        path: "execution/screenshots/mfa-security-mobile-bn.png",
      });
      await page.getByRole("button", { name: "English", exact: true }).click();
      await signOut(page);
      await login(page, email);
      await page
        .getByRole("button", { name: "Sign out", exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
