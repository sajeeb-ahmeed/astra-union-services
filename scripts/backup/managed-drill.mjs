import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { root } from "./backup.mjs";
// Plaintext verify tokens are never stored (migration 017); the drill remembers the ones it creates.
const fixtureVerifyTokens = new Map();
import {
  createManagedBackup,
  restoreManagedArchive,
  readManagedArchive,
  artifactPaths,
  validateSource,
  archiveDirectory,
} from "./managed-recovery.mjs";
import { startFreshCluster, stopOwnedCluster } from "./managed-cluster.mjs";

/** Starts the real HTTP server against only the restored restricted role.
 * Accounts are separately held synthetic QA credentials, never emitted in evidence.
 * This helper also supports an already-restored hosted archive; it never contacts
 * its source and only changes local recovery login/logout sessions.
 */
export async function verifyRecoveredHttp({ name, archive, accounts }) {
  artifactPaths(name);
  assert(Array.isArray(accounts) && accounts.length > 0);
  const settings = JSON.parse(
    await fs.readFile(
      path.join(archiveDirectory, `${name}.recovered.json`),
      "utf8",
    ),
  );
  const appUrl = new URL(settings.appUrl);
  assert.equal(appUrl.hostname, "127.0.0.1");
  assert.equal(appUrl.port, "55433");
  assert.match(appUrl.pathname, /^\/astra_recovered_[a-f0-9]{16}$/);
  assert.equal(appUrl.username, "astra_app");
  assert.equal(appUrl.search + appUrl.hash, "");
  const port = await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const chosen = listener.address().port;
      listener.close(() => resolve(chosen));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const allowed = new Set([
    "PATH",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PLAYWRIGHT_BROWSERS_PATH",
  ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      allowed.has(key.toUpperCase()),
    ),
  );
  Object.assign(env, {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    SERVE_WEB: "true",
    PUBLIC_ORIGIN: origin,
    DATABASE_URL: settings.appUrl,
    DATABASE_ADMIN_URL: settings.appUrl,
    DEMO_WEBHOOK_SECRET: crypto.randomBytes(32).toString("hex"),
    MFA_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
    BKASH_ENVIRONMENT: "disabled",
    BKASH_LIVE_ENABLED: "false",
  });
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/api/src/server.ts"],
    {
      cwd: root,
      env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const logs = [];
  let logBytes = 0;
  let exited = false;
  let spawnFailure;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      if (logBytes < 65536) {
        logs.push(chunk.subarray(0, 65536 - logBytes));
        logBytes += chunk.length;
      }
    });
  child.once("error", (error) => {
    spawnFailure = error;
  });
  child.once("exit", () => {
    exited = true;
  });
  const checks = [];
  const sessions = [];
  const request = (route, session, method = "GET", body) =>
    fetch(origin + "/api/v1" + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Origin: origin,
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const deadline = Date.now() + 30000;
    let health;
    while (Date.now() < deadline) {
      if (exited || spawnFailure)
        throw Error(
          "Recovered HTTP server could not start; private log retained.",
        );
      try {
        const response = await request("/health");
        if (response.status === 200) {
          health = await response.json();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    // The health body also reports which optional keys are configured; the drill checks the core fields.
    assert.deepEqual(
      { status: health?.status, database: health?.database, mode: health?.mode },
      { status: "ok", database: "PostgreSQL", mode: "DEMO_ONLY" },
    );
    checks.push(
      "Actual recovered HTTP server starts with restricted restored credentials and PostgreSQL health passes.",
    );
    const catalog = await request("/services");
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).items.length, 47);
    const home = await fetch(origin, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<div id="root"><\/div>/);
    checks.push(
      "Recovery readiness serves the built frontend and all 47 public catalog entries.",
    );
    const certificates = archive.tables
      .find((t) => t.name === "certificates")
      .rows.map((row) => JSON.parse(row));
    for (const cert of certificates) {
      const token = fixtureVerifyTokens.get(cert.id);
      assert.ok(token, `Drill has no verify token for certificate ${cert.id}.`);
      const response = await request(`/verify/${token}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, cert.status);
      assert.equal(body.demo, true);
      assert.equal(body.pdf, undefined);
      assert.equal(body.fullNameBn, undefined);
    }
    const wrong = await request(
      `/verify/${crypto.randomBytes(32).toString("hex")}`,
    );
    assert.equal(wrong.status, 404);
    assert.equal((await request("/verify/malformed")).status, 404);
    checks.push(
      "Actual HTTP QR verification resolves every recovered certificate and rejects wrong/malformed tokens without PDF or citizen data.",
    );
    for (const account of accounts) {
      const response = await request("/auth/login", undefined, "POST", {
        email: account.email,
        password: account.password,
      });
      assert.equal(
        response.status,
        200,
        "Recovery login must succeed using separately held QA credentials.",
      );
      const body = await response.json();
      assert(
        body.user && body.csrfToken,
        "A complete recovery login session is required; an MFA challenge is not acceptance.",
      );
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert(cookie?.startsWith("astra_session="));
      const session = {
        cookie,
        csrf: body.csrfToken,
        tenantId: body.user.tenantId,
      };
      sessions.push(session);
      const cert =
        certificates.find((c) => c.id === account.certificateId) ??
        certificates.find((c) => c.tenant_id === session.tenantId);
      assert(cert, "QA account must be authorized for a restored certificate.");
      const pdf = await request(`/certificates/${cert.id}/pdf`, session);
      assert.equal(pdf.status, 200);
      assert.match(pdf.headers.get("content-type"), /application\/pdf/);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      const expected = archive.state.certificates.find((c) => c.id === cert.id);
      assert.equal(bytes.length, expected.bytes);
      assert.equal(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        expected.pdf_sha256,
      );
      assert.equal((await request(`/certificates/${cert.id}/pdf`)).status, 401);
      assert.equal(
        (
          await request(`/certificates/${cert.id}/pdf`, {
            cookie: "astra_session=invalid",
            csrf: "invalid",
          })
        ).status,
        401,
      );
      const other = certificates.find((c) => c.tenant_id !== session.tenantId);
      if (other)
        assert.equal(
          (await request(`/certificates/${other.id}/pdf`, session)).status,
          404,
        );
      const configuration = await request("/payments/configuration", session);
      assert.equal(configuration.status, 200);
      const payment = await configuration.json();
      assert.equal(payment.available, false);
      assert.equal(payment.configured, false);
    }
    checks.push(
      "Recovered real-password login delivers byte-identical authorized PDFs; anonymous, invalid-session and available cross-tenant PDF reads are denied.",
    );
    checks.push(
      "Recovered application reports gateway collection disabled; no merchant configuration or source environment was inherited.",
    );
    for (const session of sessions) {
      assert.equal(
        (await request("/auth/logout", session, "POST", {})).status,
        200,
      );
      assert.equal((await request("/auth/me", session)).status, 401);
    }
    sessions.length = 0;
    checks.push(
      "Recovery HTTP acceptance signs out its sessions; no certificate, ledger, fee or payment mutation is made.",
    );
    return {
      status: "PASS",
      verifiedAt: new Date().toISOString(),
      origin,
      sourceAccess: false,
      databasePort: 55433,
      transport:
        "Loopback HTTP; production TLS proxy is outside this rehearsal",
      checks,
    };
  } finally {
    for (const session of sessions)
      await request("/auth/logout", session, "POST", {}).catch(() => {});
    if (!exited) {
      child.kill("SIGTERM");
      let timer;
      try {
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          new Promise((resolve) => {
            timer = setTimeout(resolve, 15000);
            timer.unref();
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (!exited) child.kill("SIGKILL");
    }
    child.stdout.destroy();
    child.stderr.destroy();
    await fs.writeFile(
      path.join(archiveDirectory, `${name}.http-startup.log`),
      Buffer.concat(logs),
      { mode: 0o600 },
    );
  }
}

async function drill() {
  const evidence = {
    executedAt: new Date().toISOString(),
    scope:
      "Synthetic managed-owner source on existing local cluster; fresh independent recovery cluster. No hosted connection.",
    status: "RUNNING",
    checks: [],
  };
  const record = (message) => {
    evidence.checks.push(message);
    console.log(`PASS: ${message}`);
  };
  const local = JSON.parse(
    (
      await fs.readFile(path.join(root, ".runtime", "postgres.json"), "utf8")
    ).replace(/^\uFEFF/, ""),
  );
  const adminUrl = new URL(local.adminUrl);
  assert.equal(adminUrl.hostname, "127.0.0.1");
  assert.equal(adminUrl.port, "55432");
  const control = new pg.Client({ connectionString: adminUrl.toString() });
  await control.connect();
  let cluster;
  const fixtureAccounts = [];
  try {
    const suffix = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const database = `astra_managed_${suffix}`;
    const owner = `astra_migrator_${suffix}`;
    const password = crypto.randomBytes(32).toString("hex");
    const roleSql = (
      await control.query(
        "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',$1::text,$2::text) sql",
        [owner, password],
      )
    ).rows[0].sql;
    await control.query(roleSql);
    if (
      !(await control.query("SELECT 1 FROM pg_roles WHERE rolname='postgres'"))
        .rowCount
    )
      await control.query(
        "CREATE ROLE postgres NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT",
      );
    await control.query(
      `CREATE DATABASE "${database}" OWNER "${owner}" TEMPLATE template0 ENCODING 'UTF8'`,
    );
    const url = new URL(adminUrl);
    url.username = owner;
    url.password = password;
    url.pathname = `/${database}`;
    const fixture = new pg.Client({ connectionString: url.toString() });
    await fixture.connect();
    const fixtureAdminUrl = new URL(adminUrl);
    fixtureAdminUrl.pathname = `/${database}`;
    const fixtureAdmin = new pg.Client({
      connectionString: fixtureAdminUrl.toString(),
    });
    await fixtureAdmin.connect();
    try {
      await fixtureAdmin.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO "${owner}"`,
      );
    } finally {
      await fixtureAdmin.end();
    }
    try {
      await fixture.query(
        "CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const name of (await fs.readdir(path.join(root, "db", "migrations")))
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        await fixture.query("BEGIN");
        await fixture.query(
          await fs.readFile(path.join(root, "db", "migrations", name), "utf8"),
        );
        await fixture.query("INSERT INTO schema_migrations(name) VALUES($1)", [
          name,
        ]);
        await fixture.query("COMMIT");
      }
      const originalPdf = (
        await control.query(
          "SELECT pdf FROM certificates WHERE octet_length(pdf)>1000 LIMIT 1",
        )
      ).rows[0]?.pdf;
      assert(
        originalPdf,
        "Existing local synthetic issuance must provide a real PDF for recovery fixture.",
      );
      await fixture.query(
        "INSERT INTO service_catalog(service_no,name_bn,name_en,category,readiness,reference_evidence) VALUES(45,'পরীক্ষা','Recovery fixture','Fixture','operational_demo','synthetic recovery test')",
      );
      await fixture.query(
        "INSERT INTO service_versions(service_no,version,schema_json,schema_hash) VALUES(45,1,'{}',$1)",
        ["a".repeat(64)],
      );
      for (let n = 0; n < 2; n++) {
        const tenant = crypto.randomUUID(),
          user = crypto.randomUUID(),
          citizen = crypto.randomUUID(),
          application = crypto.randomUUID(),
          certificate = crypto.randomUUID();
        await fixture.query("BEGIN");
        await fixture.query("SELECT set_config('astra.tenant_id',$1,true)", [
          tenant,
        ]);
        await fixture.query("SELECT set_config('astra.account_id',$1,true)", [
          user,
        ]);
        await fixture.query(
          "INSERT INTO tenants(id,slug,name_bn,name_en) VALUES($1,$2,'পুনরুদ্ধার পরীক্ষা','Recovery fixture')",
          [tenant, `recovery-${n}-${suffix}`],
        );
        const email = `recovery-${n}-${suffix}@example.test`,
          loginPassword = crypto.randomBytes(24).toString("hex"),
          salt = crypto.randomBytes(16).toString("hex");
        const passwordHash = `${salt}:${crypto.scryptSync(loginPassword, salt, 64).toString("hex")}`;
        await fixture.query(
          "INSERT INTO platform_users(id,email,display_name,password_hash) VALUES($1,$2,'Synthetic recovery user',$3)",
          [user, email, passwordHash],
        );
        await fixture.query(
          "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'staff')",
          [user, tenant],
        );
        fixtureAccounts.push({
          email,
          password: loginPassword,
          certificateId: certificate,
        });
        await fixture.query(
          "INSERT INTO tenant_wallets(tenant_id) VALUES($1)",
          [tenant],
        );
        await fixture.query(
          "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,10,'TOPUP','fixture-grant',$2,'Synthetic recovery fixture',0)",
          [tenant, user],
        );
        await fixture.query(
          "INSERT INTO citizens(id,tenant_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference) VALUES($1,$2,'পরীক্ষা','Synthetic recovery citizen','2000-01-01','পরীক্ষা','Synthetic address',$3)",
          [citizen, tenant, crypto.randomUUID()],
        );
        await fixture.query(
          "INSERT INTO applications(id,tenant_id,citizen_id,service_no,schema_version,schema_hash,state,fee_method,fee_credits,fee_price_version,fee_settled_at,created_by) VALUES($1,$2,$3,45,1,$4,'ISSUED','CREDIT',1,1,now(),$5)",
          [application, tenant, citizen, "a".repeat(64), user],
        );
        const token = crypto.randomBytes(32).toString("hex");
        fixtureVerifyTokens.set(certificate, token);
        await fixture.query(
          "INSERT INTO certificates(id,tenant_id,application_id,number,service_no,token_hash,pdf,issued_by) VALUES($1,$2,$3,$4,45,$5,$6,$7)",
          [
            certificate,
            tenant,
            application,
            `RECOVERY-${certificate}`,
            crypto.createHash("sha256").update(token).digest("hex"),
            originalPdf,
            user,
          ],
        );
        // Stage 5: the fixture settles at submit (migration 044, W-003) —
        // one APPLICATION_FEE row for the application, not the retired
        // 'ISSUANCE' kind (which no code path writes any more).
        await fixture.query(
          "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,application_id,actor_id,reason,balance_after) VALUES($1,-1,'APPLICATION_FEE',$2,$3,$4,'Synthetic recovery fixture',0)",
          [tenant, `fixture-application-fee-${application}`, application, user],
        );
        await fixture.query("INSERT INTO account_mfa(user_id) VALUES($1)", [
          user,
        ]);
        await fixture.query(
          "INSERT INTO account_security_events(user_id,action) VALUES($1,'MFA_ENROLLMENT_STARTED')",
          [user],
        );
        await fixture.query(
          "INSERT INTO sessions(token_hash,user_id,tenant_id,csrf_token,expires_at) VALUES($1,$2,NULL,'synthetic',now()+interval '1 hour')",
          [crypto.randomBytes(32).toString("hex"), user],
        );
        await fixture.query("COMMIT");
      }
      record(
        "Synthetic source contains two populated tenant scopes, actual PDF bytes, submit-time fee settlements, account scopes and nullable global sessions.",
      );
    } finally {
      await fixture.end();
    }
    const configuration = validateSource({ mode: "local-managed", url });
    await fs.writeFile(
      path.join(root, ".runtime", "managed-fixture.json"),
      JSON.stringify({ adminUrl: url.toString() }),
      { mode: 0o600 },
    );
    const backup = await createManagedBackup(configuration);
    evidence.backup = backup.evidence;
    record(
      "NOSUPERUSER NOBYPASSRLS owner exports all tenants/accounts without source DDL, RLS changes or app-role changes.",
    );
    const archive = await readManagedArchive(backup.name);
    for (const table of ["account_mfa", "account_security_events", "sessions"])
      assert.equal(archive.tables.find((t) => t.name === table).count, 2);
    assert.equal(
      archive.tables.find((t) => t.name === "certificates").count,
      2,
    );
    record(
      "Owner-wide SELECT policies do not duplicate rows; global and account-scoped records survive.",
    );
    const artifact = artifactPaths(backup.name);
    const originalArchive = await fs.readFile(artifact.archivePath),
      originalKey = await fs.readFile(artifact.keyPath);
    const offlineTarget = new URL(
      "postgresql://no_server:synthetic@127.0.0.1:55433/postgres",
    );
    try {
      const changed = Buffer.from(originalArchive);
      changed[changed.length - 1] ^= 1;
      await fs.writeFile(artifact.archivePath, changed);
      await assert.rejects(
        restoreManagedArchive(backup.name, offlineTarget),
        /authentication or structure/,
      );
      await fs.writeFile(artifact.archivePath, originalArchive);
      await fs.writeFile(artifact.keyPath, crypto.randomBytes(32));
      await assert.rejects(
        restoreManagedArchive(backup.name, offlineTarget),
        /authentication or structure/,
      );
      record(
        "Actual restore rejects tampered archive and wrong key before contacting any database.",
      );
    } finally {
      await fs.writeFile(artifact.archivePath, originalArchive);
      await fs.writeFile(artifact.keyPath, originalKey);
    }
    cluster = await startFreshCluster();
    const recovered = await restoreManagedArchive(
      backup.name,
      new URL(cluster.adminUrl),
    );
    evidence.restore = recovered;
    assert.equal(recovered.auxiliaryCatalogRoles, 1);
    assert.equal(recovered.auxiliaryRolesRestrictedNoLogin, true);
    record(
      "Fresh port-55433 cluster restores full data, exact schema/grants/RLS, original object owners and fresh restricted-role credentials.",
    );
    for (const check of recovered.checks) record(check);
    await assert.rejects(
      restoreManagedArchive(backup.name, new URL(cluster.adminUrl)),
      /fresh independent cluster/,
    );
    record(
      "A second restore refuses a nonempty cluster before role/database mutations.",
    );
    await assert.rejects(
      restoreManagedArchive(backup.name, adminUrl),
      /separate loopback/,
    );
    record("Main port-55432 database cannot be selected as restore target.");
    const paths = artifactPaths(backup.name);
    const encrypted = await fs.readFile(paths.archivePath);
    assert(!encrypted.includes(Buffer.from("Synthetic recovery citizen")));
    record(
      "Encrypted archive hides identity strings; key lives outside repository and backup directory.",
    );
    evidence.http = await verifyRecoveredHttp({
      name: backup.name,
      archive,
      accounts: fixtureAccounts,
    });
    for (const check of evidence.http.checks) record(check);
    evidence.status = "PASS";
  } catch (error) {
    evidence.status = "FAIL";
    evidence.failureType = error.code ?? error.name;
    await fs.writeFile(
      path.join(root, ".runtime", "managed-drill-error.log"),
      String(error.stack),
      { mode: 0o600 },
    );
    console.error(
      `Managed recovery drill FAIL (${evidence.failureType}); inspect private .runtime/managed-drill-error.log.`,
    );
    process.exitCode = 1;
  } finally {
    await control.end();
    if (cluster) await stopOwnedCluster(cluster);
    evidence.durationMs = Date.now() - Date.parse(evidence.executedAt);
    await fs.writeFile(
      path.join(root, "execution", "managed-recovery-local-qa.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await drill();
