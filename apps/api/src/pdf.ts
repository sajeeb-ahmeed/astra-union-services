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
const chromiumSandbox = () => process.env.PDF_CHROMIUM_SANDBOX === "1";
/**
 * P-013: test seam for the sandbox opt-in. Read at call time (not module
 * load) so tests can flip the flag per case without a restart; production
 * behaviour is identical (the env does not change at runtime there).
 * Default stays unset = --no-sandbox for shared-hosting compatibility —
 * enabling the sandbox is a deploy-time decision made only after the host
 * proves Chromium starts with it on (see .env.cpanel.example).
 */
export function pdfChromiumSandboxEnabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  return env.PDF_CHROMIUM_SANDBOX === "1";
}
/** Light-mode launch args; --no-sandbox is dropped when the sandbox opt-in is on. */
export function pdfLightLaunchArgs(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    "--single-process",
    "--no-zygote",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    ...(pdfChromiumSandboxEnabled(env) ? [] : ["--no-sandbox"]),
  ];
}
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
async function launchBrowser(light: boolean = lightMode): Promise<Browser> {
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
    ...(chromiumSandbox() ? { chromiumSandbox: true } : {}),
    // Light mode only (PDF_LIGHT_MODE=1, see above): one process instead
    // of 5+, no zygote/GPU children, small footprint. --no-sandbox is part
    // of that profile only while the F3 opt-in is off: passing it alongside
    // chromiumSandbox:true would defeat the sandbox again.
    ...(light
      ? {
          args: pdfLightLaunchArgs(),
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
/**
 * REACTPDF-MIGRATION-01: the PDF engine is chosen by PDF_ENGINE —
 * "chromium" (default; the Playwright path below, byte-identical to before,
 * light mode included) or "react-pdf" (the pure-Node renderer in
 * pdf-react.tsx; no browser process is started). The react-pdf engine
 * implements template v7 only: a v6 re-render request always takes the
 * Chromium path so stored-certificate re-renders stay byte-stable. Read at
 * call time (not module load) so tests and one-off tools can switch engines
 * per process without a restart.
 */
export type PdfEngine = "chromium" | "react-pdf";
export function pdfEngine(): PdfEngine {
  const raw = process.env.PDF_ENGINE ?? "chromium";
  if (raw === "chromium" || raw === "react-pdf") return raw;
  throw new Error(
    `PDF_ENGINE must be "chromium" or "react-pdf"; got "${raw}".`,
  );
}
export async function generatePdf(
  input: PdfInput,
  version: number = DEMO_TEMPLATE_VERSION,
): Promise<Buffer> {
  // CERT-REFINE-01 (A6): the QR encodes the SAME URL the documents print —
  // `${origin}/verify?searchText=<certificate number, Latin digits>` — so
  // the printed text and the code can never diverge (previously the QR
  // carried the token URL while the page printed the searchText URL).
  const { latinDigits, CERT_PAPER_BG } = await import(
    "./certificate-template-v7.js"
  );
  const qrUrl = (() => {
    try {
      return `${new URL(input.verificationUrl).origin}/verify?searchText=${latinDigits(input.number)}`;
    } catch {
      return input.verificationUrl;
    }
  })();
  // WS-SHELL-GAPS (25 Nov 2026): error-correction H (~30% recoverable)
  // — the Prottoyon references print a small govt emblem in the centre of
  // the QR, and only H leaves enough redundancy for a ≤20% centre overlay.
  // The `qrcode` lib accepts H (verified: H and M encode different, valid
  // data URLs for the same payload). Both renderers overlay the emblem on
  // this QR; without an emblem asset (demo mode) the QR renders bare.
  const qr = await QRCode.toDataURL(qrUrl, {
    width: 180,
    errorCorrectionLevel: "H",
    margin: 2,
    // CERT-PAPER (25 Nov 2026): the QR light colour matches the
    // certificate paper tone so the code prints directly on the
    // government-paper background (no white patch). Contrast against
    // the black modules stays ~19:1 — fully scannable.
    color: { dark: "#000000ff", light: `${CERT_PAPER_BG}ff` },
  });
  if (version === DEMO_TEMPLATE_VERSION && pdfEngine() === "react-pdf") {
    const { renderCertificatePdfReact } = await import("./pdf-react.js");
    await acquireRenderer();
    try {
      return await renderCertificatePdfReact(input, qr);
    } finally {
      releaseRenderer();
    }
  }
  return renderHtmlPdf(renderCertificateHtml(input, qr, version));
}
/** Render only escaped, application-owned HTML; remote network resources are blocked.
 * QA-03: if Chromium dies mid-render ("Target page, context or browser has been
 * closed"), retry once in a fresh, dedicated browser with the full (non-light)
 * profile instead of failing the chairman's issuance with a 500. */
export async function renderHtmlPdf(html: string): Promise<Buffer> {
  try {
    return await renderHtmlPdfOnce(html, lightMode, lightMode);
  } catch (error) {
    if (!/closed|crash|disconnected|Target/i.test(String((error as Error)?.message)))
      throw error;
    console.warn(
      "[pdf] Chromium closed during render; retrying once with a fresh full-profile browser.",
    );
    return renderHtmlPdfOnce(html, false, true);
  }
}
async function renderHtmlPdfOnce(
  html: string,
  light: boolean,
  dedicated: boolean,
): Promise<Buffer> {
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
    const instance = dedicated
      ? (ownBrowser = await launchBrowser(light))
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
