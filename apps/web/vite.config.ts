import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({
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
  build: { outDir: "dist", emptyOutDir: true },
});
