/**
 * Offsite backup artefact producer (Phase 8 prep).
 *
 * Produces ONE self-describing backup artefact set in BACKUP_DIR:
 *   <prefix>-<UTC timestamp>.dump            pg_dump custom-format archive
 *   <prefix>-<UTC timestamp>.dump.sha256     sha256sum-compatible sidecar
 *   <prefix>-<UTC timestamp>.manifest.json   metadata (no credentials)
 *
 * Why this exists alongside scripts/backup/backup.mjs: that tool is the
 * encrypted local recovery system and is deliberately locked to a loopback
 * database literally named "astra" (see its validateConfiguration), so it
 * cannot run against the production database (cebaposc_digitalunion).
 * This script is the portable counterpart: it takes every path and
 * credential from the environment, so the SAME file runs unchanged on a
 * developer machine, in CI, or on the cPanel server (e.g. from cron).
 *
 * Environment:
 *   DATABASE_URL  (required) connection URL of the database to dump.
 *                 Use a role that can read every table. On cPanel the
 *                 production DATABASE_URL qualifies (the app DB user owns
 *                 the database). On the local cluster the app role is
 *                 RLS-restricted by design, so pass an admin URL there.
 *   BACKUP_DIR    (default ./backups) directory for the artefact set.
 *   PG_DUMP_BIN   (default "pg_dump") pg_dump executable.
 *   BACKUP_PREFIX (default "digitalunion") filename prefix.
 *
 * The password is passed to pg_dump through the child process environment
 * only; it is never printed, logged, or written into the manifest.
 *
 * Restore (manual, deliberate — this script never restores):
 *   createdb <newdb>
 *   pg_restore --exit-on-error --no-owner --dbname=<newdb> <file>.dump
 * Verify the artefact before restoring:  sha256sum -c <file>.dump.sha256
 *
 * Offsite copy: this script only PRODUCES the artefact. Copying it off the
 * server (owner's storage of choice) is a separate, owner-decided step.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

function fail(message) {
  console.error(`offsite-backup: ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is not set.");
let url;
try {
  url = new URL(databaseUrl);
} catch {
  fail("DATABASE_URL is not a valid URL.");
}
if (!["postgres:", "postgresql:"].includes(url.protocol))
  fail("DATABASE_URL must be a postgres:// URL.");
const database = decodeURIComponent(url.pathname.slice(1));
if (!database) fail("DATABASE_URL does not name a database.");

const backupDir = path.resolve(process.env.BACKUP_DIR ?? "backups");
const pgDumpBin = process.env.PG_DUMP_BIN ?? "pg_dump";
const prefix = (process.env.BACKUP_PREFIX ?? "digitalunion").replace(
  /[^a-zA-Z0-9_-]/g,
  "-",
);

function childEnv() {
  return {
    // Inherited PG* variables must not redirect the validated URL.
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith("PG"),
      ),
    ),
    PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: "10",
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const errors = [];
    const child = spawn(command, args, {
      env: childEnv(),
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (bytes) => errors.push(bytes));
    child.once("error", (error) =>
      reject(new Error(`${command} could not execute (${error.code ?? "unknown"}).`)),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${command} failed (exit ${code}): ${Buffer.concat(errors).toString("utf8").trim().slice(0, 500)}`,
            ),
          ),
    );
  });
}

function runCapture(command, args) {
  return new Promise((resolve) => {
    const out = [];
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (bytes) => out.push(bytes));
    child.once("error", () => resolve(""));
    child.once("exit", () => resolve(Buffer.concat(out).toString("utf8").trim()));
  });
}

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const stampIso = new Date().toISOString();
const filename = `${prefix}-${stamp}.dump`;
const dumpPath = path.join(backupDir, filename);

await fs.mkdir(backupDir, { recursive: true });

try {
  await run(pgDumpBin, [
    "--format=custom",
    "--no-owner",
    `--file=${dumpPath}`,
  ]);
} catch (error) {
  await fs.rm(dumpPath, { force: true });
  fail(error.message);
}

const dump = await fs.readFile(dumpPath);
if (!dump.subarray(0, 5).equals(Buffer.from("PGDMP"))) {
  await fs.rm(dumpPath, { force: true });
  fail("pg_dump output does not start with the PGDMP magic; artefact discarded.");
}
const sha256 = crypto.createHash("sha256").update(dump).digest("hex");
await fs.writeFile(`${dumpPath}.sha256`, `${sha256}  ${filename}\n`, {
  mode: 0o600,
});
const manifest = {
  file: filename,
  createdAt: stampIso,
  bytes: dump.length,
  sha256,
  format: "postgresql-custom",
  source: { host: url.hostname, port: url.port || "5432", database },
  pgDumpVersion: await runCapture(pgDumpBin, ["--version"]),
};
await fs.writeFile(
  path.join(backupDir, `${prefix}-${stamp}.manifest.json`),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);

console.log(`Backup artefact: ${dumpPath}`);
console.log(`Bytes: ${dump.length}`);
console.log(`SHA-256: ${sha256}`);
console.log(`Checksum sidecar: ${dumpPath}.sha256`);
console.log(`Manifest: ${path.join(backupDir, `${prefix}-${stamp}.manifest.json`)}`);
