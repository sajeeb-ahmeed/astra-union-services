import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * Phase 5 (5B): citizen search matches the Bangla name, the English name, the reference and
 * the contact mobile, case-insensitively, and tolerates the whitespace of real typed/pasted
 * queries. (Live defect, 17 Nov: searching the English name "QA Test Citizen" appeared to
 * return no results. The endpoint already matched full_name_en; the gaps pinned here are the
 * un-normalized query — padded or double-spaced input matched nothing — and the missing
 * mobile/reference-digit matching.)
 */

type Session = { cookie: string; csrf: string; user: any };
let server: ReturnType<typeof app.listen>, base: string;
const password = "Demo-Phase1!";
let citizenId = "";
let reference = "";
const mobile = `019${String(Date.now()).slice(-8)}`;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
});
test.after(async () => {
  server?.close();
  await closePdfBrowser().catch(() => {});
  await pool.end();
});

async function request(
  method: string,
  path: string,
  opts: { cookie?: string; csrf?: string; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(opts.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.csrf ? { "X-CSRF-Token": opts.csrf } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function login(email: string): Promise<Session> {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return {
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
    csrf: body.csrfToken,
    user: body.user,
  };
}

test("citizen search: English, Bangla, reference and mobile all find the citizen", async () => {
  const staff = await login("staff@alpha.local.test");
  const created = await request("POST", "/citizens", {
    ...staff,
    body: {
      nameBn: "কিউএ টেস্ট নাগরিক",
      nameEn: "QA Test Citizen",
      dateOfBirth: "1995-06-15",
      addressBn: "পরীক্ষা ঠিকানা, বেলাবো",
      addressEn: "Test address, Belabo",
      details: { mobile },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  citizenId = created.body.id;
  reference = created.body.syntheticReference;

  const hits = async (q: string) => {
    const r = await request(
      "GET",
      `/citizens?q=${encodeURIComponent(q)}`,
      staff,
    );
    assert.equal(r.status, 200);
    return (r.body.items as any[]).some((c) => c.id === citizenId);
  };
  // English name: full, partial, lower case (the live defect report).
  assert.equal(await hits("QA Test Citizen"), true);
  assert.equal(await hits("QA Test"), true);
  assert.equal(await hits("qa test citizen"), true);
  // Bangla name: full and partial.
  assert.equal(await hits("কিউএ টেস্ট নাগরিক"), true);
  assert.equal(await hits("কিউএ টেস্ট"), true);
  // Whitespace robustness: padded and double-spaced queries still match.
  assert.equal(await hits("  QA Test Citizen  "), true);
  assert.equal(await hits("QA  Test   Citizen"), true);
  // Reference: grouped and digits-only forms.
  assert.equal(await hits(reference), true);
  assert.equal(await hits(reference.replace(/\D/g, "")), true);
  // Contact mobile.
  assert.equal(await hits(mobile), true);
  // A genuine non-match still returns nothing.
  const none = await request(
    "GET",
    `/citizens?q=${encodeURIComponent("zz-no-such-citizen-zz")}`,
    staff,
  );
  assert.equal(none.body.total, 0);
});
