import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { root } from "./backup.mjs";
import { runTool } from "./managed-recovery.mjs";

export async function startFreshCluster() {
  // Never stop an existing listener or reuse an existing data directory.
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", () =>
      reject(Error("Port 55433 is occupied; existing server was not changed.")),
    );
    listener.listen(55433, "127.0.0.1", () => listener.close(resolve));
  });
  const runtime = path.join(root, ".runtime");
  const label = `managed-recovery-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const directory = path.join(runtime, label);
  const data = path.join(directory, "data");
  await fs.mkdir(directory, { mode: 0o700 });
  const password = crypto.randomBytes(32).toString("hex");
  const passwordPath = path.join(directory, "init-password.tmp");
  await fs.writeFile(passwordPath, password + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await runTool(
      "initdb",
      [
        "-D",
        data,
        "-U",
        "astra_recovery_operator",
        "-E",
        "UTF8",
        "--locale=C",
        "--auth=scram-sha-256",
        `--pwfile=${passwordPath}`,
      ],
      { diagnostic: path.join(directory, "initdb.log") },
    );
  } finally {
    await fs.unlink(passwordPath);
  }
  // pg_ctl exits while its server survives. The server log is a private fixed path.
  await runTool(
    "pg_ctl",
    [
      "start",
      "-D",
      data,
      "-l",
      path.join(directory, "postgres.log"),
      "-o",
      "-h 127.0.0.1 -p 55433 -c log_statement=none -c log_min_error_statement=panic",
      "-w",
      "-t",
      "30",
    ],
    { diagnostic: path.join(directory, "start.log") },
  );
  const configuration = {
    dataDirectory: data,
    port: 55433,
    adminUrl: `postgresql://astra_recovery_operator:${password}@127.0.0.1:55433/postgres`,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(runtime, "managed-recovery-cluster.json"),
    JSON.stringify(configuration),
    { mode: 0o600 },
  );
  return configuration;
}

export async function stopOwnedCluster(configuration) {
  const actual = path.resolve(configuration.dataDirectory);
  if (
    configuration.port !== 55433 ||
    path.dirname(path.dirname(actual)) !== path.join(root, ".runtime") ||
    !/^managed-recovery-[0-9]+-[a-f0-9]{8}$/.test(
      path.basename(path.dirname(actual)),
    ) ||
    path.basename(actual) !== "data"
  )
    throw Error("Unrecognized recovery cluster path.");
  await runTool("pg_ctl", [
    "stop",
    "-D",
    actual,
    "-m",
    "fast",
    "-w",
    "-t",
    "30",
  ]);
}

async function main() {
  if (process.argv[2] === "start") {
    await startFreshCluster();
    console.log(
      "Fresh independent recovery cluster ready on loopback:55433. Credentials kept private.",
    );
  } else if (process.argv[2] === "stop") {
    await stopOwnedCluster(
      JSON.parse(
        await fs.readFile(
          path.join(root, ".runtime", "managed-recovery-cluster.json"),
          "utf8",
        ),
      ),
    );
    console.log(
      "Owned recovery cluster stopped; all recovered files retained.",
    );
  } else throw Error("Usage: managed-cluster.mjs start | stop");
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      `Recovery cluster operation failed (${error.code ?? error.name}). No existing cluster was replaced.`,
    );
    process.exitCode = 1;
  });
