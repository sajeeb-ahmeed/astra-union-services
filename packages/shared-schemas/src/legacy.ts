/**
 * B-003 / F-015: the lazy legacy entry of @astra/shared-schemas.
 *
 * The versioned lookup over every historical schema version
 * (expanded-v1-schemas.json, 512 KB on disk) — needed only when an
 * application is pinned to a superseded schema version. It is NEVER
 * imported statically by the web bundle: the workspace dynamically
 * imports this entry on demand (see PinnedSchema in WorkspaceApp.tsx),
 * so the historical JSON loads only for the rare old application that
 * actually needs it, never on first paint.
 */
export { getServiceSchema as getLegacyServiceSchema } from "./index.js";
