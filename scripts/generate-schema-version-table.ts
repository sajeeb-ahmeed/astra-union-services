// W-019 / D-5 / D-6: the schema version table in docs/DYNAMIC_FORM_SPEC.md
// is generated from the live schema catalogue
// (packages/shared-schemas/src/index.ts), never hand-edited — the doc's
// hand-written "Service #45 v1, others v2" and "93 versions" claims drifted
// years behind the catalogue (latest versions are now v3–v6, 220 versions
// retained). The table lives between the SCHEMA-VERSIONS markers in the
// doc; this script rewrites that section.
//
// Usage:
//   npx tsx scripts/generate-schema-version-table.ts          # regenerate
//   npx tsx scripts/generate-schema-version-table.ts --check   # fail if stale
import fs from "node:fs";
import {
  allServiceSchemaVersions,
  operationalSchemas,
} from "../packages/shared-schemas/src/index.js";

const DOC = "docs/DYNAMIC_FORM_SPEC.md";
const BEGIN = "<!-- SCHEMA-VERSIONS:BEGIN -->";
const END = "<!-- SCHEMA-VERSIONS:END -->";

function table(): string {
  const retained = new Map<number, number[]>();
  for (const schema of allServiceSchemaVersions) {
    const versions = retained.get(schema.serviceNo) ?? [];
    versions.push(schema.version);
    retained.set(schema.serviceNo, versions);
  }
  const rows = [...operationalSchemas]
    .sort((a, b) => a.serviceNo - b.serviceNo)
    .map((schema) => {
      const versions = [...new Set(retained.get(schema.serviceNo) ?? [])].sort(
        (a, b) => a - b,
      );
      return `| ${schema.serviceNo} | v${schema.version} | ${versions.join(", ")} |`;
    });
  return [
    // Stage 6 (W-019): no date stamp — a generation-date line makes --check
    // fail on any later day, which is a defect in the generator, not drift
    // in the catalogue. The table content is the versioned fact; the date
    // added nothing.
    `> Generated from the schema catalogue — do not hand-edit. Regenerate with \`npx tsx scripts/generate-schema-version-table.ts\`.`,
    ``,
    `The catalogue holds **${operationalSchemas.length} operational schemas** (one latest version per service) and **${allServiceSchemaVersions.length} retained versions** in total. An application is pinned to the version current at creation; older versions stay valid for pinned applications only.`,
    ``,
    `| Service | Latest version | Versions retained |`,
    `| --- | --- | --- |`,
    ...rows,
  ].join("\n");
}

const doc = fs.readFileSync(DOC, "utf-8");
const start = doc.indexOf(BEGIN);
const end = doc.indexOf(END);
if (start === -1 || end === -1 || end < start) {
  console.error(`${DOC} is missing the ${BEGIN} / ${END} markers.`);
  process.exit(1);
}
const next =
  doc.slice(0, start + BEGIN.length) +
  "\n" +
  table() +
  "\n" +
  doc.slice(end);
if (process.argv.includes("--check")) {
  if (next !== doc) {
    console.error(
      `${DOC} schema version table is stale: run \`npx tsx scripts/generate-schema-version-table.ts\`.`,
    );
    process.exit(1);
  }
  console.log(`${DOC} schema version table is up to date.`);
} else {
  fs.writeFileSync(DOC, next);
  console.log(`${DOC} schema version table regenerated.`);
}
