import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { app } from "../src/app.js";
import { pool, adminConnectionString, transaction } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import { readGeographyDataset } from "../../../scripts/geography-data.js";

process.env.NODE_ENV = "test";
const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
type Session = { cookie: string; csrf: string };
let owner: Session,
  officeAdmin: Session,
  citizenSession: Session,
  office: any,
  citizenId: string;
const suffix = randomUUID().slice(0, 8);
const geo = {
  divisionCode: "div-02",
  districtCode: "dis-19",
  upazilaCode: "upa-089",
  unionCode: "uni-0001",
  wardCode: "uni-0001-w01",
};
const signup = {
  email: `geo-citizen-${suffix}@example.test`,
  password: "Geography-test-Password!",
  displayName: "Geography test citizen",
  nameBn: "অবস্থান পরীক্ষার নাগরিক",
  nameEn: "Geography Test Citizen",
  dateOfBirth: "1996-02-03",
  addressBn: "পরীক্ষা গ্রামের ঠিকানা",
  addressEn: "Test village address",
};
async function request(
  method: string,
  path: string,
  body?: unknown,
  session?: Session,
) {
  const r = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
async function login(email: string, password: string) {
  const r = await request("POST", "/auth/login", { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: r.body.csrfToken,
  };
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  owner = await login("owner@astra.demo.test", "Demo-Phase1!");
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("GEO-01: pinned source counts, bilingual hierarchy, provenance and bounded cached public lists", async () => {
  const source = readGeographyDataset();
  assert.deepEqual(source.metadata.counts, {
    divisions: 8,
    districts: 64,
    upazilas: 495,
    unions: 4586,
    wards: 41274,
  });
  const metadata = await request("GET", "/geography/metadata");
  assert.equal(metadata.status, 200);
  assert.deepEqual(metadata.body.counts, source.metadata.counts);
  assert.equal(metadata.body.identifiersAreOfficial, false);
  assert.equal(metadata.body.wardsDerived, true);
  assert.ok(
    metadata.body.upazilasWithoutUnions.some((u: any) => u.code === "upa-388"),
  );
  const divisions = await request("GET", "/geography/divisions");
  assert.equal(divisions.body.total, 8);
  assert.match(divisions.headers.get("cache-control")!, /public, max-age=3600/);
  assert.ok(divisions.headers.get("etag"));
  for (const [level, parent] of [
    ["districts", geo.divisionCode],
    ["upazilas", geo.districtCode],
    ["unions", geo.upazilaCode],
    ["wards", geo.unionCode],
  ]) {
    const r = await request("GET", `/geography/${level}?parentCode=${parent}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.total > 0);
    assert.ok(
      r.body.items.every(
        (v: any) =>
          v.parentCode === parent &&
          v.nameEn &&
          /[\u0980-\u09ff]/u.test(v.nameBn),
      ),
    );
    if (level === "wards") assert.equal(r.body.total, 9);
  }
  assert.deepEqual(
    (await request("GET", "/geography/unions?parentCode=upa-388")).body.items,
    [],
  );
});
test("GEO-02: missing, injected, unknown and unexpected lookup parameters are rejected", async () => {
  for (const path of [
    "/geography/wards",
    "/geography/wards?parentCode=uni-0001&parentCode=uni-0002",
    "/geography/unions?parentCode=upa-089&extra=1",
    "/geography/districts?parentCode=%27%20OR%201%3D1--",
    "/geography/divisions?parentCode=div-01",
  ])
    assert.equal((await request("GET", path)).status, 400, path);
  assert.equal(
    (await request("GET", "/geography/wards?parentCode=uni-9999")).status,
    404,
  );
  assert.equal(
    (await request("GET", "/offices?divisionCode=%27%20OR%201%3D1")).status,
    400,
  );
});
test("GEO-03: owner creates a mapped office from codes and public filtering returns exact jurisdiction", async () => {
  const input = {
    slug: `geo-${suffix}`,
    nameBn: "অবস্থান পরীক্ষা অফিস",
    nameEn: `Geography office ${suffix}`,
    officeType: "UNION",
    geography: { ...geo, wardCode: undefined },
    adminEmail: `geo-admin-${suffix}@example.test`,
    adminName: "Geography Admin",
    adminPassword: "Geography-test-Password!",
  };
  const denied = await request("POST", "/owner/tenants", input);
  assert.equal(denied.status, 401);
  const mismatch = await request(
    "POST",
    "/owner/tenants",
    { ...input, geography: { ...geo, districtCode: "dis-01" } },
    owner,
  );
  assert.equal(mismatch.status, 400);
  const created = await request("POST", "/owner/tenants", input, owner);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  office = created.body;
  assert.equal(office.division, "Chattogram");
  assert.equal(office.district, "Cumilla");
  assert.equal(office.upazila, "Debidwar");
  assert.equal(office.geography.unionCode, geo.unionCode);
  const found = await request(
    "GET",
    `/offices?unionCode=${geo.unionCode}&q=${suffix}`,
  );
  assert.equal(found.body.total, 1);
  assert.equal(found.body.items[0].id, office.id);
  assert.equal(
    (await request("GET", `/offices?divisionCode=div-01&q=${suffix}`)).body
      .total,
    0,
  );
  officeAdmin = await login(input.adminEmail, input.adminPassword);
});
test("GEO-04: registration persists hierarchy, auto reference and rejects jurisdiction bypass atomically", async () => {
  const incomplete = await request("POST", "/auth/signup", {
    ...signup,
    tenantId: office.id,
  });
  assert.equal(incomplete.status, 400);
  const wrong = await request("POST", "/auth/signup", {
    ...signup,
    tenantId: office.id,
    geography: { ...geo, unionCode: "uni-0002", wardCode: "uni-0002-w01" },
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, "GEOGRAPHY_OFFICE_MISMATCH");
  const orphan = await request("POST", "/auth/signup", {
    ...signup,
    tenantId: office.id,
    geography: { ...geo, wardCode: "uni-0002-w01" },
  });
  assert.equal(orphan.status, 400);
  const ok = await request("POST", "/auth/signup", {
    ...signup,
    tenantId: office.id,
    geography: geo,
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  citizenSession = await login(signup.email, signup.password);
  const citizens = await request("GET", "/citizens", undefined, citizenSession);
  assert.equal(citizens.body.items.length, 1);
  citizenId = citizens.body.items[0].id;
  assert.deepEqual(citizens.body.items[0].geography, geo);
  assert.match(citizens.body.items[0].syntheticReference, /^DEMO-/);
  assert.deepEqual(
    (await request("GET", "/profile", undefined, citizenSession)).body
      .geography,
    geo,
  );
  assert.equal(
    (await request("GET", `/offices/${office.slug}`)).body.office.geography
      .unionCode,
    geo.unionCode,
  );
});
test("GEO-05: profile and admin updates validate hierarchy, preserve mappings, and reject text tampering", async () => {
  const ward2 = { ...geo, wardCode: "uni-0001-w02" };
  const saved = await request(
    "PATCH",
    "/profile",
    { displayName: "Updated geography citizen", geography: ward2 },
    citizenSession,
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.geography, ward2);
  const bad = await request(
    "PATCH",
    "/profile",
    {
      displayName: "Should rollback",
      geography: { ...geo, districtCode: "dis-01" },
    },
    citizenSession,
  );
  assert.equal(bad.status, 400);
  assert.equal(
    (await request("GET", "/profile", undefined, citizenSession)).body
      .displayName,
    "Updated geography citizen",
  );
  assert.equal(
    (
      await request(
        "PATCH",
        "/admin/office",
        { district: "False district" },
        officeAdmin,
      )
    ).status,
    400,
  );
  const edit = await request(
    "PATCH",
    "/admin/office",
    { nameEn: "Geography office renamed" },
    officeAdmin,
  );
  assert.equal(edit.status, 200);
  assert.equal(edit.body.unionCode, geo.unionCode);
  const urban = await request(
    "PATCH",
    "/admin/office",
    { officeType: "CITY_CORPORATION", geography: geo },
    officeAdmin,
  );
  assert.equal(urban.status, 400);
  assert.equal(
    (
      await request(
        "PATCH",
        "/admin/office",
        { nameEn: "Attack" },
        citizenSession,
      )
    ).status,
    403,
  );
});
test("GEO-06: PostgreSQL enforces cross-parent constraints, runtime reference immutability and citizen tenant isolation", async () => {
  await assert.rejects(
    pool.query("UPDATE geo_divisions SET name_en='Tamper' WHERE code='div-01'"),
    (e: any) => e.code === "42501",
  );
  await assert.rejects(
    pool.query("INSERT INTO geo_divisions VALUES('div-99','Tamper','পরীক্ষা')"),
    (e: any) => e.code === "42501",
  );
  await assert.rejects(
    admin.query("UPDATE tenants SET district_code='dis-01' WHERE id=$1", [
      office.id,
    ]),
    (e: any) => e.code === "23503",
  );
  const other = (
    await admin.query("SELECT id FROM tenants WHERE id<>$1 LIMIT 1", [
      office.id,
    ])
  ).rows[0];
  const hidden = await transaction(other.id, (db) =>
    db.query("SELECT geography.* FROM citizens geography WHERE id=$1", [
      citizenId,
    ]),
  );
  assert.equal(hidden.rowCount, 0);
  const noScope = await pool.query("SELECT * FROM citizens WHERE id=$1", [
    citizenId,
  ]);
  assert.equal(noScope.rowCount, 0);
});
test("GEO-07: legacy unmapped offices and reference-providing callers remain usable without invented mapping", async () => {
  const legacy = (await request("GET", "/offices?q=alpha")).body.items.find(
    (o: any) => !o.divisionCode,
  );
  assert.ok(legacy, "Seeded Alpha office must remain unmapped");
  assert.equal(legacy.geography, null);
  const withGeo = await request("POST", "/auth/signup", {
    ...signup,
    email: `geo-legacy-${suffix}@example.test`,
    tenantId: legacy.id,
    geography: geo,
  });
  assert.equal(withGeo.status, 201, JSON.stringify(withGeo.body));
  const without = await request("POST", "/auth/signup", {
    ...signup,
    email: `geo-old-${suffix}@example.test`,
    tenantId: legacy.id,
    syntheticReference: `DEMO-GEO-${suffix}`,
  });
  assert.equal(without.status, 201, JSON.stringify(without.body));
});
