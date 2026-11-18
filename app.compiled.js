/**
 * PHASE8PREP — compiled equivalent of app.js (cPanel / LiteSpeed entry).
 * No tsx registration: the API is pre-compiled to apps/api/dist by tsc.
 * Loaded the same way as app.js; the server is pulled in through a plain
 * dynamic import() call (no top-level await in this module's graph).
 */
import("./apps/api/dist/server.js").catch((error) => {
  console.error(error);
  process.exit(1);
});
