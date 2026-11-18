// CERTNO-01 — sample proof driver.
// Mirrors reactpdf-proof.ts: the server under test is booted separately
// (env decides the PDF engine and ISSUANCE_MODE=official); this driver
// creates a fresh office, a chairman authorised for all 47 services, and
// two citizens — one WITH a photo, one without — then issues the required
// CERTNO-01 sample set and saves both language downloads.
//
// Usage: BASE=http://127.0.0.1:3013 OUT=chromium npx tsx certno-proof.ts
// Output: ~/workspace/astra-logs/certno-proof/<OUT>/*.pdf + results.json
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { demoPayloads } from "@astra/shared-schemas";

const base = process.env.BASE ?? "http://127.0.0.1:3013";
const outName = process.env.OUT ?? "chromium";
const outDir = path.join(process.env.HOME!, "workspace/astra-logs/certno-proof", outName);
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

const password = ["Certno", "Proof", "2026"].join("-") + "!";
const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const geography = { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: "uni-3283", wardCode: "uni-3283-w01" };

/** A simple portrait-style PNG (gradient + head/shoulders silhouette). */
function portraitPng(): Buffer {
  const png = new PNG({ width: 200, height: 250 });
  for (let y = 0; y < 250; y++) {
    for (let x = 0; x < 200; x++) {
      const i = (y * 200 + x) * 4;
      const head = (x - 100) ** 2 + (y - 95) ** 2 < 42 ** 2;
      const shoulders = y > 150 && Math.abs(x - 100) < 62 - (y - 150) * 0.2;
      if (head || shoulders) {
        png.data[i] = 70; png.data[i + 1] = 90; png.data[i + 2] = 130;
      } else {
        png.data[i] = 205; png.data[i + 1] = 218; png.data[i + 2] = 230;
      }
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

interface SampleResult {
  sample: string;
  service: number;
  ok: boolean;
  stage?: string;
  detail?: string;
  certificateNumber?: string;
  files?: string[];
}

async function main() {
  const health = await (await fetch(`${base}/api/v1/health`)).json();
  log(`health: mode=${health.mode} status=${health.status}`);
  if (health.mode !== "OFFICIAL") throw new Error("server is not in OFFICIAL mode");

  const owner = new Client();
  await owner.login(process.env.OWNER_EMAIL!, process.env.OWNER_PASSWORD!);
  const tenantRes = await owner.call("POST", "/owner/tenants", {
    slug: `certno-proof-${runId}`,
    nameBn: "বেলাবো ইউনিয়ন পরিষদ",
    nameEn: "Belabo Union Parishad",
    officeType: "UNION",
    geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: "uni-3283" },
    adminEmail: `admin-${runId}@certno.test`,
    adminName: "CERTNO Proof Admin",
    adminPassword: password,
  });
  if (tenantRes.status !== 201) throw new Error(`tenant create -> ${tenantRes.status} ${JSON.stringify(tenantRes.body)}`);
  const tenant = tenantRes.body;
  log(`tenant: ${tenant.id} slug=${tenant.slug} demo=${tenant.demo}`);
  const adjust = await owner.call("POST", `/owner/tenants/${tenant.id}/adjust`, { delta: 1000, reason: "CERTNO proof office credit" });
  log(`credit adjust: ${adjust.status}`);

  const admin = new Client();
  await admin.login(`admin-${runId}@certno.test`, password);
  const chairmanRes = await admin.call("POST", "/admin/users", {
    email: `chairman-${runId}@certno.test`, password, displayName: "মোঃ হাবিবুর রহমান", role: "approver",
  });
  if (chairmanRes.status !== 201) throw new Error(`chairman create -> ${chairmanRes.status} ${JSON.stringify(chairmanRes.body)}`);
  const chairmanId = chairmanRes.body.id;
  for (let n = 1; n <= 47; n++) {
    const r = await admin.call("PUT", `/admin/authorizations/${chairmanId}/${n}`, {
      active: true, authorityNote: "Chairman authority — CERTNO proof office",
    });
    if (r.status !== 200) throw new Error(`authorization ${n} -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  log("chairman authorised for 47 services");

  const order = await admin.call("POST", "/billing/orders", { kind: "subscription", planId: "standard-monthly" });
  if (order.status === 201) {
    const settled = await admin.call("POST", `/billing/orders/${order.body.id}/demo-settle`, {});
    log(`subscription order settled: ${settled.status}`);
  } else {
    log(`subscription order: ${order.status} (continuing; wallet credit covers submit fees)`);
  }

  async function makeCitizen(tag: string, withPhoto: boolean): Promise<{ client: Client; citizenId: string }> {
    const client = new Client();
    const signup = await client.call("POST", "/auth/signup", {
      email: `citizen-${tag}-${runId}@certno.test`, password, displayName: "আফসানা আক্তার মীম",
      tenantId: tenant.id, nameBn: "আফসানা আক্তার মীম", nameEn: "Afsana Akter Mim",
      dateOfBirth: "1990-05-06", addressBn: "বেলাব গাংকুল পাড়া", addressEn: "Belab Gangkul Para", geography,
    });
    if (signup.status !== 201) throw new Error(`citizen signup ${tag} -> ${signup.status} ${JSON.stringify(signup.body)}`);
    await client.login(`citizen-${tag}-${runId}@certno.test`, password);
    const citizens = await client.call("GET", "/citizens");
    const citizenId = citizens.body.items?.[0]?.id;
    if (!citizenId) throw new Error(`citizen record not found for ${tag}`);
    if (withPhoto) {
      const photo = await client.call("PUT", `/citizens/${citizenId}/photo`, {
        mimeType: "image/png",
        base64: portraitPng().toString("base64"),
      });
      if (photo.status !== 200 || !photo.body.hasPhoto)
        throw new Error(`photo upload -> ${photo.status} ${JSON.stringify(photo.body)}`);
      log(`citizen ${tag}: photo stored`);
    }
    return { client, citizenId };
  }

  const withPhoto = await makeCitizen("photo", true);
  const noPhoto = await makeCitizen("plain", false);
  const chairman = new Client();
  await chairman.login(`chairman-${runId}@certno.test`, password);

  async function issue(citizen: { client: Client; citizenId: string }, serviceNo: number): Promise<any> {
    const created = await citizen.client.call("POST", "/applications", {
      citizenId: citizen.citizenId, serviceNo, payload: demoPayloads[serviceNo],
    });
    if (created.status !== 201) throw new Error(`create svc ${serviceNo} -> ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    const appId = created.body.id as string;
    const submitted = await citizen.client.call("POST", `/applications/${appId}/transition`, { action: "submit" });
    if (submitted.status !== 200 || submitted.body.state !== "SUBMITTED")
      throw new Error(`submit svc ${serviceNo} -> ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 300)}`);
    const approved = await chairman.call("POST", `/applications/${appId}/transition`, { action: "approve" });
    if (approved.status !== 200 || approved.body.state !== "ISSUED")
      throw new Error(`approve svc ${serviceNo} -> ${approved.status} ${JSON.stringify(approved.body).slice(0, 300)}`);
    return approved.body.certificate;
  }

  const results: SampleResult[] = [];
  async function sample(name: string, citizen: { client: Client; citizenId: string }, serviceNo: number, langs: ("bn" | "en")[]) {
    const r: SampleResult = { sample: name, service: serviceNo, ok: false, files: [] };
    try {
      const cert = await issue(citizen, serviceNo);
      r.certificateNumber = cert?.number;
      if (!/^\d{16}$/.test(String(cert?.number))) throw new Error(`number is not 16 digits: ${cert?.number}`);
      for (const lang of langs) {
        const pdf = await chairman.raw(`/certificates/${cert.id}/pdf${lang === "en" ? "?lang=en" : ""}`);
        if (pdf.status !== 200 || pdf.buf.subarray(0, 4).toString() !== "%PDF")
          throw new Error(`pdf ${lang} -> status=${pdf.status} bytes=${pdf.buf.length}`);
        const file = `${name}-${lang}.pdf`;
        fs.writeFileSync(path.join(outDir, file), pdf.buf);
        r.files!.push(file);
      }
      r.ok = true;
      log(`${name}: ISSUED ${cert.number} -> ${r.files!.join(", ")}`);
    } catch (e: any) {
      r.stage = "issue";
      r.detail = e.message;
      log(`${name}: FAIL — ${e.message}`);
    }
    results.push(r);
  }

  // (a) service 12 Bangla + English pair (citizen WITH photo).
  await sample("svc12", withPhoto, 12, ["bn", "en"]);
  // (b) without-photo pair, same service (citizen WITHOUT photo).
  await sample("svc12-nophoto", noPhoto, 12, ["bn"]);
  // (c) table family: service 3 (succession / heirs).
  await sample("svc03", withPhoto, 3, ["bn", "en"]);
  // (d) service 42 trade licence.
  await sample("svc42", withPhoto, 42, ["bn", "en"]);
  // (e) service 1 holding-tax receipt.
  await sample("svc01", withPhoto, 1, ["bn", "en"]);
  // (f) service 27 passport recommendation letter.
  await sample("svc27", withPhoto, 27, ["bn", "en"]);

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ runId, tenantId: tenant.id, results }, null, 2));
  const ok = results.filter((r) => r.ok).length;
  log(`== CERTNO PROOF (${outName}): ${ok}/${results.length} samples issued ==`);
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(1); });
