import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { fail } from "./models.js";

const code = z.string().regex(/^[a-z0-9-]{3,30}$/);
export const geographyInput = z
  .object({
    divisionCode: code,
    districtCode: code,
    upazilaCode: code,
    unionCode: code.optional(),
    wardCode: code.optional(),
  })
  .strict();
export type Geography = z.infer<typeof geographyInput>;
type Queryable = Pick<typeof pool, "query">;

export function geographyRow(row: any): Geography | null {
  return row?.division_code
    ? {
        divisionCode: row.division_code,
        districtCode: row.district_code,
        upazilaCode: row.upazila_code,
        ...(row.union_code ? { unionCode: row.union_code } : {}),
        ...(row.ward_code ? { wardCode: row.ward_code } : {}),
      }
    : null;
}
export function geographyValues(g?: Geography | null) {
  return [
    g?.divisionCode ?? null,
    g?.districtCode ?? null,
    g?.upazilaCode ?? null,
    g?.unionCode ?? null,
    g?.wardCode ?? null,
  ];
}
export async function validateGeography(
  db: Queryable,
  g: Geography,
  mode: "citizen" | "UNION" | "MUNICIPALITY" | "CITY_CORPORATION",
) {
  if (
    (mode === "citizen" && (!g.unionCode || !g.wardCode)) ||
    (mode === "UNION" && !g.unionCode) ||
    (g.wardCode && !g.unionCode)
  )
    fail(
      400,
      "GEOGRAPHY_INCOMPLETE",
      "Select the complete rural address hierarchy including the required union and ward.",
    );
  if (
    (mode === "MUNICIPALITY" || mode === "CITY_CORPORATION") &&
    (g.unionCode || g.wardCode)
  )
    fail(
      400,
      "GEOGRAPHY_URBAN_UNAVAILABLE",
      "This dataset has no urban wards. Select geography through upazila for this office type.",
    );
  const row = (
    await db.query(
      `SELECT d.name_en division,di.name_en district,u.name_en upazila
    FROM geo_divisions d JOIN geo_districts di ON di.parent_code=d.code JOIN geo_upazilas u ON u.parent_code=di.code
    WHERE d.code=$1 AND di.code=$2 AND u.code=$3
    AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM geo_unions n WHERE n.code=$4 AND n.parent_code=u.code))
    AND ($5::text IS NULL OR EXISTS(SELECT 1 FROM geo_wards w WHERE w.code=$5 AND w.parent_code=$4))`,
      geographyValues(g),
    )
  ).rows[0];
  if (!row)
    fail(
      400,
      "GEOGRAPHY_MISMATCH",
      "The selected locations do not form a valid parent-child hierarchy.",
    );
  return row as { division: string; district: string; upazila: string };
}
export function validateOfficeJurisdiction(office: any, g: Geography) {
  if (!office.division_code) return; // A legacy preview office has no declared geographic jurisdiction.
  for (const [column, key] of [
    ["division_code", "divisionCode"],
    ["district_code", "districtCode"],
    ["upazila_code", "upazilaCode"],
    ["union_code", "unionCode"],
  ] as const) {
    if (office[column] && office[column] !== g[key])
      fail(
        400,
        "GEOGRAPHY_OFFICE_MISMATCH",
        "Choose a participating office for the selected address.",
      );
  }
}

export const geographyRouter = express.Router();
const levels = [
  "divisions",
  "districts",
  "upazilas",
  "unions",
  "wards",
] as const;
geographyRouter.get("/geography/metadata", async (_req, res, next) => {
  try {
    const row = (
      await pool.query(
        "SELECT details FROM geo_dataset_metadata ORDER BY imported_at DESC LIMIT 1",
      )
    ).rows[0];
    if (!row)
      fail(
        503,
        "GEOGRAPHY_UNAVAILABLE",
        "Geography dataset has not been initialized.",
      );
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(row.details);
  } catch (e) {
    next(e);
  }
});
for (const [index, level] of levels.entries())
  geographyRouter.get(`/geography/${level}`, async (req, res, next) => {
    try {
      const parsed = (
        index === 0
          ? z.object({}).strict()
          : z.object({ parentCode: code }).strict()
      ).safeParse(req.query);
      if (!parsed.success)
        fail(
          400,
          "GEOGRAPHY_QUERY_INVALID",
          "A valid parentCode is required for child geography lists; unexpected query fields are not accepted.",
        );
      const q = parsed.data as { parentCode?: string };
      if (
        index > 0 &&
        !(
          await pool.query(
            `SELECT 1 FROM geo_${levels[index - 1]} WHERE code=$1`,
            [q.parentCode],
          )
        ).rowCount
      )
        fail(
          404,
          "GEOGRAPHY_PARENT_NOT_FOUND",
          "The selected parent location does not exist.",
        );
      const items = (
        await pool.query(
          `SELECT code,name_en AS "nameEn",name_bn AS "nameBn"${index > 0 ? ',parent_code AS "parentCode"' : ""} FROM geo_${level}${index > 0 ? " WHERE parent_code=$1" : ""} ORDER BY ${level === "wards" ? "code" : "name_en,code"}`,
          index > 0 ? [q.parentCode] : [],
        )
      ).rows;
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({
        items,
        total: items.length,
        ...(q.parentCode ? { parentCode: q.parentCode } : {}),
      });
    } catch (e) {
      next(e);
    }
  });
