/**
 * cPanel / LiteSpeed (lsnode) entry point — in-process, no top-level await.
 * lsnode loads this file with require() from CommonJS, which rejects
 * modules whose graph contains top-level await (ERR_REQUIRE_ASYNC_MODULE).
 * The server is therefore loaded through a plain dynamic import() call.
 */
import { register } from "tsx/esm/api";

register();
import("./apps/api/src/server.ts").catch((error) => {
  console.error(error);
  process.exit(1);
});
