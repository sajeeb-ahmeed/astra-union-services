// PHASE8PREP — verification driver for the tsc-compiled API build (Workstream 1).
// Server under test: apps/api/dist/server.js booted with plain node (no tsx)
// on :3011 against the local `astra` DB (db:initialize + db:seed).
// This driver script runs from the purge tree solely for module resolution
// (@astra/shared-schemas payload fixtures); every HTTP call hits the bundle.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { demoPayloads } from "@astra/shared-schemas";

const base = "http://127.0.0.1:3011";
const outDir = path.join(process.env.HOME!, "workspace/astra-logs");
const lines: string[] = [];
const log = (s: string) => { lines.push(s); console.log(s); };
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FORBIDDEN: Array<[string, RegExp]> = [
  ["demo", /\bdemo\b/i],
  ["নমুনা", /নমুনা/],
  ["পরীক্ষামূলক", /পরীক্ষামূলক/],
  ["সরকারি নথি নয়", /সরকারি নথি নয়/],
  ["not official", /not official/i],
  ["unofficial", /unofficial/i],
  ["disclaimer", /disclaimer/i],
  ["independently", /independently/i],
  ["not been confirmed", /not been confirmed/i],
  ["test payment", /test payment/i],
  ["sandbox", /sandbox/i],
];
function scan(label: string, text: string) {
  const hits = FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => name);
  check(`wording scan: ${label}`, hits.length === 0, hits.length ? `hits: ${hits.join(", ")}` : `${text.length} chars scanned`);
}

class Client {
  cookies = new Map<string, string>();
  csrf = "";
  constructor(private origin: string) {}
  async call(method: string, route: string, data?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${this.origin}/api/v1${route}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookies.size ? { Cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(this.csrf && method !== "GET" ? { "X-CSRF-Token": this.csrf } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const idx = pair.indexOf("=");
      this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
  async raw(route: string): Promise<{ status: number; buf: Buffer }> {
    const res = await fetch(`${this.origin}/api/v1${route}`, {
      headers: {
        ...(this.cookies.size ? { Cookie: [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
    });
    return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
  }
  async login(email: string, password: string) {
    const r = await this.call("POST", "/auth/login", { email, password });
    if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.body)}`);
    const me = await this.call("GET", "/auth/me");
    this.csrf = me.body.csrfToken ?? "";
    return me.body;
  }
}

const password = "Phase8Prep-Verify-2026!";
const runId = Date.now().toString(36);
const geography = { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: "uni-3283", wardCode: "uni-3283-w01" };

async function main() {
  const health = await (await fetch(`${base}/api/v1/health`)).json();
  check("health OFFICIAL + all features true",
    health.mode === "OFFICIAL" && health.status === "ok" &&
    health.features?.signInIdentifiers === true && health.features?.citizenIdentityNumbers === true &&
    health.features?.officeMerchantCredentials === true && health.features?.emailDelivery === true,
    JSON.stringify(health));

  const catalog = await (await fetch(`${base}/api/v1/services`)).json();
  check("catalog = 47 services", Array.isArray(catalog.items) && catalog.items.length === 47, `items=${catalog.items?.length}`);

  const homeHtml = await (await fetch(`${base}/`)).text();
  check("packaged web app served at /", homeHtml.includes("<div id=\"root\">") || homeHtml.includes("id=\"root\""), `${homeHtml.length} bytes of HTML`);

  // --- API flow ---
  const owner = new Client(base);
  await owner.login(process.env.OWNER_EMAIL!, process.env.OWNER_PASSWORD!);
  const tenantRes = await owner.call("POST", "/owner/tenants", {
    slug: `phase8prep-verify-${runId}`,
    nameBn: "যাচাই ইউনিয়ন পরিষদ",
    nameEn: `Phase8Prep Verify Union ${runId}`,
    officeType: "UNION",
    geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: "uni-3283" },
    adminEmail: `admin-${runId}@phase8prep.test`,
    adminName: "Phase8Prep Verify Admin",
    adminPassword: password,
  });
  check("office created", tenantRes.status === 201, `status=${tenantRes.status}`);
  const tenant = tenantRes.body;
  check("tenant.demo stored false", tenant.demo === false, `demo=${tenant.demo}`);
  const adjust = await owner.call("POST", `/owner/tenants/${tenant.id}/adjust`, { delta: 5, reason: "Initial office credit" });
  check("owner credit adjustment +5", adjust.status === 201, `status=${adjust.status}`);

  const admin = new Client(base);
  await admin.login(`admin-${runId}@phase8prep.test`, password);
  const chairmanRes = await admin.call("POST", "/admin/users", {
    email: `chairman-${runId}@phase8prep.test`, password, displayName: "Phase8Prep Verify Chairman", role: "approver",
  });
  check("chairman user created", chairmanRes.status === 201, `status=${chairmanRes.status}`);
  const chairmanId = chairmanRes.body.id;
  const authRes = await admin.call("PUT", `/admin/authorizations/${chairmanId}/45`, {
    active: true, authorityNote: "Chairman authority — bundle verification office",
  });
  check("service 45 authorisation (no stored prefix)", authRes.status === 200 && !String(authRes.body.authorityNote ?? "").includes("DEMO"),
    `status=${authRes.status} note=${JSON.stringify(authRes.body.authorityNote ?? "")}`);
  scan("stored authority note", String(authRes.body.authorityNote ?? ""));

  const planOrder = await admin.call("POST", "/billing/orders", { kind: "subscription", planId: "standard-monthly" });
  check("subscription order (standard-monthly)", planOrder.status === 201, `status=${planOrder.status} plan=${planOrder.body.planId ?? planOrder.body.plan_id ?? ""}`);
  const settled = await admin.call("POST", `/billing/orders/${planOrder.body.id}/demo-settle`, {});
  check("subscription settled (QA settle flag, local verify server only)", settled.status === 200, `status=${settled.status}`);

  const citizen = new Client(base);
  const signup = await citizen.call("POST", "/auth/signup", {
    email: `citizen-${runId}@phase8prep.test`, password, displayName: "Phase8Prep Verify Citizen",
    tenantId: tenant.id, nameBn: "যাচাই নাগরিক", nameEn: "Phase8Prep Verify Citizen",
    dateOfBirth: "1990-05-06", addressBn: "যাচাই গ্রাম", addressEn: "Verify Village", geography,
  });
  check("citizen signup", signup.status === 201, `status=${signup.status}`);
  await citizen.login(`citizen-${runId}@phase8prep.test`, password);
  const citizens = await citizen.call("GET", "/citizens");
  const ownCitizen = citizens.body.items?.[0];
  check("citizen reference present (Phase 5 format or REF-)", /^(REF-|\d)/.test(ownCitizen?.syntheticReference ?? ""), ownCitizen?.syntheticReference ?? "none");

  const created = await citizen.call("POST", "/applications", { citizenId: ownCitizen.id, serviceNo: 45, payload: demoPayloads[45] });
  check("application created", created.status === 201, `status=${created.status}`);
  const application = created.body;
  const submitted = await citizen.call("POST", `/applications/${application.id}/transition`, { action: "submit" });
  check("application submitted", submitted.status === 200 && submitted.body.state === "SUBMITTED", `state=${submitted.body.state}`);

  const chairman = new Client(base);
  await chairman.login(`chairman-${runId}@phase8prep.test`, password);
  const approved = await chairman.call("POST", `/applications/${application.id}/transition`, { action: "approve" });
  check("chairman approve issues (OFFICIAL, chairman-direct)", approved.status === 200 && approved.body.state === "ISSUED",
    `status=${approved.status} state=${approved.body.state} ${approved.status !== 200 ? JSON.stringify(approved.body).slice(0, 200) : ""}`);
  const certNumber = approved.body.certificate?.number;
  check("certificate number issued", !!certNumber, String(certNumber));

  // --- Certificate PDF text ---
  let certId = approved.body.certificate?.id;
  if (!certId) {
    const detail = await chairman.call("GET", `/applications/${application.id}`);
    certId = detail.body.certificate?.id ?? detail.body.certificateId ?? detail.body.certificates?.[0]?.id;
    log(`certificate id resolved via application detail: ${certId ?? "NOT FOUND"} (keys: ${Object.keys(detail.body).join(",")})`);
  }
  const pdf = await chairman.raw(`/certificates/${certId}/pdf`);
  check("certificate PDF downloads", pdf.status === 200 && pdf.buf.subarray(0, 4).toString() === "%PDF", `status=${pdf.status} bytes=${pdf.buf.length}`);
  const pdfPath = path.join(outDir, "phase8prep-cert.pdf");
  fs.writeFileSync(pdfPath, pdf.buf);
  const pdfText = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  // The v7 template renders digits in Bangla on the certificate; normalise before comparing.
  const bnToLat = (s: string) => s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
  check("certificate number appears in PDF text", !!certNumber && bnToLat(pdfText).includes(certNumber), `number=${certNumber} (digits rendered in Bangla on the certificate)`);
  scan("certificate PDF (template v7, official)", pdfText);

  const verify = await (await fetch(`${base}/api/v1/verify/by-number/${encodeURIComponent(certNumber)}`)).json();
  check("public verify API", verify.status === "ISSUED" && verify.demo === false, JSON.stringify({ status: verify.status, demo: verify.demo }));

  // Light mode (PDF_LIGHT_MODE=1): each render launches its own browser and
  // closes it in a finally block, so once the PDF response above completed,
  // no Chromium process may remain alive on this machine.
  let chromiumCount = 0;
  try {
    const out = execFileSync("pgrep", ["-f", "ms-playwright"], { encoding: "utf8" }).trim();
    chromiumCount = out ? out.split("\n").length : 0;
  } catch { chromiumCount = 0; }
  check("light mode: no Chromium lingers after render", chromiumCount === 0, `ms-playwright processes=${chromiumCount}`);

  log(failures === 0 ? "== RESULT: ALL CHECKS PASS ==" : `== RESULT: ${failures} FAILURE(S) ==`);
  fs.writeFileSync(path.join(outDir, "PHASE8PREP-VERIFY.md"),
    `# PHASE8PREP — compiled-build verification transcript\n\nServer: tsc-compiled API at ~/workspace/astra-phase8prep-tree/apps/api/dist, booted via plain \`node apps/api/dist/server.js\` (NO tsx) on :3011.\nDatabase: local PostgreSQL \`astra\` (db:initialize + db:seed from the phase8prep tree).\nNotes: DEMO_SETTLE_ENABLED=true was set on this LOCAL verification server only (the disclosed QA settle mechanism; production never enables it). Boot used SERVE_WEB=true instead of NODE_ENV=production because production mode requires an HTTPS PUBLIC_ORIGIN (http-hardening) — the same approach as the PURGE and UIUX boot verifications. PDF_LIGHT_MODE=1 and PDF_MAX_CONCURRENCY=1 were set for this run, so the certificate below was rendered by the packaged light-mode path (fresh single-process Chromium per render, closed immediately).\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { log(`ERROR ${e.message}`); try { fs.writeFileSync(path.join(outDir, "PHASE8PREP-VERIFY.md"), lines.join("\n")); } catch {} process.exit(1); });
