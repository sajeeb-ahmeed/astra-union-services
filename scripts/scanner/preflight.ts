/** Scanner readiness preflight (T-002).
 *
 * Document-bearing browser tests can only pass when some verdict path
 * exists for quarantined uploads: either the test fixture stands in for
 * the worker (ATTACHMENT_SCANNER_SECRET set, so the fixture may claim
 * and finish scan jobs over the internal scanner API), or a real ClamAV
 * engine is up AND a scanner worker is alive (recent heartbeat).
 *
 * The fixture path is test-only by construction: the secret lives only
 * in the local/CI test environment, the fixture code lives under
 * apps/web/test (never shipped in the app bundle), and the internal
 * scanner API refuses browser traffic (no Cookie/Origin headers) and
 * requires the 64-hex bearer secret. Production keeps its own
 * provisioned secret and its own outbound worker; nothing here weakens
 * production quarantine — an unscanned file still 409s on submit.
 */
import pg from "pg";
import { engineIdentity } from "./clamd.js";

const SECRET_PATTERN = /^[a-f0-9]{64}$/i;
const HEARTBEAT_FRESH_MS = 15 * 60_000;

export type ScannerVerdictPath =
  | { mode: "fixture"; detail: string }
  | { mode: "real-clamd"; detail: string }
  | { mode: "none"; detail: string };

export function fixtureSecretValid(secret: string | undefined): boolean {
  return typeof secret === "string" && SECRET_PATTERN.test(secret.trim());
}

/** Pure decision step: given the environment, an engine probe result and
 * the freshest worker heartbeat (null when unknown), say which verdict
 * path — if any — is available. Kept side-effect free so it is unit
 * testable without a database or a daemon. */
export function decideScannerVerdictPath(input: {
  secret?: string;
  engineUp?: boolean;
  engineDetail?: string;
  heartbeatSeenAt?: Date | null;
  now?: Date;
}): ScannerVerdictPath {
  const now = input.now ?? new Date();
  if (input.secret !== undefined && input.secret !== "") {
    if (fixtureSecretValid(input.secret)) {
      return {
        mode: "fixture",
        detail:
          "ATTACHMENT_SCANNER_SECRET is set: the browser-test fixture may claim/finish scan jobs over the internal scanner API (test environments only).",
      };
    }
    return {
      mode: "none",
      detail:
        "ATTACHMENT_SCANNER_SECRET is set but is not 64 lowercase hexadecimal characters, so the internal scanner API will reject it. Generate a fresh 32-byte secret (openssl rand -hex 32) and set it only in the test environment.",
    };
  }
  if (!input.engineUp) {
    return {
      mode: "none",
      detail:
        "No scanner verdict path: ATTACHMENT_SCANNER_SECRET is unset (fixture scanner unavailable) and no ClamAV daemon answered on 127.0.0.1:3310. Set the fixture secret for the test environment, or start the real engine and worker (npm run scanner:check, then npm run scanner:run).",
    };
  }
  const heartbeat = input.heartbeatSeenAt;
  if (heartbeat && now.getTime() - heartbeat.getTime() <= HEARTBEAT_FRESH_MS) {
    return {
      mode: "real-clamd",
      detail: `Real ClamAV engine is up (${input.engineDetail ?? "identity verified"}) and a scanner worker heartbeat was seen ${Math.round((now.getTime() - heartbeat.getTime()) / 1000)}s ago.`,
    };
  }
  return {
    mode: "none",
    detail:
      "No scanner verdict path: a ClamAV engine answered, but no scanner worker heartbeat was seen in the last 15 minutes. Start the outbound worker (npm run scanner:run with ~/.astra-scanner/worker.json), or set ATTACHMENT_SCANNER_SECRET for the fixture scanner instead.",
  };
}

/** Best-effort read of the freshest scanner-worker heartbeat. Returns
 * null when the database is unreachable or no heartbeat exists — the
 * caller treats that as "no worker seen", never as a crash. */
export async function readLastScannerHeartbeat(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Date | null> {
  const connectionString =
    env.DATABASE_ADMIN_URL || env.DATABASE_URL;
  if (!connectionString) return null;
  const db = new pg.Pool({ connectionString, max: 1 });
  try {
    const rows = (
      await db.query(
        "SELECT MAX(seen_at) AS seen FROM attachment_scanner_heartbeats",
      )
    ).rows;
    const seen = rows[0]?.seen;
    return seen ? new Date(seen) : null;
  } catch {
    return null;
  } finally {
    await db.end();
  }
}

export async function resolveScannerVerdictPath(
  env: NodeJS.ProcessEnv = process.env,
  clamdPort = 3310,
): Promise<ScannerVerdictPath> {
  const secret = env.ATTACHMENT_SCANNER_SECRET;
  if (secret !== undefined && secret !== "") {
    return decideScannerVerdictPath({ secret });
  }
  let engineDetail: string | undefined;
  let engineUp = false;
  try {
    const identity = await engineIdentity({
      port: clamdPort,
      timeoutMs: 5000,
    });
    engineUp = true;
    engineDetail = `${identity.engineVersion} signatures ${identity.signatureVersion}`;
  } catch {
    engineUp = false;
  }
  const heartbeatSeenAt = engineUp ? await readLastScannerHeartbeat(env) : null;
  return decideScannerVerdictPath({
    engineUp,
    engineDetail,
    heartbeatSeenAt,
  });
}

export async function assertScannerVerdictPath(
  env: NodeJS.ProcessEnv = process.env,
  clamdPort = 3310,
): Promise<ScannerVerdictPath> {
  const path = await resolveScannerVerdictPath(env, clamdPort);
  if (path.mode === "none") {
    throw new Error(
      `Scanner readiness preflight failed (T-002): ${path.detail} ` +
        "Document-bearing tests would fail with 409 ATTACHMENT_NOT_READY. " +
        "See docs/ATTACHMENT_SCANNER_RUNTIME.md.",
    );
  }
  return path;
}

/** Probe whether the RUNNING API accepts the fixture secret.
 *
 * The web runner reuses an already-running dev stack, so a secret set
 * only in the runner's environment is not enough — the API process must
 * hold the same secret. This posts an empty body to the finish endpoint:
 * the scanner-auth middleware runs first, so a mismatched secret answers
 * 401 while an accepted secret answers with a validation error instead.
 * No scan job is touched (the body fails validation before any write).
 * Returns false when the API is unreachable or rejects the secret. */
export async function probeFixtureSecret(
  apiOrigin: string,
  secret: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${apiOrigin}/api/v1/internal/attachment-scans/finish`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(5000),
      },
    );
    return response.status !== 401;
  } catch {
    return false;
  }
}
