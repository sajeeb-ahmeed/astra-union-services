import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { demoPayloads } from "@astra/shared-schemas";

/**
 * F2 regression (FULL-LIVE-QA-R5 finding, 21 Nov): a citizen's submit
 * that the server rejects — here the real 409 ATTACHMENT_NOT_READY for
 * a supporting document that is still QUARANTINED (the web-test stack
 * runs no scanner worker, so an uploaded document is never scanned) —
 * must surface the server's own error inside the application detail
 * view and leave the application visibly DRAFT. The pre-fix UI showed
 * the failure only in the workspace's top banner, far from the
 * action; at the button the click appeared to do nothing.
 */
const origin = "http://127.0.0.1:5173";
let ownedStack: ChildProcess | undefined;
async function ready() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${origin}/api/v1/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Local app did not become ready.");
}
async function start() {
  try {
    if ((await fetch(`${origin}/api/v1/health`)).ok) return;
  } catch {}
  ownedStack = spawn(process.execPath, ["--import", "tsx", "scripts/dev.ts"], {
    stdio: "pipe",
  });
  await ready();
}
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
async function login(page: Page) {
  await page.goto(`${origin}/login`);
  await page
    .getByLabel("Email", { exact: true })
    .fill("citizen@alpha.local.test");
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .waitFor();
}
async function openById(page: Page, reference: string) {
  await goToWorkspacePage(page, "Applications");
  const row = page.getByRole("row").filter({ hasText: reference });
  await row.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .getByRole("button", { name: "← All applications", exact: true })
    .waitFor();
}

test(
  "submit failure: unscanned (quarantined) attachment — the detail view shows the server error and the application stays DRAFT",
  { timeout: 120000 },
  async () => {
    await start();
    const browser = await browserInstance();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
    });
    await page.addInitScript(() =>
      localStorage.setItem("astra.language", "en"),
    );
    try {
      await login(page);
      // Arrange through the product's own API, in the citizen's
      // session: upload a document (it stays QUARANTINED — nothing
      // scans it on this stack), then create a service-1 draft whose
      // payload carries that document.
      const payload = structuredClone(demoPayloads[1]) as Record<
        string,
        unknown
      >;
      // Setup runs node-side, not page.evaluate: the evaluated function
      // cannot close over helpers — tsx wraps a nested function
      // expression with an __name() call that is undefined in the page,
      // so the previous page.evaluate setup died with
      // "ReferenceError: __name is not defined" before any assertion.
      // The session cookie from the logged-in page authenticates the
      // node-side calls (same origin, same Vite /api proxy).
      const cookies = await page.context().cookies();
      const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const me = await (
        await fetch(`${origin}/api/v1/auth/me`, { headers: { cookie } })
      ).json();
      const csrf = me.csrfToken as string;
      const post = async (path: string, body: unknown) => {
        const r = await fetch(`${origin}/api/v1${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            cookie,
          },
          body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      };
      const citizens = await (
        await fetch(`${origin}/api/v1/citizens?q=`, { headers: { cookie } })
      ).json();
      const list = citizens.items ?? citizens;
      const own =
        list.find((c: any) => (c.userId ?? c.user_id) === me.user.id) ??
        list[0];
      const upload = await post("/attachments", {
        citizenId: own.id,
        mimeType: "application/pdf",
        // Minimal structurally valid PDF: "%PDF-1.4\n%%EOF" (14 bytes).
        // decodeUpload requires the %PDF- header AND a %%EOF marker in
        // the last 1024 bytes — the old 16-byte "%PDF-1.4 sample!" had
        // no end marker and the upload died with 422 UPLOAD_TYPE.
        base64: "JVBERi0xLjQKJSVFT0Y=",
      });
      const attachmentId = upload.body?.attachmentId ?? upload.body?.id;
      const scan = await (
        await fetch(`${origin}/api/v1/attachments/${attachmentId}/status`, {
          headers: { cookie },
        })
      ).json();
      const created = await post("/applications", {
        citizenId: own.id,
        serviceNo: 1,
        payload: {
          ...payload,
          supporting_documents: [
            {
              description: "Synthetic supporting document",
              file: {
                attachmentId,
                mimeType: "application/pdf",
                byteLength: 14,
              },
            },
          ],
        },
      });
      const app = created.body?.application ?? created.body;
      const setup = {
        uploadStatus: upload.status,
        scanState: scan.scanState as string,
        createdStatus: created.status,
        id: app?.id as string,
        reference: app?.reference as string,
        state: app?.state as string,
      };
      assert.equal(setup.uploadStatus, 201);
      assert.equal(
        setup.scanState,
        "QUARANTINED",
        "premise: the uploaded document is unscanned",
      );
      assert.equal(setup.createdStatus, 201);
      assert.equal(setup.state, "DRAFT");

      // The workspace applications list is fetched at shell mount and
      // is not refetched on navigation — a draft created through the
      // API (bypassing the UI create path, which updates the store)
      // is invisible in the list until the shell remounts. Reload so
      // the list is fresh; the session cookie survives the reload.
      // Verified live: same draft absent after nav +10s, present after
      // reload + nav (probe-cache.ts).
      await page.reload();
      await page
        .getByRole("button", { name: "Sign out", exact: true })
        .waitFor();

      // Act: submit the draft from its detail view and capture the
      // transition response itself — the server must reject it.
      await openById(page, setup.reference);
      const transition = page.waitForResponse(
        (r) =>
          r.url().includes("/transition") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Submit application", exact: true })
        .click();
      const response = await transition;
      assert.equal(
        response.status(),
        409,
        "premise: the server rejects a submit carrying an unscanned document",
      );

      // The detail view itself carries the failure: the server's own
      // message, in an alert beside the actions — not only a banner at
      // the top of the workspace. The raw server text is passed through
      // tx(), so the rendered copy is the locale entry for it
      // (workspace.en.json: "…must pass the safety check… Review the
      // document status below.") — assert the rendered wording.
      const alert = page.locator(".detail-action-error");
      await alert.waitFor();
      assert.match(
        (await alert.innerText()) ?? "",
        /Supporting documents must pass the safety check/,
      );
      // The status never pretended otherwise: header badge still reads
      // Draft, the draft's Submit action is still offered, and the
      // server's record is untouched.
      assert.equal(
        await page.locator(".section-heading .ax-status").innerText(),
        "Draft",
      );
      await page
        .getByRole("button", { name: "Submit application", exact: true })
        .waitFor();
      const after = await page.evaluate(async (id) => {
        const body = await (
          await fetch(`/api/v1/applications/${id}`)
        ).json();
        const app = body?.application ?? body;
        return app?.state as string;
      }, setup.id);
      assert.equal(after, "DRAFT");
    } finally {
      await browser.close();
      ownedStack?.kill();
    }
  },
);
