import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const origin = process.env.ATTACHMENT_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const handle = {
  attachmentId: "11111111-1111-4111-8111-111111111111",
  mimeType: "application/pdf",
  byteLength: 16,
};
const statusUrl = `**/api/v1/attachments/${handle.attachmentId}/status`;
const metadata = (scanState = "QUARANTINED", extra = {}) => ({
  ...handle,
  scanState,
  downloadAllowed: scanState === "CLEAN",
  retryAllowed: false,
  retryAfter: null,
  reasonCode: null,
  scannedAt: null,
  scannerAvailable: false,
  ...extra,
});
let browser: Browser;
test.before(async () => {
  const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((name) => /^chromium-/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
      .find((name) => fs.existsSync(name));
  browser = await chromium.launch({ headless: true, executablePath });
});
test.after(async () => browser?.close());
async function open(page: Page, query = "") {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ json: { csrfToken: "attachment-test-csrf" } }),
  );
  await page.route("**/__attachment-component?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/test/fixtures/attachment-harness.tsx"></script></body></html>',
    }),
  );
  await page.goto(`${origin}/__attachment-component?${query}`);
}
async function refresh(page: Page) {
  const response = page.waitForResponse(statusUrl);
  await page
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await response;
  await page
    .getByTestId("attachment-status")
    .locator('[role="status"]')
    .waitFor();
}
async function noDownload(page: Page) {
  assert.equal(
    await page
      .getByRole("link", { name: "Download document", exact: true })
      .count(),
    0,
  );
}

test("attachment UI: pending offline, scanning, clean, rejection and unknown states fail closed in both languages", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  let body = metadata();
  await page.route(statusUrl, (route) => route.fulfill({ json: body }));
  try {
    await open(page);
    await page.getByText("Waiting for safety check", { exact: true }).waitFor();
    await page.getByText(/Waiting for the scanner/).waitFor();
    await noDownload(page);
    await page.getByRole("button", { name: "বাংলা", exact: true }).click();
    await page.getByText("পরীক্ষার অপেক্ষায়", { exact: true }).waitFor();
    await page.getByRole("button", { name: "English", exact: true }).click();
    body = metadata("SCANNING", { scannerAvailable: true });
    await refresh(page);
    await page.getByText("Safety check in progress", { exact: true }).waitFor();
    await noDownload(page);
    body = metadata("CLEAN", { downloadAllowed: false });
    await refresh(page);
    await page.getByText("No threat detected", { exact: true }).waitFor();
    await noDownload(page);
    body = metadata("CLEAN");
    await refresh(page);
    const download = page.getByRole("link", {
      name: "Download document",
      exact: true,
    });
    await download.waitFor();
    assert.equal(
      await download.getAttribute("href"),
      `/api/v1/attachments/${handle.attachmentId}`,
    );
    body = metadata("UNSCANNED", { downloadAllowed: true });
    await refresh(page);
    await page.getByText("Not yet checked", { exact: true }).waitFor();
    await noDownload(page);
    body = metadata("FUTURE_UNKNOWN", { downloadAllowed: true });
    await refresh(page);
    await page.getByText("Not yet checked", { exact: true }).waitFor();
    await noDownload(page);
    body = metadata("REJECTED");
    await refresh(page);
    await page.getByText("Document rejected", { exact: true }).waitFor();
    await noDownload(page);
    await page.getByRole("button", { name: "বাংলা", exact: true }).click();
    await page.getByText("নথিটি গ্রহণ করা হয়নি", { exact: true }).waitFor();
  } finally {
    await page.close();
  }
});

test("attachment UI: retry is explicit, CSRF protected and gated by server permission and cooldown", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  let body = metadata("ERROR");
  let retries = 0;
  await page.route(statusUrl, (route) => route.fulfill({ json: body }));
  await page.route(
    `**/api/v1/attachments/${handle.attachmentId}/retry`,
    async (route) => {
      retries += 1;
      assert.equal(route.request().method(), "POST");
      assert.deepEqual(route.request().postDataJSON(), {});
      assert.equal(
        route.request().headers()["x-csrf-token"],
        "attachment-test-csrf",
      );
      body = metadata();
      await route.fulfill({ json: body });
    },
  );
  try {
    await open(page);
    await page.getByText("Safety check incomplete", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Retry safety check" }).count(),
      0,
    );
    body = metadata("ERROR", {
      retryAllowed: true,
      retryAfter: new Date(Date.now() + 3600000).toISOString(),
    });
    await refresh(page);
    const retry = page.getByRole("button", {
      name: "Retry safety check",
      exact: true,
    });
    await retry.waitFor();
    assert.equal(await retry.isDisabled(), true);
    assert.equal(retries, 0);
    body = metadata("ERROR", { retryAllowed: true });
    await refresh(page);
    await retry.click();
    await page.getByText("Waiting for safety check", { exact: true }).waitFor();
    assert.equal(retries, 1);
    await noDownload(page);
  } finally {
    await page.close();
  }
});

test("attachment UI: metadata identity mismatch and authorization loss remove download access", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  let body = metadata("CLEAN");
  let status = 200;
  let requests = 0;
  await page.route(statusUrl, (route) => {
    requests += 1;
    return route.fulfill({ status, json: body });
  });
  try {
    await page.clock.install();
    await open(page);
    await page.getByRole("link", { name: "Download document" }).waitFor();
    body = metadata("CLEAN", {
      attachmentId: "33333333-3333-4333-8333-333333333333",
    });
    await refresh(page);
    await page
      .getByText("Safety status unavailable", { exact: true })
      .waitFor();
    await noDownload(page);
    body = metadata();
    status = 403;
    await refresh(page);
    await page.getByRole("alert").waitFor();
    const before = requests;
    await page.clock.runFor(65000);
    assert.equal(
      requests,
      before,
      "Authorization failure must stop automatic requests",
    );
  } finally {
    await page.close();
  }
});

test("attachment UI: automatic polling is bounded, paused while hidden and cancelled on unmount", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  let requests = 0;
  await page.route(statusUrl, (route) => {
    requests += 1;
    return route.fulfill({ json: metadata() });
  });
  try {
    await page.clock.install();
    await open(page);
    await page.getByText("Waiting for safety check", { exact: true }).waitFor();
    assert.equal(requests, 1);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(15000);
    assert.equal(requests, 1);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="attachment-status"]')
          ?.getAttribute("aria-busy") === "false",
    );
    for (let index = 0; index < 12; index++) {
      await page.clock.runFor(5100);
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="attachment-status"]')
            ?.getAttribute("aria-busy") === "false",
      );
    }
    await page.getByText(/Automatic checks have paused/).waitFor();
    assert.equal(requests, 12);
    await page.clock.runFor(65000);
    assert.equal(requests, 12);
    await refresh(page);
    assert.equal(requests, 13);
    await page.getByRole("button", { name: "Unmount", exact: true }).click();
    await page.clock.runFor(65000);
    assert.equal(requests, 13);
  } finally {
    await page.close();
  }
});

test("attachment form: pending upload stores only the handle, keeps intervening edits and never enables download", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const upload = {
    ...handle,
    byteLength: 16,
    scanState: "QUARANTINED",
    downloadAllowed: false,
  };
  await page.route("**/api/v1/attachments", async (route) => {
    await held;
    await route.fulfill({ status: 201, json: upload });
  });
  await page.route(statusUrl, (route) => route.fulfill({ json: metadata() }));
  try {
    await open(page, "mode=form");
    const request = page.waitForRequest("**/api/v1/attachments");
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "synthetic.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 sample!"),
      });
    await request;
    await page
      .getByLabel("Document description", { exact: false })
      .fill("Edited during upload");
    release();
    await page.getByText("Waiting for safety check", { exact: true }).waitFor();
    const value = JSON.parse(await page.getByTestId("value").innerText());
    assert.deepEqual(value.attachments[0].file, handle);
    assert.equal(value.attachments[0].description, "Edited during upload");
    await noDownload(page);
  } finally {
    release();
    await page.close();
  }
});

test("attachment form: late upload cannot update another application for the same citizen and service", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/attachments", async (route) => {
    await held;
    await route.fulfill({
      status: 201,
      json: { ...handle, scanState: "QUARANTINED" },
    });
  });
  try {
    await open(page, "mode=form");
    const request = page.waitForRequest("**/api/v1/attachments");
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "synthetic.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 sample!"),
      });
    await request;
    await page
      .getByRole("button", { name: "Switch application", exact: true })
      .click();
    const response = page.waitForResponse("**/api/v1/attachments");
    release();
    await response;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.getByTestId("changes").innerText(), "0");
    assert.equal(
      JSON.parse(await page.getByTestId("value").innerText()).attachments[0]
        .file,
      undefined,
    );
    assert.equal(
      await page.getByTestId("context").innerText(),
      "second-application",
    );
    assert.equal(await page.getByTestId("attachment-status").count(), 0);
  } finally {
    release();
    await page.close();
  }
});

test("attachment form: readonly nested documents keep refresh usable and reject replacement", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  await page.route(statusUrl, (route) =>
    route.fulfill({ json: metadata("REJECTED") }),
  );
  try {
    await open(page, "mode=form&existing=1&readonly=1");
    await page.getByText("Document rejected", { exact: true }).waitFor();
    await page.getByText(/must be returned for correction/).waitFor();
    assert.equal(await page.locator('input[type="file"]').isDisabled(), true);
    assert.equal(
      await page
        .getByRole("button", { name: "Choose a replacement", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Refresh status", exact: true })
        .isEnabled(),
      true,
    );
    await refresh(page);
    assert.equal(await page.getByTestId("changes").innerText(), "0");
  } finally {
    await page.close();
  }
});

test("attachment form: rejected document offers replacement, failed upload preserves the existing handle", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  await page.route(statusUrl, (route) =>
    route.fulfill({ json: metadata("REJECTED") }),
  );
  await page.route("**/api/v1/attachments", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Document upload failed." } },
    }),
  );
  try {
    await open(page, "mode=form&existing=1");
    await page.getByText("Document rejected", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Choose a replacement", exact: true })
      .click();
    assert.equal(
      await page
        .locator('input[type="file"]')
        .evaluate((input) => document.activeElement === input),
      true,
    );
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "synthetic.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 sample!"),
      });
    await page.getByRole("alert").waitFor();
    assert.deepEqual(
      JSON.parse(await page.getByTestId("value").innerText()).attachments[0]
        .file,
      handle,
    );
    assert.equal(await page.getByTestId("changes").innerText(), "0");
    await noDownload(page);
  } finally {
    await page.close();
  }
});

test("attachment UI: late clean metadata after navigation cannot resurrect a download", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(statusUrl, async (route) => {
    await held;
    await route.fulfill({ json: metadata("CLEAN") }).catch(() => {});
  });
  try {
    const request = page.waitForRequest(statusUrl);
    await open(page);
    await request;
    await page.getByRole("button", { name: "Unmount", exact: true }).click();
    release();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await noDownload(page);
    assert.equal(await page.getByTestId("attachment-status").count(), 0);
  } finally {
    release();
    await page.close();
  }
});
