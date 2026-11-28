import net from "node:net";
import { definitionsAcceptable, publishedDailyVersion } from "../../apps/api/src/clamav-freshness.js";

export type EngineIdentity = { engineVersion: string; signatureVersion: string; signatureUpdatedAt: string };
export type ScanVerdict = { verdict: "CLEAN" | "REJECTED" | "ERROR"; reasonCode: "OK" | "UNSAFE_FILE" | "SCAN_LIMIT" | "SCAN_FAILED" | "SCANNER_UNAVAILABLE" };
export type ClamdOptions = { port?: number; timeoutMs?: number };
const maxBytes = 2_097_152;

/** Raw clamd TCP has no authentication. This client deliberately permits only
 * loopback and only VERSIONCOMMANDS/PING/INSTREAM; never daemon file paths. */
export function command(command: "PING" | "VERSIONCOMMANDS" | "INSTREAM", bytes?: Buffer, options: ClamdOptions = {}): Promise<string> {
  const port = options.port ?? 3310, timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000)
    return Promise.reject(new Error("SCANNER_CONFIGURATION_INVALID"));
  if ((command === "INSTREAM") !== Buffer.isBuffer(bytes) || (bytes && (bytes.length === 0 || bytes.length > maxBytes)))
    return Promise.reject(new Error("SCAN_SIZE_INVALID"));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const chunks: Buffer[] = []; let length = 0, settled = false;
    const finish = (error?: string, value?: string) => {
      if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(new Error(error)); else resolve(value!);
    };
    const timer = setTimeout(() => finish("SCANNER_TIMEOUT"), timeoutMs);
    socket.once("error", () => finish("SCANNER_UNAVAILABLE"));
    socket.on("data", chunk => {
      length += chunk.length;
      if (length > 8192) return finish("SCANNER_REPLY_INVALID");
      chunks.push(chunk);
    });
    socket.once("end", () => {
      const reply = Buffer.concat(chunks);
      // Wait for the daemon to close, not merely the first OK record. Trailing
      // records, truncation and mixed OK/ERROR replies must never release a file.
      if (!reply.length || reply.at(-1) !== 0 || reply.subarray(0, -1).includes(0) || /[^\x20-\x7e]/.test(reply.subarray(0, -1).toString("latin1")))
        return finish("SCANNER_REPLY_INVALID");
      finish(undefined, reply.subarray(0, -1).toString("ascii"));
    });
    socket.once("close", () => { if (!settled) finish("SCANNER_REPLY_INVALID"); });
    socket.once("connect", () => {
      socket.write(Buffer.from(`z${command}\0`, "ascii"));
      if (bytes) {
        // At most 2 MiB is queued; one scan per worker keeps memory bounded.
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
          const part = bytes.subarray(offset, offset + 64 * 1024), size = Buffer.alloc(4);
          size.writeUInt32BE(part.length); socket.write(size); socket.write(part);
        }
        socket.write(Buffer.alloc(4));
      }
    });
  });
}

/**
 * Freshness: the shared owner-approved rule in apps/api/src/clamav-freshness.ts
 * — up to 48 h old always; older only while it is the newest daily ClamAV
 * publishes (`publishedDaily`), never past 14 days; unknown published = 48 h.
 */
export function parseVersion(reply: string, now = Date.now(), publishedDaily: number | null = null): EngineIdentity {
  const match = /^ClamAV (\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)?)\/(\d+)\/([^|]+)\| COMMANDS: (.+)$/.exec(reply);
  if (!match || !match[4].split(/\s+/).includes("INSTREAM") || !match[4].split(/\s+/).includes("PING")) throw Error("SCANNER_VERSION_INVALID");
  const timestamp = Date.parse(match[3].trim());
  if (Number(match[2]) < 1 || !definitionsAcceptable(timestamp, Number(match[2]), publishedDaily, now))
    throw Error("SCANNER_DEFINITIONS_STALE");
  return { engineVersion: `ClamAV ${match[1]}`, signatureVersion: match[2], signatureUpdatedAt: new Date(timestamp).toISOString() };
}

export { publishedDailyVersion };

export async function engineIdentity(options?: ClamdOptions): Promise<EngineIdentity> {
  if (await command("PING", undefined, options) !== "PONG") throw Error("SCANNER_PING_INVALID");
  const reply = await command("VERSIONCOMMANDS", undefined, options);
  try {
    return parseVersion(reply);
  } catch (error) {
    // Older than 48 h: accept it only while it is still the newest ClamAV publishes.
    if ((error as Error).message !== "SCANNER_DEFINITIONS_STALE") throw error;
    return parseVersion(reply, Date.now(), await publishedDailyVersion());
  }
}

export function parseVerdict(reply: string): ScanVerdict {
  if (reply === "stream: OK") return { verdict: "CLEAN", reasonCode: "OK" };
  if (/^stream: [A-Za-z0-9_.():+ /-]{1,500} FOUND$/.test(reply))
    return { verdict: "REJECTED", reasonCode: /Heuristics\.Limits\./.test(reply) ? "SCAN_LIMIT" : "UNSAFE_FILE" };
  return { verdict: "ERROR", reasonCode: /size limit exceeded/i.test(reply) ? "SCAN_LIMIT" : "SCAN_FAILED" };
}

export async function scanBytes(bytes: Buffer, options?: ClamdOptions): Promise<ScanVerdict> {
  try { return parseVerdict(await command("INSTREAM", bytes, options)); }
  catch { return { verdict: "ERROR", reasonCode: "SCANNER_UNAVAILABLE" }; }
}

/** Harmless standard antivirus test string, generated only in memory. */
export function antivirusTestBytes() {
  return Buffer.from(["X5O!P%@AP[4", "\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""), "ascii");
}

export async function verifyEngine(options?: ClamdOptions) {
  const identity = await engineIdentity(options);
  const clean = await scanBytes(Buffer.from("Astra harmless scanner readiness fixture."), options);
  const test = await scanBytes(antivirusTestBytes(), options);
  if (clean.verdict !== "CLEAN" || test.verdict !== "REJECTED") throw Error("SCANNER_SELF_TEST_FAILED");
  return identity;
}
