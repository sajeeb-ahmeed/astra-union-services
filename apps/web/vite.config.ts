import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

// P-009: binary assets travel through GitHub as `.b64` text siblings and
// are decoded by scripts/decode-assets.mjs. Vite copies public/ verbatim
// into dist, so the decode source shipped alongside the decoded binary
// (favicon + font .b64 duplicates, ~0.5 MB). Nothing at runtime reads the
// .b64 files — the repo sources are untouched, only the emitted bundle is
// pruned. Guarded by apps/web/test/bundle-contents.test.ts.
function pruneB64DecodeSources() {
  return {
    name: "prune-b64-decode-sources",
    closeBundle() {
      const outDir = path.resolve("apps/web/dist");
      let pruned = 0;
      (function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (entry.isFile() && entry.name.endsWith(".b64")) {
            fs.rmSync(p);
            pruned += 1;
          }
        }
      })(outDir);
      if (pruned > 0)
        console.log(`prune-b64-decode-sources: removed ${pruned} .b64 file(s) from dist.`);
    },
  };
}
export default defineConfig(({ command }) => {
  // CI uses NODE_ENV=test for API fixtures. A deployment build must still select
  // React's production runtime and JSX transform; Vite otherwise inherits test.
  // This changes only Vite's build process, never the API or browser-test process.
  if (command === "build") process.env.NODE_ENV = "production";
  return {
    root: path.resolve("apps/web"),
    resolve: {
      alias: {
        "@astra/shared-schemas": path.resolve(
          "packages/shared-schemas/src/index.ts",
        ),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: { "/api": "http://127.0.0.1:3001" },
    },
    // Preview serves the production build for the browser suite (see
    // scripts/test-web.ts): it needs the same /api proxy as the dev
    // server, otherwise the built app cannot reach the API. Preview is
    // never used by the deployed site (static dist hosting).
    preview: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: { "/api": "http://127.0.0.1:3001" },
    },
    build: { outDir: "dist", emptyOutDir: true, manifest: true },
    plugins: [pruneB64DecodeSources()],
  };
});
