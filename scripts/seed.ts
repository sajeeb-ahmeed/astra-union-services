import fs from "node:fs";
import pg from "pg";
import { createHash } from "node:crypto";
import { hashPassword } from "../apps/api/src/security.js";
import { assertSeedAllowed } from "./seed-guard.js";
// S-003/A-004: fail loudly before opening any database connection when the
// environment is not explicitly non-production. The seed creates 13 accounts
// sharing the published password Demo-Phase1!; they must never exist on a
// live database.
assertSeedAllowed();
import {
  serviceCatalog,
  getServiceSchema,
  getCatalogPreviewSchema,
  stableSchemaJson,
  allServiceSchemaVersions,
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
    "INSERT INTO platform_users(id,email,display_name,password_hash,platform_role) VALUES($1,'owner@astra.demo.test','Platform owner',$2,'owner') ON CONFLICT(email) DO NOTHING",
    [ownerId, hashPassword("Demo-Phase1!")],
  );
  await db.query(
    "INSERT INTO subscription_plans(id,name,price_minor,currency,grant_credits,duration_days,rollover) VALUES('standard-monthly','Standard Monthly',0,'BDT',20,30,true) ON CONFLICT(id) DO NOTHING",
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
    // Every historical version stays published so pinned applications keep validating against their own schema.
    for (const historical of allServiceSchemaVersions.filter(
      (item) => item.serviceNo === no && item.version !== schema.version,
    )) {
      const historicalJson = stableSchemaJson(historical),
        historicalHash = createHash("sha256").update(historicalJson).digest("hex");
      await db.query(
        "INSERT INTO service_versions(service_no,version,schema_json,schema_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [no, historical.version, historicalJson, historicalHash],
      );
      const stored = (
        await db.query(
          "SELECT schema_hash FROM service_versions WHERE service_no=$1 AND version=$2",
          [no, historical.version],
        )
      ).rows[0];
      if (stored.schema_hash !== historicalHash)
        throw new Error(
          `Immutable schema drift detected for service ${no} version ${historical.version}.`,
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
      "INSERT INTO tenants(id,slug,name_bn,name_en,demo) VALUES($1,$2,$3,$4,true) ON CONFLICT(slug) DO NOTHING",
      [
        tenantId,
        slug,
        slug === "alpha" ? "আলফা ইউনিয়ন" : "বেটা ইউনিয়ন",
        `${slug === "alpha" ? "Alpha" : "Beta"} Union`,
      ],
    );
    await db.query(
      "INSERT INTO tenant_wallets(tenant_id) VALUES($1) ON CONFLICT DO NOTHING",
      [tenantId],
    );
    await db.query(
      "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status,plan_duration_days,plan_grant_credits,plan_allowance_limit) SELECT $1,id,now()+interval '90 days','ACTIVE',duration_days,grant_credits,monthly_allowance_limit FROM subscription_plans WHERE id='standard-monthly' ON CONFLICT DO NOTHING",
      [tenantId],
    );
    await db.query(
      "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,20,'PLAN_GRANT','seed-demo-v1',$2,'Initial credit grant',0) ON CONFLICT DO NOTHING",
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
          `${role}@${slug}.local.test`,
          `${slug} ${role}`,
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
            "INSERT INTO approval_authorizations(tenant_id,user_id,service_no,authority_note) VALUES($1,$2,$3,'Initial authorization for office setup') ON CONFLICT DO NOTHING",
            [tenantId, userId, no],
          );
      if (role === "citizen")
        await db.query(
          "INSERT INTO citizens(id,tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
          [
            fixtureId(`${slug}:citizen-profile`),
            tenantId,
            userId,
            "করিম উদ্দিন",
            "Karim Uddin",
            "1995-01-01",
            "স্থানীয় গ্রাম, স্থানীয় ইউনিয়ন",
            "Local village, local union",
            `REF-${slug.toUpperCase()}-001`,
          ],
        );
    }
    for (const { service_no: no } of serviceCatalog)
      await db.query(
        "INSERT INTO tenant_service_configuration(tenant_id,service_no) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [tenantId, no],
      );
    await db.query(
      "UPDATE tenants SET division=$2,district=$3,upazila=$4 WHERE id=$1 AND division='Local division'",
      [
        tenantId,
        slug === "alpha" ? "Dhaka" : "Chattogram",
        slug === "alpha" ? "Dhaka" : "Cumilla",
        slug === "alpha" ? "Savar" : "Sadar",
      ],
    );
    await db.query(
      "INSERT INTO notices(id,tenant_id,title_bn,title_en,body_bn,body_en,published,created_by) VALUES($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT DO NOTHING",
      [
        fixtureId(`${slug}:welcome-notice`),
        tenantId,
        "সেবা চালু",
        "Services available",
        "এই অফিসে ৪৭টি সেবা চালু আছে।",
        "All services are available at this office.",
        fixtureId(`${slug}:admin`),
      ],
    );
    if (slug === "alpha") {
      // CERTASSETS-01: the shipped Belabo office seal artwork becomes this
      // seeded office's profile SEAL version 1, so the local/test context
      // exercises the office-profile asset resolution with the real artwork.
      // (The production Belabo office is migrated as a redeploy-time data
      // step — no production SQL is written here.)
      // On a clean GitHub checkout the seal exists only as seal.png.b64
      // (binary assets travel as base64 text); decode it inline when the
      // materialised .png is absent so seeding works before any build.
      const sealPath = "apps/api/assets/offices/belabo-up/seal.png";
      const sealBytes = fs.existsSync(sealPath)
        ? fs.readFileSync(sealPath)
        : Buffer.from(
            fs.readFileSync(`${sealPath}.b64`, "utf8").replace(/\s+/g, ""),
            "base64",
          );
      const inserted = await db.query(
        "INSERT INTO office_certificate_assets(id,tenant_id,kind,version,mime_type,byte_length,content_sha256,bytes,uploaded_by) VALUES($1,$2,'SEAL',1,'image/png',$3,$4,$5,$6) ON CONFLICT (tenant_id,kind,version) DO NOTHING RETURNING id",
        [
          fixtureId("alpha:cert-asset-seal-v1"),
          tenantId,
          sealBytes.length,
          createHash("sha256").update(sealBytes).digest("hex"),
          sealBytes,
          fixtureId("alpha:admin"),
        ],
      );
      if (inserted.rowCount)
        await db.query(
          "INSERT INTO office_certificate_asset_changes(tenant_id,asset_id,kind,version,action,reason,changed_by) VALUES($1,$2,'SEAL',1,'UPLOADED',NULL,$3)",
          [tenantId, inserted.rows[0].id, fixtureId("alpha:admin")],
        );
    }
  }
  await db.query("COMMIT");
  console.log(
    "Seeded 2 tenants, 13 users, 47 catalog entries and operational schemas.",
  );
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  db.release();
  await pool.end();
}
