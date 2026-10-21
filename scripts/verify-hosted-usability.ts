/** Live read-only UX acceptance using existing synthetic QA records. Run after deployment. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

const output = "execution/usability-live-browser-qa.json";
const evidence: {
  startedAt: string;
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
  finishedAt?: string;
} = {
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  scope:
    "Public navigation and existing synthetic staff/application records. Login/logout only; no application, citizen, payment, certificate or approval changes.",
  viewport: { width: 390, height: 844 },
  checks: [],
  screenshots: [],
};
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let base = "";
let stage = "Preflight and exact authorized origin";
let loginAttempted = false;
let signedOut = false;
let pageErrors = 0;
let blockedMutations = 0;
const save = () => {
  fs.mkdirSync("execution", { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
};
async function check(name: string, action: () => Promise<void>) {
  stage = name;
  try {
    await action();
    evidence.checks.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch {
    evidence.checks.push({ name, status: "FAIL" });
    // Never forward assertion operands, Playwright traces or account values.
    throw Error("Hosted usability check failed.");
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
async function screenshot(selector: string, name: string) {
  assert.match(name, /^usability-live-[a-z-]+\.png$/);
  const destination = `execution/${name}`;
  await page!.locator(selector).screenshot({ path: destination });
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
  assert.match(qa.applications.positive, /^[a-f0-9-]{36}$/);
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
  // Enforce the advertised mutation boundary even if a UI control regresses.
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
    "01 Public quick tasks open tracking and verification",
    async () => {
      await page!.goto(base, { waitUntil: "networkidle", timeout: 120000 });
      const tasks = page!.getByRole("group", {
        name: "Quick tasks",
        exact: true,
      });
      await tasks.waitFor();
      assert.equal(await tasks.getByRole("button").count(), 2);
      await mobileLayout();
      await screenshot(
        ".public-quick-tasks",
        "usability-live-public-tasks.png",
      );
      await tasks
        .getByRole("button", { name: /^Check application progress/ })
        .click();
      await page!
        .getByRole("heading", {
          name: "Current application status",
          exact: true,
        })
        .waitFor();
      assert.equal(new URL(page!.url()).pathname, "/tracking");
      await page!.locator(".public-brand").first().click();
      await page!
        .getByRole("group", { name: "Quick tasks", exact: true })
        .getByRole("button", { name: /^Check a certificate/ })
        .click();
      await page!
        .getByRole("heading", { name: "Verify a certificate", exact: true })
        .waitFor();
      assert.equal(new URL(page!.url()).pathname, "/verify");
      assert.equal(await page!.locator("#verification-token").inputValue(), "");
    },
  );

  await check(
    "02 Bangla-digit service search, focused details and return",
    async () => {
      await page!
        .getByRole("navigation", { name: "Public navigation", exact: true })
        .getByRole("button", { name: "Services", exact: true })
        .click();
      await page!.getByRole("button", { name: "বাংলা", exact: true }).click();
      await page!.locator("#public-service-search").fill("৪৫");
      assert.equal(await page!.locator(".public-service").count(), 1);
      await page!.locator(".public-service").click();
      await page!.locator(".service-information").waitFor();
      await page!.waitForFunction(() =>
        document.activeElement?.classList.contains("service-information"),
      );
      assert.match(
        await page!.locator(".service-information .eyebrow").innerText(),
        /45|৪৫/,
      );
      await mobileLayout();
      await screenshot(".service-information", "usability-live-catalog-bn.png");
      await page!
        .getByRole("button", { name: "← অন্য সেবা বেছে নিন", exact: true })
        .click();
      assert.equal(await page!.locator(".service-information").count(), 0);
      assert.equal(
        await page!.evaluate(() => document.activeElement?.id),
        "public-service-search",
      );
      assert.equal(
        await page!.locator("#public-service-search").inputValue(),
        "৪৫",
      );
      await page!
        .getByRole("button", { name: "খোঁজা মুছে সব সেবা দেখুন", exact: true })
        .click();
      assert.equal(await page!.locator(".public-service").count(), 47);
      await page!.getByRole("button", { name: "English", exact: true }).click();
    },
  );

  await check(
    "03 Blank login and password visibility with existing staff sign-in",
    async () => {
      await page!.goto(`${base}/login`);
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
        .click();
      assert.equal(
        await form.locator("#password").getAttribute("type"),
        "text",
      );
      assert.equal(await form.locator("#password").inputValue(), "");
      await form
        .getByRole("button", { name: "Hide password", exact: true })
        .click();
      assert.equal(
        await form.locator("#password").getAttribute("type"),
        "password",
      );
      await form.locator("#email").fill(qa.accounts.staff.email);
      await form.locator("#password").fill(qa.accounts.staff.password);
      const response = page!.waitForResponse(
        (r) =>
          r.url() === `${base}/api/v1/auth/login` &&
          r.request().method() === "POST",
      );
      loginAttempted = true;
      await form.getByRole("button", { name: "Sign in", exact: true }).click();
      assert.equal((await response).status(), 200);
      await page!
        .getByRole("button", { name: "Sign out", exact: true })
        .waitFor();
    },
  );

  await check(
    "04 Staff task cards and mobile page picker reach working pages",
    async () => {
      await page!.locator(".workspace-welcome").waitFor();
      assert.equal(await page!.locator(".workspace-task").count(), 3);
      assert.equal(await page!.locator("#workspace-jump").isVisible(), true);
      await mobileLayout();
      await screenshot(
        ".workspace-welcome",
        "usability-live-workspace-home-en.png",
      );
      await page!
        .locator(".workspace-welcome")
        .getByRole("button", { name: /Start an application/ })
        .click();
      await page!
        .getByRole("heading", { name: "Service catalog", exact: true })
        .waitFor();
      await page!.locator("#intake-heading").waitFor();
      assert.equal(
        await page!.getByTestId("service-application-form").count(),
        0,
      );
      await page!.locator("#workspace-jump").selectOption("home");
      await page!.locator(".workspace-welcome").waitFor();
      await page!.locator("#workspace-jump").selectOption("applications");
      await page!.getByLabel("Search applications", { exact: true }).waitFor();
    },
  );

  await check(
    "05 Empty application search clears back to existing records",
    async () => {
      await page!.locator("table tbody tr").first().waitFor();
      await page!
        .getByLabel("Search applications", { exact: true })
        .fill(`usability-no-such-record-${Date.now()}`);
      await page!
        .getByRole("heading", { name: "No matching applications", exact: true })
        .waitFor();
      assert.equal(await page!.locator("table tbody tr").count(), 0);
      await page!
        .getByRole("button", { name: "Clear filters", exact: true })
        .click();
      await page!.locator("table tbody tr").first().waitFor();
      assert.equal(await page!.locator("#application-search").inputValue(), "");
      assert.equal(await page!.locator("#state-filter").inputValue(), "");
      await mobileLayout();
    },
  );

  await check(
    "06 Exact reference shows approved fee hold without staff issuance authority",
    async () => {
      await page!
        .getByLabel("Find application or certificate", { exact: true })
        .fill(qa.applications.positive);
      const detailResponse = page!.waitForResponse(
        (response) =>
          response.url() ===
            `${base}/api/v1/applications/${qa.applications.positive}` &&
          response.request().method() === "GET",
      );
      await page!
        .getByRole("button", { name: "Find record", exact: true })
        .click();
      const response = await detailResponse;
      assert.equal(response.status(), 200);
      const detail = await response.json();
      assert.equal((detail.application || detail).state, "APPROVED");
      assert.ok(detail.order.totalMinor > 0);
      assert.notEqual(detail.order.paymentStatus, "COLLECTED");
      const guidance = page!.locator(".application-guidance");
      await guidance
        .getByRole("heading", { name: "What happens next", exact: true })
        .waitFor();
      assert.equal(
        await guidance.getAttribute("data-guidance-state"),
        "APPROVED",
      );
      assert.match(
        await guidance.innerText(),
        /Certificate issuance requires server-verified fee payment/,
      );
      assert.equal(
        await guidance.locator('a[href="#application-actions"]').count(),
        0,
      );
      assert.equal(
        await page!
          .getByRole("button", {
            name: /^Approve application$|^Issue demo certificate|^Retry issuance safely$/,
          })
          .count(),
        0,
      );
      const unavailable = page!.getByRole("button", {
        name: "bKash setup required",
        exact: true,
      });
      await unavailable.waitFor();
      assert.equal(await unavailable.isDisabled(), true);
      assert.equal(
        await page!
          .getByRole("link", { name: "Open receipt PDF", exact: true })
          .count(),
        0,
      );
      await screenshot(
        ".application-guidance",
        "usability-live-guidance-en.png",
      );
    },
  );

  await check(
    "07 Bangla and English mobile guidance retains the same application",
    async () => {
      await page!.getByRole("button", { name: "বাংলা", exact: true }).click();
      await page!
        .locator(".application-guidance")
        .getByRole("heading", { name: "এরপর কী করবেন", exact: true })
        .waitFor();
      assert.match(
        await page!.locator(".application-guidance").innerText(),
        /পরিশোধ সার্ভারে যাচাই হতে হবে/,
      );
      assert.equal(
        await page!.locator("#application-reference").inputValue(),
        qa.applications.positive,
      );
      await mobileLayout();
      await screenshot(
        ".application-guidance",
        "usability-live-guidance-bn.png",
      );
      await page!.getByRole("button", { name: "English", exact: true }).click();
      await page!
        .locator(".application-guidance")
        .getByRole("heading", { name: "What happens next", exact: true })
        .waitFor();
      await mobileLayout();
    },
  );

  await check(
    "08 Sign-out clears credentials with no page errors or unintended mutations",
    async () => {
      const response = page!.waitForResponse(
        (r) =>
          r.url() === `${base}/api/v1/auth/logout` &&
          r.request().method() === "POST",
      );
      await page!
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      assert.equal((await response).status(), 200);
      await page!.locator(".login-form").waitFor();
      signedOut = true;
      assert.equal(await page!.locator(".login-form #email").inputValue(), "");
      assert.equal(
        await page!.locator(".login-form #password").inputValue(),
        "",
      );
      assert.equal(
        await page!.locator(".login-form #password").getAttribute("type"),
        "password",
      );
      assert.equal(pageErrors, 0);
      assert.equal(blockedMutations, 0);
    },
  );
  evidence.status = "PASS";
  console.log(`PASS: ${evidence.checks.length} hosted usability groups.`);
} catch {
  evidence.status = "FAIL";
  evidence.failedStage = stage;
  console.error(
    `Hosted usability verification failed at ${stage}; private values and stack withheld.`,
  );
  process.exitCode = 1;
} finally {
  // A failed UI assertion must not leave the QA session logged in indefinitely.
  if (loginAttempted && !signedOut && context && base) {
    try {
      const sessionResponse = await context.request.get(
        `${base}/api/v1/auth/me`,
        { timeout: 15000 },
      );
      if (sessionResponse.status() === 401) {
        signedOut = true;
      } else {
        assert.equal(sessionResponse.status(), 200);
        const session = await sessionResponse.json();
        assert.equal(typeof session.csrfToken, "string");
        const logout = await context.request.post(
          `${base}/api/v1/auth/logout`,
          {
            timeout: 15000,
            headers: { Origin: base, "X-CSRF-Token": session.csrfToken },
          },
        );
        signedOut = logout.ok();
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
    console.error(
      "QA session cleanup could not be confirmed; no session values printed.",
    );
  }
  await browser?.close();
  evidence.pageErrors = pageErrors;
  evidence.blockedMutations = blockedMutations;
  evidence.finishedAt = new Date().toISOString();
  save();
}
