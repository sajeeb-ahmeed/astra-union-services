/**
 * cPanel / Phusion Passenger entry point.
 *
 * cPanel's "Setup Node.js App" starts the application by loading this file
 * (the startup file configured in the panel). The canonical server entry is
 * a TypeScript module (apps/api/src/server.ts) that Node cannot execute
 * directly; the Docker image runs it as:
 *
 *     node --import tsx apps/api/src/server.ts
 *
 * This shim reproduces exactly that: it spawns the same command as a child
 * process, forwards the panel's PORT/HOST environment untouched, relays
 * SIGINT/SIGTERM so Passenger's restarts shut the server down cleanly, and
 * exits with the child's exit code. All configuration comes from the
 * environment variables set in the cPanel panel (see docs/DEPLOY-CPANEL.md
 * and .env.cpanel.example); no settings live in this file.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(
  process.execPath,
  ["--import", "tsx", "apps/api/src/server.ts"],
  { cwd: root, env: process.env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
