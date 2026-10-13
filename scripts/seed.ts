import fs from "node:fs";
import pg from "pg";
import { createHash } from "node:crypto";
import { hashPassword } from "../apps/api/src/security.js";
import {
  serviceCatalog,
  getServiceSchema,
  getCatalogPreviewSchema,
  stableSchemaJson,
} from "@astra/shared-schemas";
const local = fs.existsSync(".runtime/postgres.json")
  ? JSON.parse(fs.readFileSync(".runtime/postgres.json", "utf8"))
  : {};
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_ADMIN_URL ?? local.adminUrl,
});
export function fixtureId(label: string) {
  const h = createHash("sha256").update(`astra-demo:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const db = await pool.connect();
try {
  await db.query("BEGIN");
  const ownerId = fixtureId("owner");
  await db.query(
    "INSERT INTO platform_users(id,email,display_name,password_hash,platform_role) VALUES($1,'owner@astra.demo.test','Demo platform owner',$2,'owner') ON CONFLICT(email) DO NOTHING",
    [ownerId, hashPassword("Demo-Phase1!")],
  );
  await db.query(
    "INSERT INTO subscription_plans(id,name,price_minor,currency,grant_credits,duration_days,rollover) VALUES('demo-monthly','Engineering demo plan — no commercial price',0,'BDT',20,30,true) ON CONFLICT(id) DO NOTHING",
  );
  for (const service of serviceCatalog) {
    const no = service.service_no;
    const schema = getServiceSchema(no);
    const json = stableSchemaJson(schema);
    const hash = createHash("sha256").update(json).digest("hex");
    await db.query(
      "INSERT INTO service_catalog(service_no,name_bn,name_en,category,readiness,reference_evidence) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(service_no) DO UPDATE SET readiness=excluded.readiness",
      [
        no,
        service.name_bn,
        service.name_en,
        service.category_en,
        schema.stage,
        service.evidence_file,
      ],
    );
    await db.query(
      "INSERT INTO service_versions(service_no,version,schema_json,schema_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [no, schema.version, json, hash],
    );
    const saved = (
      await db.query(
        "SELECT schema_hash FROM service_versions WHERE service_no=$1 AND version=$2",
        [no, schema.version],
      )
    ).rows[0];
    if (saved.schema_hash !== hash)
      throw new Error(
        `Immutable schema drift detected for service ${no} version ${schema.version}; publish a new schema version.`,
      );
    if (schema.version !== 1) {
      const historical = getServiceSchema(no, 1),
        historicalJson = stableSchemaJson(historical);
      await db.query(
        "INSERT INTO service_versions(service_no,version,schema_json,schema_hash) VALUES($1,1,$2,$3) ON CONFLICT DO NOTHING",
        [
          no,
          historicalJson,
          createHash("sha256").update(historicalJson).digest("hex"),
        ],
      );
    }
    const preview = getCatalogPreviewSchema(no);
    const previewJson = stableSchemaJson(preview);
    await db.query(
      "INSERT INTO service_versions(service_no,version,schema_json,schema_hash) VALUES($1,0,$2,$3) ON CONFLICT DO NOTHING",
      [no, previewJson, createHash("sha256").update(previewJson).digest("hex")],
    );
  }
  for (const slug of ["alpha", "beta"]) {
    const tenantId = fixtureId(slug);
    await db.query(
      "INSERT INTO tenants(id,slug,name_bn,name_en) VALUES($1,$2,$3,$4) ON CONFLICT(slug) DO NOTHING",
      [
        tenantId,
        slug,
        slug === "alpha" ? "ডেমো আলফা ইউনিয়ন" : "ডেমো বেটা ইউনিয়ন",
        `Demo ${slug === "alpha" ? "Alpha" : "Beta"} Union`,
      ],
    );
    await db.query(
      "INSERT INTO tenant_wallets(tenant_id) VALUES($1) ON CONFLICT DO NOTHING",
      [tenantId],
    );
    await db.query(
      "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status) VALUES($1,'demo-monthly',now()+interval '90 days','ACTIVE') ON CONFLICT DO NOTHING",
      [tenantId],
    );
    await db.query(
      "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,20,'PLAN_GRANT','seed-demo-v1',$2,'Synthetic engineering demonstration grant',0) ON CONFLICT DO NOTHING",
      [tenantId, ownerId],
    );
    for (const role of [
      "admin",
      "approver",
      "reviewer",
      "staff",
      "finance",
      "citizen",
    ]) {
      const userId = fixtureId(`${slug}:${role}`);
      await db.query(
        "INSERT INTO platform_users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING",
        [
          userId,
          `${role}@${slug}.demo.test`,
          `Demo ${slug} ${role}`,
          hashPassword("Demo-Phase1!"),
        ],
      );
      await db.query(
        "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [userId, tenantId, role],
      );
      if (role === "approver")
        for (const { service_no: no } of serviceCatalog)
          await db.query(
            "INSERT INTO approval_authorizations(tenant_id,user_id,service_no,authority_note) VALUES($1,$2,$3,'DEMO ONLY: synthetic test authorization; no legal office credentials') ON CONFLICT DO NOTHING",
            [tenantId, userId, no],
          );
      if (role === "citizen")
        await db.query(
          "INSERT INTO citizens(id,tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
          [
            fixtureId(`${slug}:citizen-profile`),
            tenantId,
            userId,
            "ডেমো নাগরিক",
            "Demo Citizen",
            "1995-01-01",
            "ডেমো গ্রাম, ডেমো ইউনিয়ন",
            "Demo village, demo union",
            `DEMO-${slug.toUpperCase()}-001`,
          ],
        );
    }
    for (const { service_no: no } of serviceCatalog)
      await db.query(
        "INSERT INTO tenant_service_configuration(tenant_id,service_no) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [tenantId, no],
      );
    await db.query(
      "UPDATE tenants SET division=$2,district=$3,upazila=$4 WHERE id=$1 AND division='Demo division'",
      [
        tenantId,
        slug === "alpha" ? "Dhaka" : "Chattogram",
        slug === "alpha" ? "Dhaka" : "Cumilla",
        slug === "alpha" ? "Demo Savar" : "Demo Sadar",
      ],
    );
    await db.query(
      "INSERT INTO notices(id,tenant_id,title_bn,title_en,body_bn,body_en,published,created_by) VALUES($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT DO NOTHING",
      [
        fixtureId(`${slug}:welcome-notice`),
        tenantId,
        "ডেমো সেবা চালু",
        "Demonstration services available",
        "এই অফিসে ৪৭টি সেবার পরীক্ষামূলক আবেদন করা যাবে। সকল নথি ডেমো।",
        "All 47 service application workflows are available for synthetic demonstrations. All certificates are DEMO, not official.",
        fixtureId(`${slug}:admin`),
      ],
    );
  }
  await db.query("COMMIT");
  console.log(
    "Seeded 2 synthetic tenants, 13 demo users, 47 evidence catalog entries and operational demo schemas. No official issuance or identity verification.",
  );
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  db.release();
  await pool.end();
}
