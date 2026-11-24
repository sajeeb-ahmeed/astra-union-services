import { request as playwrightRequest } from "playwright";

/**
 * Arrange one pending attachment scan (QUARANTINED) via the API, on a
 * separate request context so the browser page's own session is
 * untouched. QAFIX-09: the OwnerOperations KPI grid collapses to an
 * "All clear" notice when every queue is zero, so the owner console
 * tests (consoles, operations) need a non-empty scan queue of their
 * own instead of relying on other tests' never-scanned uploads —
 * the journey fixture now verdicts its own uploads CLEAN, which
 * empties the queue. The pending upload is a synthetic minimal PDF
 * (complete, with %%EOF) for a seeded citizen.
 */
const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
    "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

export async function ensurePendingScan(origin: string): Promise<void> {
  const api = await playwrightRequest.newContext();
  try {
    const login = await api.post(`${origin}/api/v1/auth/login`, {
      data: { email: "staff@alpha.local.test", password: "Demo-Phase1!" },
    });
    if (login.status() !== 200) return;
    const session = await login.json();
    const citizens = await api.get(`${origin}/api/v1/citizens`);
    if (citizens.status() !== 200) return;
    const list = await citizens.json();
    const citizenId = list.items?.[0]?.id;
    if (!citizenId) return;
    await api.post(`${origin}/api/v1/attachments`, {
      headers: { "X-CSRF-Token": session.csrfToken },
      data: {
        citizenId,
        mimeType: "application/pdf",
        base64: MINIMAL_PDF.toString("base64"),
      },
    });
  } finally {
    await api.dispose();
  }
}
