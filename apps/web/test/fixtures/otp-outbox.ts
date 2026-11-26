import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * S-001: a mobile becomes a trusted sign-in identifier only after a code
 * sent to the handset is proven. In the test stack the OTP provider is the
 * "log" provider (NODE_ENV=test, no OTP_PROVIDER), which writes every sent
 * code to the repo-root dev mailbox `.runtime/otp-outbox.log` as JSON lines
 * { mobile, code, purpose, at } — the code itself never appears in the
 * server log. Browser tests read the code back from that mailbox to drive
 * the verify panels in ShortSignup / SignInIdentifiers, exactly as a
 * holder of the handset would type the code from their SMS.
 *
 * Matching is by the last 8 digits of the number (the API normalises the
 * typed form — "+88 019…" → "019…" — before sending) and by send time,
 * so a code from an earlier run for a recycled number can never match.
 */
const outboxPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.runtime/otp-outbox.log",
);

export async function readOtpCode(
  mobileSuffix: string,
  sentAfterMs: number,
  timeoutMs = 20000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const lines = fs
        .readFileSync(outboxPath, "utf8")
        .split("\n")
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        let row: any;
        try {
          row = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        if (
          typeof row?.mobile === "string" &&
          row.mobile.endsWith(mobileSuffix) &&
          typeof row.code === "string" &&
          /^\d{6}$/.test(row.code) &&
          typeof row.at === "string" &&
          new Date(row.at).getTime() >= sentAfterMs - 2000
        ) {
          return row.code;
        }
      }
    } catch {
      // Mailbox not written yet — keep polling until the timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `no OTP code for *${mobileSuffix} in ${outboxPath} within ${timeoutMs}ms`,
  );
}
