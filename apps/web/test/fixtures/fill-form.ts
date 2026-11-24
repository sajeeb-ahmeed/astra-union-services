import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright";

/**
 * Fill a rendered DynamicForm from a payload object, one real control at a
 * time. Browser tests use this with the shared fixture payloads
 * (`demoPayloads` from @astra/shared-schemas) now that the shipped UI no
 * longer offers a localhost sample-insertion shortcut: the same data is
 * typed into the actual inputs, selects, checkboxes and repeatable rows.
 */
export async function fillApplicationForm(
  page: Page,
  payload: Record<string, unknown>,
  root?: Locator,
): Promise<void> {
  const scope = root ?? page.getByTestId("service-application-form");
  for (const [key, value] of Object.entries(payload)) {
    await fillField(scope, key, value);
  }
  await completeSeededDocumentsRow(scope);
}

/**
 * QAFIX-09: a service whose evidence step requires documents
 * (minRows >= 1 — Form 45 is the first journey-driven one) opens
 * with a seeded blank row whose description and file are required.
 * The fixture payloads carry no documents (the API accepts the
 * field's absence), so without this the seeded row blocks every
 * journey at the form step. Complete row 0 with a synthetic
 * document, the same data class as the payloads. Rows the payload
 * already filled are left untouched.
 */
async function completeSeededDocumentsRow(scope: Locator): Promise<void> {
  const group = scope.locator('[data-field-path="supporting_documents"]');
  if (!(await group.count())) return;
  const row = group.locator(":scope > .repeat-row").first();
  if (!(await row.count())) return;
  const description = row.locator(
    '[data-field-path="supporting_documents[0].description"]',
  );
  if (
    (await description.count()) &&
    !(await description.inputValue().catch(() => "filled"))
  ) {
    await description.fill("Synthetic supporting document");
  }
  const file = row.locator('input[type="file"]');
  if (await file.count()) {
    // A complete minimal PDF: the upload pipeline verifies the
    // signature AND the %%EOF end marker, so a header-only
    // buffer is rejected ("end marker does not match"). The
    // comment line carries a per-upload token so this upload's
    // sha256 is unique — the scanner drive stops at its own
    // digest, and byte-identical uploads from other tests (or
    // the pending-scan arrange) would end the drive early on
    // the wrong job, leaving this one QUARANTINED (409).
    const pdf = Buffer.from(
      `%PDF-1.4\n% synthetic evidence ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}\n` +
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
        "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
    );
    await file.setInputFiles({
      name: "synthetic-evidence.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    // The upload is async; the row is valid only once the
    // attachment status lands.
    await scope
      .locator('[data-testid="attachment-status"]')
      .waitFor({ timeout: 20000 })
      .catch(() => {});
    await scanAttachmentClean(pdf);
  }
}

/**
 * Uploaded documents start QUARANTINED and an application cannot
 * be submitted until a scanner worker returns a CLEAN verdict
 * (409 ATTACHMENT_NOT_READY otherwise). No worker runs in the
 * browser-suite environment, so — exactly as the API tests do —
 * the fixture stands in for the worker: claim the pending scan
 * job(s) over the internal scanner API and finish them CLEAN,
 * stopping once this upload's own digest has been verdicted.
 * The internal API refuses browser traffic, so this uses plain
 * node fetch (no Cookie/Origin headers) against the suite API.
 */
async function scanAttachmentClean(pdf: Buffer): Promise<void> {
  const secret = process.env.ATTACHMENT_SCANNER_SECRET;
  if (!secret) return;
  const digest = createHash("sha256").update(pdf).digest("hex");
  const api = "http://127.0.0.1:3001/api/v1";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  };
  // ONE identity for the whole drive: finish re-presents the
  // claim's engine/signature versions AND its signatureUpdatedAt
  // timestamp verbatim — the API binds the lease to all of them
  // (409 SCAN_LEASE_INVALID on any mismatch).
  const identity = {
    workerId: "web-fixture-scanner",
    engineVersion: "ClamAV test",
    signatureVersion: "synthetic-1",
    signatureUpdatedAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 25; attempt++) {
    const claimResponse = await fetch(
      `${api}/internal/attachment-scans/claim`,
      { method: "POST", headers, body: JSON.stringify(identity) },
    ).catch(() => null);
    if (!claimResponse || claimResponse.status !== 200) return;
    const { job } = (await claimResponse.json()) as {
      job: {
        attachmentId: string;
        tenantId: string;
        leaseToken: string;
        sha256: string;
      } | null;
    };
    if (!job) return;
    const { workerId: _workerId, ...versions } = identity;
    await fetch(`${api}/internal/attachment-scans/finish`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...versions,
        attachmentId: job.attachmentId,
        tenantId: job.tenantId,
        leaseToken: job.leaseToken,
        sha256: job.sha256,
        verdict: "CLEAN",
        reasonCode: "OK",
      }),
    }).catch(() => {});
    if (job.sha256 === digest) return;
  }
}

const geographyKeys = [
  "divisionCode",
  "districtCode",
  "upazilaCode",
  "unionCode",
  "wardCode",
] as const;

async function fillField(
  scope: Locator,
  path: string,
  value: unknown,
): Promise<void> {
  // Some payload keys have no rendered control in a given form variant —
  // e.g. delivery_language is managed by the order component (not the form)
  // when an office fee policy is configured, and conditional fields render
  // only while their controller is set. Skip keys the form does not render.
  const probe = scope.locator(`[data-field-path="${path}"]`).first();
  try {
    await probe.waitFor({ state: "attached", timeout: 2000 });
  } catch {
    return;
  }
  if (Array.isArray(value)) {
    // Repeatable group: add rows until the rendered count matches the
    // payload, then fill each row's child controls.
    const group = scope.locator(`[data-field-path="${path}"]`);
    const addButton = group.locator("> button", { hasText: "+ Add" });
    while (
      (await group.locator(":scope > .repeat-row").count()) < value.length
    ) {
      await addButton.click();
    }
    for (let index = 0; index < value.length; index++) {
      const row = value[index] as Record<string, unknown>;
      for (const [childKey, childValue] of Object.entries(row)) {
        await fillField(scope, `${path}[${index}].${childKey}`, childValue);
      }
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    // Geography picker: choose each level's code in cascade order, waiting
    // for the child level's options to load before selecting it.
    const picker = scope.locator(`[data-field-path="${path}"]`);
    const codes = value as Record<string, string>;
    let selectIndex = 0;
    for (const key of geographyKeys) {
      const code = codes[key];
      if (!code) continue;
      const select = picker.locator("select").nth(selectIndex);
      await select.waitFor({ state: "attached" });
      await select
        .locator(`option[value="${code}"]`)
        .waitFor({ state: "attached" });
      await select.selectOption(code);
      selectIndex++;
    }
    return;
  }
  const control = scope.locator(`[data-field-path="${path}"]`);
  const kind = await control.evaluate((element) => {
    if (element instanceof HTMLSelectElement) return "select";
    if (element instanceof HTMLInputElement && element.type === "checkbox")
      return "checkbox";
    return "text";
  });
  if (kind === "select") await control.selectOption(String(value));
  else if (kind === "checkbox") {
    // setChecked() is a no-op when the box already shows the desired state,
    // which leaves the value undefined in form state — and a required
    // checkbox then fails validation ("This field is required"). The removed
    // one-shot fill set every value explicitly, so force a click cycle that
    // writes the value while ending in the desired state.
    const checked = await control.evaluate(
      (el) => (el as HTMLInputElement).checked,
    );
    if (checked !== Boolean(value)) await control.click();
    else {
      await control.click();
      await control.click();
    }
  } else await control.fill(String(value));
}
