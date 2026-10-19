import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const origin = new URL(process.env.ASTRA_LIVE_URL ?? "");
const configuration = JSON.parse(
  fs.readFileSync(".runtime/hosted/credentials.json", "utf8"),
);
assert.equal(origin.origin, configuration.publicOrigin);
assert.equal(origin.protocol, "https:");
assert.equal(origin.pathname, "/");
assert.equal(
  origin.username + origin.password + origin.search + origin.hash,
  "",
);
const prefix = process.env.ASTRA_ASSET_EVIDENCE_PREFIX ?? "security";
assert.match(prefix, /^[a-z][a-z0-9-]*$/);
const output = `execution/${prefix}-live-assets.json`;
const evidence = {
  executedAt: new Date().toISOString(),
  baseUrl: origin.origin,
  status: "RUNNING",
  assets: [],
};
const save = () =>
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const index = await fetch(origin, {
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  assert.equal(index.status, 200);
  const html = await index.text();
  for (const name of fs
    .readdirSync("apps/web/dist/assets")
    .filter((file) => /\.(js|css)$/.test(file))) {
    if (name.startsWith("index-")) assert.ok(html.includes(`/assets/${name}`));
    const response = await fetch(`${origin.origin}/assets/${name}`, {
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      hash(bytes),
      hash(fs.readFileSync(`apps/web/dist/assets/${name}`)),
    );
    assert.match(response.headers.get("cache-control") ?? "", /immutable/);
    evidence.assets.push({
      name,
      bytes: bytes.length,
      sha256: hash(bytes),
      matchesLocalBuild: true,
      immutableCache: true,
    });
  }
  evidence.status = "PASS";
  save();
  console.log(
    `PASS: ${evidence.assets.length} live JavaScript/CSS files match the tested build.`,
  );
} catch {
  evidence.status = "FAIL";
  save();
  console.error("Live asset verification failed; no success claimed.");
  process.exitCode = 1;
}
