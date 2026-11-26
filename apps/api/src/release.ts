/**
 * Release traceability (Batch C / A-002).
 *
 * The deployed bundle carries a `release.json` at its root, written by
 * `scripts/package-cpanel.mjs` at package time:
 *   { packageId, version, commit, branch, builtAt, files, bytes, assets }
 * where `assets` is the web-asset manifest (relative path, bytes, sha256)
 * for every file under `apps/web/dist`.
 *
 * The public health endpoint reports only the non-sensitive subset
 * (version, commit, build time, package id, process start, applied
 * migration version). The admin release endpoint (`GET /api/v1/admin/release`,
 * admin role only) additionally reports the full applied-migration list and
 * the asset manifest. No secrets, credentials, paths with usernames, or
 * environment values are ever included.
 *
 * When `release.json` is absent (a plain source checkout running from the
 * repository), commit / builtAt / packageId are null and the version comes
 * from the nearest `package.json`. That state means "un packaged dev run",
 * never a release.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseInfo = {
  version: string | null;
  commit: string | null;
  branch: string | null;
  builtAt: string | null;
  packageId: string | null;
  files: number | null;
  bytes: number | null;
  assets: Array<{ path: string; bytes: number; sha256: string }>;
};

const startedAt = new Date();

function candidateRoots(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.cwd(),
    path.resolve(here, "..", "..", ".."), // apps/api/src -> repo root (dev, tsx)
    path.resolve(here, "..", "..", "..", ".."), // apps/api/dist -> bundle root (compiled)
    path.resolve(here, "..", ".."), // apps/api/dist -> repo root fallback
  ];
}

function readJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function loadRelease(): ReleaseInfo {
  let releaseJson: Record<string, any> | null = null;
  let packageJson: Record<string, any> | null = null;
  for (const root of candidateRoots()) {
    releaseJson ??= readJson(path.join(root, "release.json"));
    packageJson ??= readJson(path.join(root, "package.json"));
    if (releaseJson && packageJson) break;
  }
  return {
    version: (releaseJson?.version as string | undefined) ?? (packageJson?.version as string | undefined) ?? null,
    commit: (releaseJson?.commit as string | undefined) ?? null,
    branch: (releaseJson?.branch as string | undefined) ?? null,
    builtAt: (releaseJson?.builtAt as string | undefined) ?? null,
    packageId: (releaseJson?.packageId as string | undefined) ?? null,
    files: (releaseJson?.files as number | undefined) ?? null,
    bytes: (releaseJson?.bytes as number | undefined) ?? null,
    assets: Array.isArray(releaseJson?.assets) ? releaseJson.assets : [],
  };
}

export const releaseInfo: ReleaseInfo = loadRelease();

/** Process start time — the closest this server has to a deploy timestamp. */
export function processStartedAt(): Date {
  return startedAt;
}

/** Public, non-sensitive release summary for the health endpoint. */
export function publicRelease(migrationVersion: string | null): Record<string, unknown> {
  return {
    version: releaseInfo.version,
    commit: releaseInfo.commit,
    builtAt: releaseInfo.builtAt,
    packageId: releaseInfo.packageId,
    startedAt: startedAt.toISOString(),
    migrationVersion,
  };
}
