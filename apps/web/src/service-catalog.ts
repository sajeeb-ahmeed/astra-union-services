/**
 * B-004: the single importer of public-service-catalog.json.
 *
 * Six modules used to import the catalog JSON directly, each with
 * `with { type: "json" }` (required by tsc under module NodeNext,
 * TS1543). The production build still warned
 * INCONSISTENT_IMPORT_ATTRIBUTES: Vite's vite:build-import-analysis
 * plugin strips import attributes from the static imports of any file
 * that contains a dynamic import() — it removes `with {...}` so the
 * bundled output carries no attributes. PublicHome.tsx (dynamic
 * import("./PublicPortal.js")) and PublicPortal.tsx (lazy UserGuide /
 * WitnessGenerator / faq.json) therefore reached Rollup with no
 * attributes, while the other four importers kept theirs, and Rollup
 * warned for every later importer.
 *
 * Routing the catalog through this one module — which itself contains
 * no dynamic import, so its attributes survive the transform — makes
 * the import graph consistent by construction: exactly one JSON
 * importer exists, so no second importer can disagree. All web
 * consumers import the catalog from here, as a plain TS module.
 */
import serviceCatalog from "./public-service-catalog.json" with { type: "json" };

export default serviceCatalog;
