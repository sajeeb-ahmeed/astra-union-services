import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type pg from "pg";

export const geographyLevels = [
  ["divisions", undefined, 8],
  ["districts", "divisionCode", 64],
  ["upazilas", "districtCode", 495],
  ["unions", "upazilaCode", 4586],
  ["wards", "unionCode", 41274],
] as const;
type RecordRow = {
  code: string;
  nameEn: string;
  nameBn: string;
  [key: string]: string;
};
export function readGeographyDataset(directory = "data/geo") {
  const records: Record<string, RecordRow[]> = {};
  const hashes: Record<string, string> = {};
  let parents = new Set<string>();
  for (const [level, parentField, expected] of geographyLevels) {
    const bytes = fs.readFileSync(path.join(directory, `${level}.json`));
    hashes[`${level}.json`] = createHash("sha256").update(bytes).digest("hex");
    const rows: RecordRow[] = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(rows) || rows.length !== expected)
      throw new Error(`Geography ${level}: expected ${expected} records`);
    const seen = new Set<string>();
    const childCounts = new Map<string, number>();
    for (const row of rows) {
      for (const key of [
        "code",
        "nameEn",
        "nameBn",
        ...(parentField ? [parentField] : []),
      ]) {
        if (
          typeof row[key] !== "string" ||
          !row[key].trim() ||
          row[key].length > 200 ||
          row[key] !== row[key].normalize("NFC") ||
          /[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/u.test(row[key])
        )
          throw new Error(`Geography ${level}: invalid ${key}`);
      }
      if (!/^[a-z0-9-]{3,30}$/.test(row.code) || seen.has(row.code))
        throw new Error(`Geography ${level}: invalid or duplicate code`);
      seen.add(row.code);
      if (parentField) {
        if (!parents.has(row[parentField]))
          throw new Error(`Geography ${level}: orphan parent`);
        childCounts.set(
          row[parentField],
          (childCounts.get(row[parentField]) ?? 0) + 1,
        );
      }
      if (
        level === "wards" &&
        !new RegExp(`^${row.unionCode}-w0[1-9]$`).test(row.code)
      )
        throw new Error("Geography wards: unexpected derived code");
    }
    if (
      level === "wards" &&
      (childCounts.size !== parents.size ||
        [...childCounts.values()].some((n) => n !== 9))
    )
      throw new Error("Geography wards: expected nine derived wards per union");
    records[level] = rows;
    parents = seen;
  }
  const parentsWithUnions = new Set(records.unions.map((r) => r.upazilaCode));
  const metadata = {
    datasetId: "bangladesh-geo-data-4.0.9-rural-2026-07-19",
    source:
      "User supplied Bangladesh Administrative Geography Dataset; derived from bangladesh-geo-data 4.0.9",
    sourceUrl: "https://github.com/shodorsonnath/bangladesh-geo-data",
    license: "MIT",
    sourceDate: "2026-07-19",
    identifiersAreOfficial: false,
    wardsDerived: true,
    counts: Object.fromEntries(
      geographyLevels.map(([level]) => [level, records[level].length]),
    ),
    coverage:
      "Division → district → upazila → rural union → derived rural ward",
    upazilasWithoutUnions: records.upazilas
      .filter((r) => !parentsWithUnions.has(r.code))
      .map((r) => ({ code: r.code, nameEn: r.nameEn, nameBn: r.nameBn })),
    limitations: [
      "Community dataset identifiers are not official BBS geocodes.",
      "All 41,274 rural ward records are derived as wards 1–9 per union; individual ward boundaries were not surveyed.",
      "City corporation and municipality wards are excluded.",
      "Missing or outdated source records are not invented; this dataset is not an authoritative current national register.",
      "A geographic location does not imply a participating or government-authorized service office.",
    ],
    fileSha256: hashes,
  };
  return { records, metadata };
}

// Called inside the same migration transaction: no partially imported hierarchy can commit.
export async function importGeographyDataset(db: pg.PoolClient) {
  const { records, metadata } = readGeographyDataset();
  for (const [level, parentField] of geographyLevels) {
    for (let offset = 0; offset < records[level].length; offset += 2000) {
      const rows = records[level]
        .slice(offset, offset + 2000)
        .map((r) => ({
          code: r.code,
          name_en: r.nameEn,
          name_bn: r.nameBn,
          parent_code: parentField ? r[parentField] : undefined,
        }));
      await db.query(
        `INSERT INTO geo_${level}(code,name_en,name_bn${parentField ? ",parent_code" : ""}) SELECT code,name_en,name_bn${parentField ? ",parent_code" : ""} FROM jsonb_to_recordset($1::jsonb) AS x(code text,name_en text,name_bn text,parent_code text) ON CONFLICT(code) DO UPDATE SET name_en=excluded.name_en,name_bn=excluded.name_bn${parentField ? ",parent_code=excluded.parent_code" : ""}`,
        [JSON.stringify(rows)],
      );
    }
  }
  await db.query(
    "INSERT INTO geo_dataset_metadata(id,details) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET details=excluded.details",
    [metadata.datasetId, JSON.stringify(metadata)],
  );
  return metadata;
}
