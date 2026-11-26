import test from "node:test";
import assert from "node:assert/strict";
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
  "M-003: a transient chunk failure is retried automatically and the guide loads",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      // Fail only the FIRST fetch of the UserGuide chunk; the lazy
      // import's automatic retry must fetch it again and succeed.
      let chunkRequests = 0;
      await page.route("**/*UserGuide*", (route) => {
        chunkRequests += 1;
        if (chunkRequests === 1) void route.abort();
        else void route.continue();
      });
      await page.goto(`${origin}/guide`);
      await page.getByRole("heading", { name: "DigitalUnion user guide", exact: true }).waitFor({ timeout: 30000 });
      assert.ok(chunkRequests >= 2, `chunk was retried: ${chunkRequests} request(s)`);
      assert.equal(await page.getByText("This section could not load").count(), 0, "no error panel for a transient failure");
      assert.deepEqual(errors, [], `no page errors: ${JSON.stringify(errors)}`);
    } finally {
      await browser.close();
    }
  },
);

test(
  "M-003: a persistent chunk failure shows a descriptive error with a working Try again",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const chunkPattern = "**/*UserGuide*";
    try {
      await page.route(chunkPattern, (route) => route.abort());
      await page.goto(`${origin}/guide`);
      // The failure degrades to the AsyncPanel message — never a blank
      // page or a bare console error.
      await page.getByText("This section could not load").waitFor({ timeout: 30000 });
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      await retry.waitFor();
      await page.getByRole("button", { name: "Reload page", exact: true }).waitFor();
      assert.deepEqual(errors, [], `no bare page errors: ${JSON.stringify(errors)}`);

      // Unblock the chunk and retry IN PLACE: the guide loads with no
      // full-page reload.
      await page.unroute(chunkPattern);
      await page.evaluate(() => { (window as any).__m003NoReload = 1; });
      await retry.click();
      await page.getByRole("heading", { name: "DigitalUnion user guide", exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await page.getByText("This section could not load").count(), 0, "error panel clears after retry");
      assert.equal(await page.evaluate(() => (window as any).__m003NoReload), 1, "retry did not reload the page");
      assert.deepEqual(errors, [], `no page errors after retry: ${JSON.stringify(errors)}`);
    } finally {
      await browser.close();
    }
  },
);
