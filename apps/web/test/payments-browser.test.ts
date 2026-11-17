import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { getDemoPayload } from "@astra/shared-schemas";

const origin = "http://127.0.0.1:5173";
const password = "Payment-browser-2026!";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const email = (role: string) => `payment-${role}-${runId}@example.test`;
const geography = {
  divisionCode: "div-02",
  districtCode: "dis-19",
  upazilaCode: "upa-089",
  unionCode: "uni-0001",
  wardCode: "uni-0001-w01",
};
let browser: Browser, applicationId: string;
async function request(
  page: Page,
  route: string,
  method = "GET",
  data?: unknown,
) {
  const session = await (
    await page.request.get(`${origin}/api/v1/auth/me`)
  ).json();
  const response = await page.request.fetch(`${origin}/api/v1${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken || "",
    },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), data: await response.json() };
}
async function apiLogin(page: Page, role: string) {
  const response = await page.request.post(`${origin}/api/v1/auth/login`, {
    data: {
      email: role === "owner" ? "owner@astra.demo.test" : email(role),
      password: role === "owner" ? "Demo-Phase1!" : password,
    },
  });
  assert.equal(response.status(), 200, await response.text());
}
async function login(page: Page, role: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email(role));
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name, exact: true })
    .click();
}
before(async () => {
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((name) => /^chromium-/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
      .find((name) => fs.existsSync(name));
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext(),
    setup = await context.newPage();
  await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  try {
    await apiLogin(setup, "owner");
    const office = await request(setup, "/owner/tenants", "POST", {
      slug: `payment-browser-${runId}`,
      nameBn: "পেমেন্ট পরীক্ষার অফিস",
      nameEn: `Payment Browser Office ${runId}`,
      officeType: "UNION",
      geography: { ...geography, wardCode: undefined },
      adminEmail: email("admin"),
      adminName: "Synthetic Payment Admin",
      adminPassword: password,
    });
    assert.equal(office.status, 201, JSON.stringify(office.data));
    await apiLogin(setup, "admin");
    for (const role of ["staff", "reviewer", "approver", "finance"]) {
      const user = await request(setup, "/admin/users", "POST", {
        email: email(role),
        displayName: `Payment Browser ${role}`,
        password,
        role,
      });
      assert.equal(user.status, 201, JSON.stringify(user.data));
      if (role === "approver") {
        const grant = await request(
          setup,
          `/admin/authorizations/${user.data.id}/45`,
          "PUT",
          {
            active: true,
            authorityNote: "Synthetic payment browser test approval grant",
          },
        );
        assert.equal(grant.status, 200, JSON.stringify(grant.data));
      }
    }
    const policy = await request(
      setup,
      "/admin/services/45/order-policies",
      "POST",
      {
        expectedVersion: 0,
        reason: "Synthetic payment test policy, not official tariffs",
        statutoryFeeMinor: 10000,
        processingFeeMinor: 1575,
        emergencySurchargeMinor: 0,
        deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
        deliveryModes: ["office_collection"],
        urgencies: ["normal"],
      },
    );
    assert.equal(policy.status, 201, JSON.stringify(policy.data));
    const signup = await setup.request.post(`${origin}/api/v1/auth/signup`, {
      data: {
        email: email("citizen"),
        password,
        displayName: "Synthetic Payment Citizen",
        tenantId: office.data.id,
        nameBn: "পেমেন্ট পরীক্ষার নাগরিক",
        nameEn: "Synthetic Payment Citizen",
        dateOfBirth: "1991-01-02",
        addressBn: "পরীক্ষার গ্রাম",
        addressEn: "Synthetic Payment Village",
        geography,
      },
    });
    assert.equal(signup.status(), 201, await signup.text());
    await apiLogin(setup, "citizen");
    const citizens = await request(setup, "/citizens");
    const created = await request(setup, "/applications", "POST", {
      citizenId: citizens.data.items[0].id,
      serviceNo: 45,
      payload: { ...getDemoPayload(45), delivery_language: "en" },
      order: {
        policyVersion: 1,
        preferences: {
          addressBasis: "registered_profile",
          certificateLanguage: "en",
          deliveryMode: "office_collection",
          urgency: "normal",
        },
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    applicationId = created.data.id;
    // Phase W: no secretary review; the Chairman's approve attempts issuance
    // and is held by the unpaid order (402) with the approval recorded.
    for (const [role, action] of [
      ["citizen", "submit"],
      ["approver", "approve"],
    ]) {
      await apiLogin(setup, role);
      const transitioned = await request(
        setup,
        `/applications/${applicationId}/transition`,
        "POST",
        { action },
      );
      if (action === "approve") {
        assert.ok(
          transitioned.status === 200 || transitioned.status === 402,
          JSON.stringify(transitioned.data),
        );
        if (transitioned.status === 402)
          assert.equal(transitioned.data.error.code, "ORDER_PAYMENT_REQUIRED");
      } else {
        assert.equal(transitioned.status, 200, JSON.stringify(transitioned.data));
      }
    }
  } finally {
    await context.close();
  }
});
after(async () => {
  await browser?.close();
});

test(
  "payments browser: later mismatch preserves receipt, exposes recovery and remains visible to finance",
  { timeout: 90000 },
  async () => {
    const citizenContext = await browser.newContext(),
      financeContext = await browser.newContext();
    await citizenContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const citizen = await citizenContext.newPage(),
      finance = await financeContext.newPage();
      await financeContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    await citizenContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const id = crypto.randomUUID(),
      receiptId = crypto.randomUUID();
    const receipt = {
      id: receiptId,
      receiptNumber: "TEST-UI-IMMUTABLE-RECEIPT",
      applicationId,
      paymentId: id,
      amountMinor: 11575,
      currency: "BDT",
      environment: "SANDBOX",
      transactionId: "UI-HISTORY-ONLY",
      issuedAt: new Date().toISOString(),
    };
    const makeAttempt = (matched = false) => ({
      id,
      applicationId,
      provider: "BKASH",
      environment: "SANDBOX",
      status: "PAID",
      amountMinor: 11575,
      currency: "BDT",
      invoice: "UI-HISTORY-INVOICE",
      checkoutUrl: null,
      lastError: null,
      createdAt: receipt.issuedAt,
      updatedAt: receipt.issuedAt,
      receiptId,
      paymentStatus: matched ? "COLLECTED" : "REVIEW_REQUIRED",
      lastReconciliation: {
        result: matched ? "MATCHED" : "MISMATCH",
        reason: matched
          ? "PROVIDER_TRANSACTION_MATCHED"
          : "GATEWAY_TRANSACTION_MISMATCH",
        checkedAt: receipt.issuedAt,
      },
    });
    const availability = {
      provider: "BKASH",
      environment: "SANDBOX",
      configured: true,
      available: true,
      reason: "TEST_TRANSPORT",
      bankSettlement: "NOT_CONNECTED",
      nagad: { configured: false, reason: "NOT_INTEGRATED" },
    };
    let recovered = false;
    try {
      await login(citizen, "citizen");
      // UI-only historical-record fixture; API tests separately exercise real immutable receipt storage.
      await citizen.route(
        `**/api/v1/applications/${applicationId}/payment`,
        async (route) => {
          const response = await route.fetch(),
            body = await response.json();
          await route.fulfill({
            response,
            json: {
              ...body,
              eligible: false,
              availability,
              paymentStatus: recovered ? "COLLECTED" : "REVIEW_REQUIRED",
              receipt,
              attempt: makeAttempt(recovered),
            },
          });
        },
      );
      await citizen.route(
        `**/api/v1/payments/${id}/reconcile`,
        async (route) => {
          recovered = true;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              attempt: makeAttempt(true),
              receipt,
              reconciliation: {
                id: crypto.randomUUID(),
                result: "MATCHED",
                reason: "PROVIDER_TRANSACTION_MATCHED",
                checkedAt: receipt.issuedAt,
                bankSettlement: "NOT_CONNECTED",
              },
            }),
          });
        },
      );
      await citizen.goto(
        `${origin}/payments/return?applicationId=${applicationId}`,
      );
      const card = citizen.getByRole("region", {
        name: "Online fee payment",
        exact: true,
      });
      await card
        .getByText("TEST-UI-IMMUTABLE-RECEIPT", { exact: true })
        .waitFor();
      assert.match(
        await card.innerText(),
        /original receipt is preserved, but new certificate issuance is on hold/,
      );
      const originalHref = await card
        .getByRole("link", { name: "Open receipt PDF", exact: true })
        .getAttribute("href");
      await card
        .getByRole("button", { name: "Check gateway status", exact: true })
        .click();
      await card.getByText("Payment verified", { exact: true }).waitFor();
      assert.equal(
        await card
          .getByRole("link", { name: "Open receipt PDF", exact: true })
          .getAttribute("href"),
        originalHref,
      );
      assert.doesNotMatch(
        await card.innerText(),
        /new certificate issuance is on hold/,
      );
      await login(finance, "finance");
      await finance.route("**/api/v1/payments/configuration", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(availability),
        });
      });
      await finance.route(
        (url) => url.pathname === "/api/v1/payments",
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              items: [
                {
                  ...makeAttempt(false),
                  applicantName: "Synthetic Payment Citizen",
                  serviceNo: 45,
                },
              ],
              page: 1,
              pageSize: 20,
              total: 1,
            }),
          });
        },
      );
      await finance.route(
        `**/api/v1/payments/${id}/reconcile`,
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              attempt: makeAttempt(false),
              receipt,
              reconciliation: {
                id: crypto.randomUUID(),
                result: "MISMATCH",
                reason: "GATEWAY_TRANSACTION_MISMATCH",
                checkedAt: receipt.issuedAt,
                bankSettlement: "NOT_CONNECTED",
              },
            }),
          });
        },
      );
      await nav(finance, "Payments and receipts");
      await finance
        .getByText("New issuance on hold", { exact: true })
        .waitFor();
      await finance
        .getByRole("button", { name: "Check gateway status", exact: true })
        .click();
      await finance
        .getByText(
          "Gateway records did not match. New certificate issuance is held until a matching verification.",
          { exact: true },
        )
        .waitFor();
      await finance
        .getByText("New issuance on hold", { exact: true })
        .waitFor();
      assert.match(
        await finance.locator(".payments-workspace").innerText(),
        /Latest gateway check: Gateway record mismatch/,
      );
      await finance.getByRole("button", { name: "বাংলা", exact: true }).click();
      await finance
        .getByText("নতুন সনদ ইস্যু স্থগিত", { exact: true })
        .waitFor();
      assert.match(
        await finance.locator(".payments-workspace").innerText(),
        /লেনদেনের টাকা বা প্রাপকের তথ্যে অমিল আছে/,
      );
    } finally {
      await Promise.all([citizenContext.close(), financeContext.close()]);
    }
  },
);

test(
  "payments browser: late checkout response cannot redirect a departed application; ambiguous gateway failure stays uncertain",
  { timeout: 90000 },
  async () => {
    const context = await browser.newContext(),
      page = await context.newPage();
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    let releaseCheckout: (() => void) | undefined;
    let externalCheckoutRequests = 0;
    try {
      await login(page, "citizen");
      // Browser-only contract fixture: no public fake gateway route and no provider network call.
      await page.route(
        `**/api/v1/applications/${applicationId}/payment`,
        async (route) => {
          const response = await route.fetch(),
            body = await response.json();
          await route.fulfill({
            response,
            json: {
              ...body,
              eligible: true,
              availability: {
                ...body.availability,
                environment: "SANDBOX",
                configured: true,
                available: true,
              },
            },
          });
        },
      );
      await page.route(
        "https://sandbox.payment.bkash.com/**",
        async (route) => {
          externalCheckoutRequests++;
          await route.abort();
        },
      );
      let arrived!: () => void, completed!: () => void;
      const checkoutArrived = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseCheckout = resolve;
      });
      const checkoutCompleted = new Promise<void>((resolve) => {
        completed = resolve;
      });
      await page.route(
        `**/api/v1/applications/${applicationId}/payments`,
        async (route) => {
          arrived();
          await released;
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              attempt: {
                id: crypto.randomUUID(),
                applicationId,
                status: "READY",
                invoice: "UI-RACE-FIXTURE",
                checkoutUrl:
                  "https://sandbox.payment.bkash.com/?ui-race-fixture=true",
              },
              replayed: false,
            }),
          });
          completed();
        },
        { times: 1 },
      );
      await page.goto(
        `${origin}/payments/return?applicationId=${applicationId}`,
      );
      const checkoutResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/applications/${applicationId}/payments`) &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Pay with bKash", exact: true })
        .click();
      await checkoutArrived;
      await nav(page, "Service catalog");
      releaseCheckout!();
      await checkoutCompleted;
      await (await checkoutResponse).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      assert.equal(
        externalCheckoutRequests,
        0,
        "Old payment component must not redirect after navigation",
      );
      await page
        .getByRole("heading", { name: "Service catalog", exact: true })
        .waitFor();
      await page.route(
        `**/api/v1/applications/${applicationId}/payments`,
        async (route) => {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "GATEWAY_UNAVAILABLE",
                message: "Synthetic provider timeout",
              },
            }),
          });
        },
        { times: 1 },
      );
      await page.goto(
        `${origin}/payments/return?applicationId=${applicationId}`,
      );
      await page
        .getByRole("button", { name: "Pay with bKash", exact: true })
        .click();
      const alert = page
        .getByRole("region", { name: "Online fee payment" })
        .getByRole("alert");
      await alert.waitFor();
      assert.match(await alert.innerText(), /result could not be confirmed/);
      assert.doesNotMatch(
        await alert.innerText(),
        /merchant connection is configured/,
      );
    } finally {
      releaseCheckout?.();
      await context.close();
    }
  },
);

test(
  "payments browser: approved fee remains unpaid without merchant setup; forged return cannot show receipt; mobile Bangla persists",
  { timeout: 90000 },
  async () => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      page = await context.newPage();
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
      await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await login(page, "citizen");
      assert.equal(
        await page
          .getByRole("navigation", { name: "Workspace navigation" })
          .getByRole("button", { name: "Payments and receipts", exact: true })
          .count(),
        0,
      );
      // These query values are untrusted navigation inputs, never gateway payment proof.
      await page.goto(
        `${origin}/payments/return?applicationId=${applicationId}&attemptId=00000000-0000-4000-8000-000000000000&status=success&paymentID=fake`,
      );
      const card = page.getByRole("region", {
        name: "Online fee payment",
        exact: true,
      });
      await card.waitFor();
      await card.getByText("Not paid", { exact: true }).waitFor();
      assert.match(await card.innerText(), /115\.75/);
      assert.equal(
        await card
          .getByRole("button", { name: "bKash setup required", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await card
          .getByRole("link", { name: "Open receipt PDF", exact: true })
          .count(),
        0,
      );
      assert.match(await card.innerText(), /Nagad is not integrated/);
      assert.equal(
        await page.locator("input[name='pin'], input[name='otp']").count(),
        0,
      );
      const before = await request(
        page,
        `/applications/${applicationId}/payment`,
      );
      assert.equal(before.status, 200);
      assert.equal(before.data.paymentStatus, "NOT_COLLECTED");
      assert.equal(before.data.attempt, null);
      const disabled = await request(
        page,
        `/applications/${applicationId}/payments`,
        "POST",
        { provider: "BKASH", requestKey: crypto.randomUUID() },
      );
      assert.equal(disabled.status, 503, JSON.stringify(disabled.data));
      const afterAttempt = await request(
        page,
        `/applications/${applicationId}/payment`,
      );
      assert.equal(
        afterAttempt.data.attempt,
        null,
        "Unconfigured gateway must not create a financial attempt",
      );
      await page.getByRole("button", { name: "বাংলা", exact: true }).click();
      const banglaCard = page.getByRole("region", {
        name: "অনলাইন ফি পরিশোধ",
        exact: true,
      });
      await banglaCard.getByText("ফি পরিশোধ হয়নি", { exact: true }).waitFor();
      assert.equal(
        await page.locator(".notice.message").innerText(),
        "গেটওয়ে থেকে ফিরে এসেছেন। নিচে সার্ভারে যাচাইকৃত পেমেন্টের অবস্থা দেখুন।",
        "The gateway-return notice follows the current interface language",
      );
      assert.equal(
        await banglaCard
          .getByRole("button", { name: "bKash সেটআপ প্রয়োজন", exact: true })
          .isDisabled(),
        true,
      );
      assert.match(await banglaCard.innerText(), /Nagad সংযোগ এখনো নেই/);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({
        path: "execution/screenshots/payments-unconfigured-mobile-bn.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "English", exact: true }).click();
      assert.equal(
        await page.locator(".notice.message").innerText(),
        "You returned from the gateway. Check the server-verified payment status below.",
        "Switching back restores the English return notice without reloading",
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  },
);

test(
  "payments browser: finance has scoped gateway register and real empty reconciliation CSV; staff cannot open reconciliation",
  { timeout: 90000 },
  async () => {
    const financeContext = await browser.newContext(),
      staffContext = await browser.newContext();
    await financeContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const finance = await financeContext.newPage(),
      staff = await staffContext.newPage();
      await staff.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    await financeContext.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    for (const page of [finance, staff])
      page.on("pageerror", (error) => errors.push(error.message));
    try {
      await login(finance, "finance");
      const navigation = finance.getByRole("navigation", {
        name: "Workspace navigation",
      });
      assert.equal(
        await navigation
          .getByRole("button", { name: /Applications|Citizens/, exact: true })
          .count(),
        0,
      );
      await nav(finance, "Payments and receipts");
      await finance
        .getByRole("heading", { name: "Payment attempts", exact: true })
        .waitFor();
      await finance
        .getByText(
          "There are no payment attempts for the selected date and status.",
          { exact: true },
        )
        .waitFor();
      assert.match(
        await finance.locator(".payments-workspace").innerText(),
        /Merchant setup required/,
      );
      await finance
        .getByRole("tab", { name: "Gateway reconciliation", exact: true })
        .click();
      await finance
        .getByRole("heading", {
          name: "Gateway verification summary",
          exact: true,
        })
        .waitFor();
      assert.match(
        await finance.locator(".payments-workspace").innerText(),
        /Bank payouts and bank statement reconciliation are not connected/,
      );
      const date = await finance.locator("#payment-business-date").inputValue();
      const summary = await request(
        finance,
        `/payments/reconciliation?businessDate=${date}`,
      );
      assert.equal(summary.status, 200, JSON.stringify(summary.data));
      assert.equal(summary.data.totalCount, 0);
      assert.equal(summary.data.paidMinor, 0);
      const downloadPromise = finance.waitForEvent("download");
      await finance
        .getByRole("link", { name: "Download reconciliation CSV", exact: true })
        .click();
      const download = await downloadPromise;
      const downloaded = await download.path();
      assert.ok(downloaded);
      assert.ok(
        fs.readFileSync(downloaded!, "utf8").length > 20,
        "Export includes actual CSV columns even with no attempts",
      );
      await finance.getByRole("button", { name: "বাংলা", exact: true }).click();
      await finance
        .getByRole("heading", {
          name: "গেটওয়ে যাচাইয়ের সারসংক্ষেপ",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await finance.locator("#payment-business-date").inputValue(),
        date,
      );
      await finance.screenshot({
        path: "execution/screenshots/payments-reconciliation-bn.png",
        fullPage: true,
      });
      await login(staff, "staff");
      await nav(staff, "Payments and receipts");
      await staff
        .getByRole("heading", { name: "Payment attempts", exact: true })
        .waitFor();
      assert.equal(
        await staff
          .getByRole("tab", { name: "Gateway reconciliation", exact: true })
          .count(),
        0,
      );
      assert.equal(
        (await request(staff, `/payments/reconciliation?businessDate=${date}`))
          .status,
        403,
      );
      assert.deepEqual(errors, []);
    } finally {
      await Promise.all([financeContext.close(), staffContext.close()]);
    }
  },
);
