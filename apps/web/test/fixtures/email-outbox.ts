import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * S-007: a password-recovery token is NEVER returned in JSON and NEVER put
 * in a URL query param. It is delivered out-of-band only, to the account
 * holder's own email, as a `/recover#token=...` fragment link. In the test
 * stack the mail provider is the "log" provider (NODE_ENV=test, no
 * EMAIL_PROVIDER), which writes every sent message to the repo-root dev
 * mailbox `.runtime/email-outbox.log` as JSON lines { to, subject, text, at }
 * — the link itself never appears in the server log. Browser tests read the
 * link back from that mailbox to drive the reset page, exactly as the
 * holder would open the link from their inbox.
 *
 * Matching is by exact recipient address and by send time, so a link from
 * an earlier run for a recycled address can never match.
 */
const outboxPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.runtime/email-outbox.log",
);

export async function readRecoveryLink(
  recipientEmail: string,
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
          typeof row?.to === "string" &&
          row.to === recipientEmail &&
          typeof row.text === "string" &&
          typeof row.at === "string" &&
          new Date(row.at).getTime() >= sentAfterMs - 2000
        ) {
          const match = row.text.match(/https?:\/\/\S*\/recover#token=\S+/);
          if (match) return match[0];
        }
      }
    } catch {
      // Mailbox not written yet — keep polling until the timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `no recovery link for ${recipientEmail} in ${outboxPath} within ${timeoutMs}ms`,
  );
}
