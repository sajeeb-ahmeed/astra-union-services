import { app } from "./app.js";
import { pool } from "./db.js";
import { closePdfBrowser } from "./pdf.js";
import { enforceRuntimeConfig, configureProxyTrust } from "./http-hardening.js";
import { mountWeb } from "./web-assets.js";
enforceRuntimeConfig();
configureProxyTrust(app);
if (process.env.NODE_ENV === "production" || process.env.SERVE_WEB === "true")
  mountWeb(app);
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(
    `Astra DEMO server on http://${host}:${port}; PostgreSQL; official issuance disabled.`,
  ),
);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 15_000);
    timeout.unref();
    server.close(async () => {
      await closePdfBrowser();
      await pool.end();
      process.exit(0);
    });
  });
