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
/**
 * Light mode is OPT-IN via PDF_LIGHT_MODE=1 and exists only for
 * resource-limited shared hosting (cPanel/CloudLinux LVE). It must stay
 * off everywhere else: the lean launch args include --single-process,
 * and a single-process Chromium dies under concurrent page creation
 * ("browser.newPage: Target page, context or browser has been closed"),
 * which broke concurrent issuance in CI (PR #50, runs #196/#197:
 * CER-01/CER-02/WAL-01/WAL-02, CER-03/PUB-02, FOR-03, PAY-06). With the
 * flag off this module behaves exactly as it did before light mode
 * existed; with it on, renders are forced to one at a time and each
 * render launches (and closes) its own browser — see renderHtmlPdf.
 */
const lightMode = process.env.PDF_LIGHT_MODE === "1";
/**
 * Security Audit 01, F3: Chromium's OS-level sandbox is off today (Playwright's
 * default, plus an explicit --no-sandbox in light mode) because the cPanel host
 * was never verified to allow it. PDF_CHROMIUM_SANDBOX=1 opts in: the launch
 * then requests the sandbox and light mode drops its --no-sandbox arg. The
 * default (unset) preserves the exact pre-hardening launch behaviour; enabling
 * it is a deploy-time decision made only after the host proves Chromium starts
 * with the sandbox on (see .env.cpanel.example). The renderer's other defences
 * (server-escaped HTML, every non-data: request aborted) apply either way.
 */
const chromiumSandbox = process.env.PDF_CHROMIUM_SANDBOX === "1";
const configuredRenderLimit = Number(process.env.PDF_MAX_CONCURRENCY ?? 4);
if (
  !Number.isInteger(configuredRenderLimit) ||
  configuredRenderLimit < 1 ||
  configuredRenderLimit > 4
)
  throw new Error("PDF_MAX_CONCURRENCY must be an integer between 1 and 4.");
const renderLimit = lightMode ? 1 : configuredRenderLimit;
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
  else activeRenders--;
}
async function launchBrowser(): Promise<Browser> {
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
  return chromium.launch({
    headless: true,
    executablePath: executable,
    // F3: only present when PDF_CHROMIUM_SANDBOX=1; omitted otherwise so the
    // launch options are byte-identical to the pre-hardening behaviour.
    ...(chromiumSandbox ? { chromiumSandbox: true } : {}),
    // Light mode only (PDF_LIGHT_MODE=1, see above): one process instead
    // of 5+, no zygote/GPU children, small footprint. --no-sandbox is part
    // of that profile only while the F3 opt-in is off: passing it alongside
    // chromiumSandbox:true would defeat the sandbox again.
    ...(lightMode
      ? {
          args: [
            "--single-process",
            "--no-zygote",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            ...(chromiumSandbox ? [] : ["--no-sandbox"]),
          ],
        }
      : {}),
  });
}
async function browser() {
  if (!browserPromise) {
    browserPromise = launchBrowser()
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
  // Light mode never shares a browser: a single-process Chromium kept
  // alive across renders dies after a couple of rapid page turnovers
  // (verified locally — queued renders fail at newPage even when the
  // semaphore serialises them), while a fresh browser per render is
  // stable. It also means zero Chromium processes exist between renders,
  // which is the point of the LVE profile. The render limit is forced
  // to 1 in light mode, so per-render browsers never multiply.
  let ownBrowser: Browser | undefined;
  try {
    const instance = lightMode
      ? (ownBrowser = await launchBrowser())
      : await browser();
    page = await instance.newPage();
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
      try {
        await ownBrowser?.close();
      } finally {
        releaseRenderer();
      }
    }
  }
}
