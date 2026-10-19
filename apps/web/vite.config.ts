import { defineConfig } from "vite";
import path from "node:path";
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
    build: { outDir: "dist", emptyOutDir: true, manifest: true },
  };
});
