import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { chromium, type Browser, type Page } from "playwright";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { signOut } from "./fixtures/session.js";
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
async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(64, 3), Buffer.from([255, 217])]);
const today = new Date().toISOString().slice(0, 10);

/** Stands in for the scanner service: QUARANTINED → SCANNING → CLEAN. */
async function markClean(db: pg.Pool, attachmentId: string) {
  const lease = createHash("sha256").update(randomUUID()).digest("hex");
  await db.query(
    "UPDATE attachments SET scan_state='SCANNING',scan_reason='PENDING_SCAN',scan_attempts=scan_attempts+1,lease_token_hash=$2,lease_expires_at=now()+interval '5 minutes',scan_worker_id='test-scanner',scan_engine_version='test',scan_signature_version='test',scan_signature_updated_at=now() WHERE id=$1",
    [attachmentId, lease],
  );
  await db.query(
    "UPDATE attachments SET scan_state='CLEAN',scan_reason='OK',lease_token_hash=NULL,lease_expires_at=NULL,scanned_at=now(),scanned_sha256=content_sha256 WHERE id=$1",
    [attachmentId],
  );
}

test(
  "recharge browser: new deposits are paused, and the owner rejects a pre-pause request with a reason the office sees",
  { timeout: 120000 },
  async () => {
    assert.ok(
      process.env.DATABASE_ADMIN_URL,
      "DATABASE_ADMIN_URL must be set (source phase3-test-env.sh before test:web)",
    );
    const db = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const browser = await browserInstance();
    const stamp = Date.now();
    const slug = `recharge-browser-${stamp}`;
    const bank = `browser-bank-${stamp}`;
    const adminPassword = randomBytes(12).toString("base64url");
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
    });
    const csrf = (await login.json()).csrfToken;
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": csrf },
      data: {
        slug,
        nameBn: "রিচার্জ ব্রাউজার অফিস",
        nameEn: `Recharge Browser Office ${stamp}`,
        division: "Test Division",
        district: "Test District",
        upazila: "Test Upazila",
        officeType: "UNION",
        adminEmail: `admin@${slug}.test`,
        adminName: "Synthetic recharge admin",
        adminPassword,
      },
    });
    assert.equal(created.status(), 201, await created.text());
    const added = await owner.request.put(`${origin}/api/v1/owner/recharge-banks/${bank}`, {
      headers: { "X-CSRF-Token": csrf },
      data: { nameBn: "ব্রাউজার পরীক্ষা ব্যাংক", nameEn: `Browser Test Bank ${stamp}`, accountName: "Astra Demo", accountNumber: "9999 8888", active: true },
    });
    assert.equal(added.status(), 200, await added.text());
    // W-016: POST /recharges is 410 while the spend path is paused, so a
    // pre-pause PENDING request is inserted directly — the same fixture
    // the API recharge suite uses. Its deposit was already made.
    const tenantId = (await db.query("SELECT id FROM tenants WHERE slug=$1", [slug])).rows[0].id as string;
    const adminId = (
      await db.query("SELECT id FROM platform_users WHERE email=$1", [`admin@${slug}.test`])
    ).rows[0].id as string;
    const sha = createHash("sha256").update(jpeg).digest("hex");
    const proofId = (
      await db.query(
        "INSERT INTO attachments(tenant_id,citizen_id,uploaded_by,mime_type,byte_length,bytes,content_sha256,purpose,scan_state) VALUES($1,NULL,$2,'image/jpeg',$3,$4,$5,'recharge_proof','QUARANTINED') RETURNING id",
        [tenantId, adminId, jpeg.length, jpeg, sha],
      )
    ).rows[0].id as string;
    await db.query(
      "INSERT INTO recharge_requests(tenant_id,amount_minor,bank_code,deposit_reference,deposit_date,proof_attachment_id,requested_by) VALUES($1,50000,$2,$3,$4,$5,$6)",
      [tenantId, bank, `TXN-${stamp}`, today, proofId, adminId],
    );
    await markClean(db, proofId);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await signIn(page, `admin@${slug}.test`, adminPassword);
      await goToWorkspacePage(page, "Subscription & credits");
      const recharge = page.locator(".recharge");
      // W-016: the deposit form is gone — the office sees the paused
      // notice and the history table with the pre-pause request.
      await recharge.getByText(/Points recharge is paused/).waitFor();
      assert.equal(
        await recharge.getByRole("button", { name: "Send recharge request", exact: true }).count(),
        0,
      );
      const row = recharge.locator("tbody tr", { hasText: `TXN-${stamp}` });
      await row.getByText("Waiting for confirmation").waitFor();
      assert.match(await row.innerText(), /500\.00/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await signOut(page);

      await signIn(page, "owner@astra.demo.test", "Demo-Phase1!");
      await goToWorkspacePage(page, "Platform management");
      // OWNER-REDESIGN-01: the recharge queue lives in the Offices section.
      await page.locator('.owner-nav a[href="#owner-offices"]').click();
      await page.getByText(/New recharge requests are paused/).waitFor();
      const item = page.locator(".owner-recharges .recharge-item", { hasText: `TXN-${stamp}` });
      await item.waitFor();
      // Rejecting without a reason is refused by the server.
      await item.getByRole("button", { name: "Reject", exact: true }).click();
      await page.locator(".owner-recharges [role=status]").first().waitFor();
      await item.locator("input").fill("Deposit not on the statement");
      await item.getByRole("button", { name: "Reject", exact: true }).click();
      await page.getByText("Rejected.", { exact: true }).waitFor();
      await item.waitFor({ state: "detached" });
      await signOut(page);

      await signIn(page, `admin@${slug}.test`, adminPassword);
      await goToWorkspacePage(page, "Subscription & credits");
      await page
        .locator(".recharge tbody tr", { hasText: `TXN-${stamp}` })
        .getByText("Rejected · Deposit not on the statement")
        .waitFor();
    } finally {
      await owner.request.put(`${origin}/api/v1/owner/recharge-banks/${bank}`, {
        headers: { "X-CSRF-Token": csrf },
        data: { nameBn: "ব্রাউজার পরীক্ষা ব্যাংক", nameEn: `Browser Test Bank ${stamp}`, accountName: "Astra Demo", accountNumber: "9999 8888", active: false },
      });
      await db.end();
      await owner.close();
      await browser.close();
    }
  },
);
