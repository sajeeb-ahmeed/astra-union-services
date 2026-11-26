/**
 * B-003 / F-015: the web entry point of @astra/shared-schemas.
 *
 * The package root (index.ts) also carries every historical schema
 * version (expanded-v1-schemas.json, 512 KB on disk) for applications
 * pinned before publication of v2 — the web bundle paid for all of it
 * in the GeographyFields chunk (623 KB). The web only ever needs the
 * CURRENT operational schemas, the form engine, and the completeness
 * helpers, so this entry re-exports exactly those and nothing else:
 * no v1 JSON, no superseded versions, no service-catalog preview
 * helpers, no demo payloads (those stay on the root entry for tests).
 *
 * The one versioned lookup the web needs — an application pinned to a
 * superseded schema version — lives in ./legacy.ts and is dynamically
 * imported on demand by the workspace; see PinnedSchema there.
 */
import { deepFreeze, validateForm } from "./engine.js";
import {
  groupControllerIds,
  operationalSchemas,
  serviceDescriptions,
} from "./schemas.js";
import type { FormSchema } from "./types.js";

export * from "./types.js";
export * from "./engine.js";
export * from "./completeness.js";
export { groupControllerIds, operationalSchemas, serviceDescriptions };

export const operationalServiceNumbers: readonly number[] = deepFreeze(
  operationalSchemas.map((schema) => schema.serviceNo).sort((a, b) => a - b),
);

/**
 * Current-only schema lookup. A pinned (superseded) version is NOT
 * resolved here by design — callers that need one use the legacy entry.
 */
export function getServiceSchema(serviceNo: number): FormSchema {
  const schema = operationalSchemas.find(
    (item) => item.serviceNo === serviceNo,
  );
  if (!schema)
    throw new RangeError(
      `Service ${serviceNo} is not an enabled operational form.`,
    );
  return schema;
}

export function validateServicePayload(serviceNo: number, payload: unknown) {
  return validateForm(getServiceSchema(serviceNo), payload);
}
