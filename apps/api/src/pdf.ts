import { chromium, type Browser } from "playwright";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { ApiError } from "./models.js";
import {
  renderCertificateHtml,
  DEMO_TEMPLATE_VERSION,
  type PdfInput,
} from "./certificate-template.js";
export {
  renderCertificateHtml,
  DEMO_TEMPLATE_VERSION,
  type PdfInput,
} from "./certificate-template.js";
let browserPromise: Promise<Browser> | undefined;
let activeRenders = 0;
const renderLimit = Number(process.env.PDF_MAX_CONCURRENCY ?? 4);
if (!Number.isInteger(renderLimit) || renderLimit < 1 || renderLimit > 4)
  throw new Error("PDF_MAX_CONCURRENCY must be an integer between 1 and 4.");
const waitingRenders: Array<() => void> = [];
async function acquireRenderer() {
  if (activeRenders < renderLimit) {
    activeRenders++;
    return;
  }
  if (waitingRenders.length >= 32)
    throw new ApiError(
      503,
      "PDF_BUSY",
      "The document renderer is busy. Please retry shortly.",
    );
  await new Promise<void>((resolve) => waitingRenders.push(resolve));
}
function releaseRenderer() {
  const next = waitingRenders.shift();
  if (next) next();
  else {
    activeRenders--;
    if (activeRenders === 0) closeBrowserWhenIdle();
  }
}
/**
 * Constrained-host profile (cPanel/CloudLinux LVE): an idle Chromium holds
 * ~250 MB and 5+ processes against the account limit around the clock, and
 * its renderer children are the first processes killed when the limit is
 * hit. So the browser is closed as soon as the render queue drains; the
 * next render relaunches it. The promise is detached synchronously so a
 * render starting during the close gets a fresh launch, never the closing
 * browser.
 */
function closeBrowserWhenIdle() {
  const pending = browserPromise;
  if (!pending) return;
  browserPromise = undefined;
  void pending
    .then((instance) => instance.close())
    .catch(() => undefined);
}
async function browser() {
  if (!browserPromise) {
    const local = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "ms-playwright")
      : "";
    const executable =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      (fs.existsSync(local)
        ? fs
            .readdirSync(local)
            .filter((n) => /^chromium-/.test(n))
            .sort()
            .reverse()
            .map((n) => path.join(local, n, "chrome-win64", "chrome.exe"))
            .find((p) => fs.existsSync(p))
        : undefined);
    browserPromise = chromium
      .launch({
        headless: true,
        executablePath: executable,
        // Light mode for resource-limited shared hosting (CloudLinux LVE):
        // one process instead of 5+, no zygote/GPU children, small footprint.
        args: [
          "--single-process",
          "--no-zygote",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-sandbox",
        ],
      })
      .then((instance) => {
        instance.once("disconnected", () => {
          browserPromise = undefined;
        });
        return instance;
      })
      .catch((error) => {
        browserPromise = undefined;
        throw error;
      });
  }
  return browserPromise;
}
export async function closePdfBrowser() {
  if (browserPromise) {
    await (await browserPromise).close();
    browserPromise = undefined;
  }
}
export async function generatePdf(
  input: PdfInput,
  version: number = DEMO_TEMPLATE_VERSION,
): Promise<Buffer> {
  const qr = await QRCode.toDataURL(input.verificationUrl, {
    width: 180,
    errorCorrectionLevel: "M",
    margin: 2,
  });
  return renderHtmlPdf(renderCertificateHtml(input, qr, version));
}
/** Render only escaped, application-owned HTML; remote network resources are blocked. */
export async function renderHtmlPdf(html: string): Promise<Buffer> {
  await acquireRenderer();
  let page: import("playwright").Page | undefined;
  try {
    page = await (await browser()).newPage();
    await page.route("**/*", (route) =>
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    await page.setContent(html, {
      waitUntil: "load",
      timeout: 15000,
    });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({
      format: "A4",
      // Phase Y: page size/orientation is per-service template data (@page in
      // the document); the CSS size wins, A4 stays the fallback for documents
      // that declare none.
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
    });
  } finally {
    try {
      await page?.close();
    } finally {
      releaseRenderer();
    }
  }
}
