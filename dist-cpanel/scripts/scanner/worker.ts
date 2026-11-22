import { createHash } from "node:crypto";
import { z } from "zod";
import { engineIdentity, scanBytes, verifyEngine, type ClamdOptions, type EngineIdentity } from "./clamd.js";

export const workerConfiguration = z.object({
  origin: z.string().url(), secret: z.string().regex(/^[a-f0-9]{64}$/),
  workerId: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  clamdPort: z.number().int().min(1).max(65535).default(3310),
}).strict();
export type WorkerConfiguration = z.infer<typeof workerConfiguration>;
const jobSchema = z.object({
  attachmentId: z.string().uuid(), tenantId: z.string().uuid(),
  mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  byteLength: z.number().int().min(8).max(2_097_152), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  base64: z.string().max(2_796_204), leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
  leaseExpiresAt: z.string().datetime({ offset: true }),
}).strict();
export type ScanJob = z.infer<typeof jobSchema>;

export function validateOrigin(value: string, localTest = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(localTest && url.protocol === "http:" && url.hostname === "127.0.0.1")))
    throw Error("SCANNER_ORIGIN_INVALID");
  return url.origin;
}

export function decodeJob(input: unknown): { job: ScanJob; bytes: Buffer } {
  const job = jobSchema.parse(input);
  const bytes = Buffer.from(job.base64, "base64");
  if (bytes.toString("base64") !== job.base64 || bytes.length !== job.byteLength || createHash("sha256").update(bytes).digest("hex") !== job.sha256 || Date.parse(job.leaseExpiresAt) <= Date.now() + 5000)
    throw Error("SCAN_JOB_INVALID");
  return { job, bytes };
}

/** No redirects, cookies, browser Origin, external file endpoints or disk writes.
 * The configured origin alone receives the scanner credential and verdicts. */
export class AttachmentWorker {
  private readonly origin: string;
  private verifiedIdentity?: string;
  constructor(private readonly config: WorkerConfiguration, private readonly localTest = false) {
    this.config = workerConfiguration.parse(config);
    this.origin = validateOrigin(this.config.origin, localTest);
  }
  private async request(route: "claim" | "finish", body: unknown) {
    const response = await fetch(`${this.origin}/api/v1/internal/attachment-scans/${route}`, {
      method: "POST", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${this.config.secret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json")) throw Error(`SCANNER_API_${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw Error("SCANNER_API_INVALID");
    const parts: Uint8Array[] = []; let count = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        count += value.byteLength;
        if (count > 2_810_000) { await reader.cancel(); throw Error("SCANNER_API_OVERSIZED"); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  }
  async once(): Promise<{ state: "IDLE" | "CLEAN" | "REJECTED" | "ERROR"; attachmentId?: string }> {
    const options: ClamdOptions = { port: this.config.clamdPort };
    const identity = await engineIdentity(options), identityKey = JSON.stringify(identity);
    if (this.verifiedIdentity !== identityKey) {
      const tested = await verifyEngine(options);
      if (JSON.stringify(tested) !== identityKey) throw Error("SCANNER_CHANGED_DURING_CHECK");
      this.verifiedIdentity = identityKey;
    }
    const result = z.object({ job: jobSchema.nullable() }).strict().parse(await this.request("claim", { workerId: this.config.workerId, ...identity }));
    if (!result.job) return { state: "IDLE" };
    const { job, bytes } = decodeJob(result.job);
    try {
      let verdict = await scanBytes(bytes, options);
      let after: EngineIdentity;
      try { after = await engineIdentity(options); }
      catch { throw Error("SCANNER_UNAVAILABLE_AFTER_SCAN"); }
      if (JSON.stringify(after) !== identityKey) verdict = { verdict: "ERROR", reasonCode: "SCAN_FAILED" };
      // Preserve the lease's engine identity. A reload produces ERROR, never an
      // attestation that a different signature set scanned these bytes.
      const accepted = await this.request("finish", {
        attachmentId: job.attachmentId, tenantId: job.tenantId, leaseToken: job.leaseToken,
        sha256: job.sha256, ...verdict, ...identity,
      });
      z.object({ accepted: z.literal(true) }).strict().parse(accepted);
      return { state: verdict.verdict, attachmentId: job.attachmentId };
    } finally { bytes.fill(0); }
  }
}
