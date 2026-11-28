import test from "node:test";
import assert from "node:assert/strict";
// B-004: the catalog JSON has exactly one importer (service-catalog.ts).
import catalog from "../src/service-catalog.js";
import { PORTAL_GROUPS, POPULAR_SERVICES } from "../src/portal-groups.js";

// PORTAL-LANDING: the home page's seven groups cover every catalog service
// exactly once, so no service disappears from (or doubles on) the home page.
test("portal groups: all 47 services, each exactly once, and every shortcut is a real service", () => {
  const all = PORTAL_GROUPS.flatMap((g) => g.services);
  assert.equal(all.length, 47);
  assert.equal(new Set(all).size, 47, "no service appears twice");
  const numbers = new Set((catalog as { service_no: number }[]).map((s) => s.service_no));
  assert.deepEqual([...new Set(all)].sort((a, b) => a - b), [...numbers].sort((a, b) => a - b));
  assert.deepEqual(
    PORTAL_GROUPS.map((g) => g.services.length),
    [4, 6, 7, 9, 6, 8, 7],
    "the reference portal's group sizes",
  );
  for (const p of POPULAR_SERVICES) assert.ok(numbers.has(p.no), `shortcut ${p.no} is a catalog service`);
});
