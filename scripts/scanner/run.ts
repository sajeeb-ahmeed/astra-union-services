import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { AttachmentWorker, workerConfiguration } from "./worker.js";

export async function run() {
  const settings = path.join(os.homedir(), ".astra-scanner", "worker.json");
  if (fs.lstatSync(path.dirname(settings)).isSymbolicLink()) throw Error("SCANNER_CONFIG_INVALID");
  if (!fs.statSync(settings).isFile() || fs.lstatSync(settings).isSymbolicLink()) throw Error("SCANNER_CONFIG_INVALID");
  const config = workerConfiguration.parse(JSON.parse(fs.readFileSync(settings, "utf8").replace(/^\uFEFF/, "")));
  const worker = new AttachmentWorker(config);
  const logPath = path.join(path.dirname(settings), "events.ndjson");
  function record(event: object) {
    for (const file of [logPath, logPath + ".previous"]) if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error("SCANNER_LOG_INVALID");
    if (fs.existsSync(logPath) && fs.statSync(logPath).size >= 1_048_576) {
      const previous = logPath + ".previous";
      if (fs.existsSync(previous)) fs.unlinkSync(previous);
      fs.renameSync(logPath, previous);
    }
    fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
  }
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; });
  let lastState = "", failures = 0;
  while (!stopping) {
    let delay = 15_000;
    try {
      const result = await worker.once(); failures = 0;
      if (result.state !== "IDLE" || lastState !== "IDLE") record(result);
      lastState = result.state;
      if (result.state !== "IDLE") delay = 1000;
    } catch {
      failures++;
      if (lastState !== "UNAVAILABLE" || failures % 20 === 0) record({ state: "UNAVAILABLE", detail: "Files remain quarantined. Check engine definitions, connectivity and private configuration." });
      lastState = "UNAVAILABLE"; delay = Math.min(60_000, failures * 15_000);
    }
    if (process.argv.includes("--once")) { if (lastState === "UNAVAILABLE") process.exitCode = 1; break; }
    for (let waited = 0; !stopping && waited < delay; waited += 500) await new Promise(r => setTimeout(r, 500));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().catch(() => { console.error("Scanner configuration could not be loaded. Secret values withheld."); process.exitCode = 1; });
