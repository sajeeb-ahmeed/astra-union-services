// REACTPDF-MIGRATION-01 — 47-service proof-pack driver.
// Mirrors phase8prep-verify.ts: the server under test is booted separately
// (env decides the PDF engine); this driver creates a fresh office, a
// chairman authorised for all 47 services, and one citizen, then runs
// create -> submit -> chairman approve (issuance) for EVERY service and
// saves each issued certificate PDF for the QA checklist.
//
// Usage: BASE=http://127.0.0.1:3012 OUT=<subdir> npx tsx reactpdf-proof.ts
// Output: ~/workspace/astra-logs/reactpdf-proof/<OUT>/service-NN.pdf + results.json
import fs from "node:fs";
import path from "node:path";
import { demoPayloads } from "@astra/shared-schemas";

const base = process.env.BASE ?? "http://127.0.0.1:3012";
const outName = process.env.OUT ?? "react";
const outDir = path.join(process.env.HOME!, "workspace/astra-logs/reactpdf-proof", outName);
fs.mkdirSync(outDir, { recursive: true });
const log = (s: string) => console.log(s);

class Client {
  cookies = new Map<string, string>();
  csrf = "";
  async call(method: string, route: string, data?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}/api/v1${route}`, {
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
    const res = await fetch(`${base}/api/v1${route}`, {
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

const password = "ReactPdf-Proof-2026!";
const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const geography = { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: "uni-3283", wardCode: "uni-3283-w01" };

interface ServiceResult {
  service: number;
  ok: boolean;
  stage?: string;
  detail?: string;
  certificateNumber?: string;
  bytes?: number;
}

async function main() {
  const health = await (await fetch(`${base}/api/v1/health`)).json();
  log(`health: mode=${health.mode} status=${health.status}`);
  if (health.mode !== "OFFICIAL") throw new Error("server is not in OFFICIAL mode");

  const owner = new Client();
  await owner.login(process.env.OWNER_EMAIL!, process.env.OWNER_PASSWORD!);
  const tenantRes = await owner.call("POST", "/owner/tenants", {
    slug: `reactpdf-proof-${runId}`,
    nameBn: "বেলাবো ইউনিয়ন পরিষদ",
    nameEn: "Belabo Union Parishad",
    officeType: "UNION",
    geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: "uni-3283" },
    adminEmail: `admin-${runId}@reactpdf.test`,
    adminName: "ReactPDF Proof Admin",
    adminPassword: password,
  });
  if (tenantRes.status !== 201) throw new Error(`tenant create -> ${tenantRes.status} ${JSON.stringify(tenantRes.body)}`);
  const tenant = tenantRes.body;
  log(`tenant: ${tenant.id} slug=${tenant.slug} demo=${tenant.demo}`);
  const adjust = await owner.call("POST", `/owner/tenants/${tenant.id}/adjust`, { delta: 1000, reason: "Proof pack office credit" });
  log(`credit adjust: ${adjust.status}`);

  const admin = new Client();
  await admin.login(`admin-${runId}@reactpdf.test`, password);
  const chairmanRes = await admin.call("POST", "/admin/users", {
    email: `chairman-${runId}@reactpdf.test`, password, displayName: "মোঃ হাবিবুর রহমান", role: "approver",
  });
  if (chairmanRes.status !== 201) throw new Error(`chairman create -> ${chairmanRes.status} ${JSON.stringify(chairmanRes.body)}`);
  const chairmanId = chairmanRes.body.id;
  const only = (process.env.SERVICES ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n >= 1 && n <= 47);
  const serviceList = only.length ? only : Array.from({ length: 47 }, (_, i) => i + 1);
  for (const n of serviceList) {
    const r = await admin.call("PUT", `/admin/authorizations/${chairmanId}/${n}`, {
      active: true, authorityNote: "Chairman authority — react-pdf proof office",
    });
    if (r.status !== 200) throw new Error(`authorization ${n} -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  log(`chairman authorised for ${serviceList.length} services`);

  const order = await admin.call("POST", "/billing/orders", { kind: "subscription", planId: "standard-monthly" });
  if (order.status === 201) {
    const settled = await admin.call("POST", `/billing/orders/${order.body.id}/demo-settle`, {});
    log(`subscription order settled: ${settled.status}`);
  } else {
    log(`subscription order: ${order.status} (continuing; wallet credit covers submit fees)`);
  }

  const citizen = new Client();
  const signup = await citizen.call("POST", "/auth/signup", {
    email: `citizen-${runId}@reactpdf.test`, password, displayName: "আফসানা আক্তার মীম",
    tenantId: tenant.id, nameBn: "আফসানা আক্তার মীম", nameEn: "Afsana Akter Mim",
    dateOfBirth: "1990-05-06", addressBn: "বেলাব গাংকুল পাড়া", addressEn: "Belab Gangkul Para", geography,
  });
  if (signup.status !== 201) throw new Error(`citizen signup -> ${signup.status} ${JSON.stringify(signup.body)}`);
  await citizen.login(`citizen-${runId}@reactpdf.test`, password);
  const citizens = await citizen.call("GET", "/citizens");
  const citizenId = citizens.body.items?.[0]?.id;
  if (!citizenId) throw new Error("citizen record not found after signup");
  log(`citizen: ${citizenId}`);

  const chairman = new Client();
  await chairman.login(`chairman-${runId}@reactpdf.test`, password);

  const results: ServiceResult[] = [];
  for (const n of serviceList) {
    const r: ServiceResult = { service: n, ok: false };
    try {
      const created = await citizen.call("POST", "/applications", { citizenId, serviceNo: n, payload: demoPayloads[n] });
      if (created.status !== 201) throw Object.assign(new Error(JSON.stringify(created.body).slice(0, 300)), { stage: "create", status: created.status });
      const appId = created.body.id as string;
      const submitted = await citizen.call("POST", `/applications/${appId}/transition`, { action: "submit" });
      if (submitted.status !== 200 || submitted.body.state !== "SUBMITTED")
        throw Object.assign(new Error(JSON.stringify(submitted.body).slice(0, 300)), { stage: "submit", status: submitted.status });
      const approved = await chairman.call("POST", `/applications/${appId}/transition`, { action: "approve" });
      if (approved.status !== 200 || approved.body.state !== "ISSUED")
        throw Object.assign(new Error(JSON.stringify(approved.body).slice(0, 300)), { stage: "approve", status: approved.status });
      const cert = approved.body.certificate;
      r.certificateNumber = cert?.number;
      const pdf = await chairman.raw(`/certificates/${cert.id}/pdf`);
      if (pdf.status !== 200 || pdf.buf.subarray(0, 4).toString() !== "%PDF")
        throw Object.assign(new Error(`status=${pdf.status} bytes=${pdf.buf.length}`), { stage: "pdf", status: pdf.status });
      fs.writeFileSync(path.join(outDir, `service-${String(n).padStart(2, "0")}.pdf`), pdf.buf);
      r.bytes = pdf.buf.length;
      r.ok = true;
      log(`svc ${n}: ISSUED ${cert.number} (${pdf.buf.length} bytes)`);
    } catch (e: any) {
      r.stage = e.stage ?? "unknown";
      r.detail = `${e.status ?? ""} ${e.message}`.trim();
      log(`svc ${n}: FAIL at ${r.stage} — ${r.detail}`);
    }
    results.push(r);
  }
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ runId, tenantId: tenant.id, results }, null, 2));
  const ok = results.filter((r) => r.ok).length;
  log(`== PROOF RUN: ${ok}/${serviceList.length} issued ==`);
  process.exit(ok === serviceList.length ? 0 : 1);
}

main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
