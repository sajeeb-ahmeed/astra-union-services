import { spawn } from "node:child_process";
import path from "node:path";
const executable = process.execPath;
const children = [
  spawn(executable, ["--import", "tsx", "apps/api/src/server.ts"], {
    stdio: "inherit",
  }),
  spawn(
    executable,
    [
      path.resolve("node_modules/vite/bin/vite.js"),
      "--config",
      "apps/web/vite.config.ts",
    ],
    { stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 700);
}
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
