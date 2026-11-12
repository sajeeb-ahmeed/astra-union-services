import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { fail } from "./models.js";
import {
  flattenFields,
  geographySelectorServices,
  isFieldVisible,
  legacyLocationFieldIds,
  type FieldDefinition,
  type FormSchema,
} from "@astra/shared-schemas";

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
type Localized = { bn: string; en: string };
/** Visible geography values with their dotted payload paths, including inside repeatable rows. */
function payloadGeography(
  fields: readonly FieldDefinition[],
  values: Record<string, unknown>,
  prefix = "",
): { path: string; value: Geography }[] {
  const found: { path: string; value: Geography }[] = [];
  for (const field of fields) {
    if (!isFieldVisible(field, values)) continue;
    const value = values[field.id];
    if (field.type === "geography" && value && typeof value === "object")
      found.push({ path: `${prefix}${field.id}`, value: value as Geography });
    if (field.type === "repeatable" && Array.isArray(value))
      value.forEach((row, index) => {
        if (row && typeof row === "object")
          found.push(
            ...payloadGeography(
              field.children ?? [],
              row as Record<string, unknown>,
              `${prefix}${field.id}[${index}].`,
            ),
          );
      });
  }
  return found;
}
async function resolveGeographyNames(
  db: Queryable,
  g: Geography,
): Promise<Localized | null> {
  const row = (
    await db.query(
      `SELECT concat_ws(', ',w.name_bn,n.name_bn,u.name_bn,di.name_bn,d.name_bn) bn,
              concat_ws(', ',w.name_en,n.name_en,u.name_en,di.name_en,d.name_en) en
       FROM geo_divisions d JOIN geo_districts di ON di.parent_code=d.code JOIN geo_upazilas u ON u.parent_code=di.code
       LEFT JOIN geo_unions n ON n.code=$4 AND n.parent_code=u.code
       LEFT JOIN geo_wards w ON w.code=$5 AND w.parent_code=n.code
       WHERE d.code=$1 AND di.code=$2 AND u.code=$3
         AND ($4::text IS NULL OR n.code IS NOT NULL)
         AND ($5::text IS NULL OR w.code IS NOT NULL)`,
      geographyValues(g),
    )
  ).rows[0];
  return row ?? null;
}
/** Server-side hierarchy check for form payloads; the shared engine only checks shape. */
export async function validatePayloadGeography(
  db: Queryable,
  schema: FormSchema,
  payload: Record<string, unknown>,
) {
  const issues = [];
  for (const { path, value } of payloadGeography(flattenFields(schema), payload))
    if (!(await resolveGeographyNames(db, value)))
      issues.push({
        path,
        code: "geography_mismatch",
        message: {
          bn: "নির্বাচিত এলাকাগুলো একে অপরের অধীন নয়।",
          en: "The selected locations do not form a valid parent-child hierarchy.",
        },
      });
  return issues;
}
/** Display names for each visible geography field, keyed by payload path, for documents. */
export async function payloadGeographyNames(
  db: Queryable,
  schema: FormSchema,
  payload: Record<string, unknown>,
): Promise<Record<string, Localized>> {
  const names: Record<string, Localized> = {};
  for (const { path, value } of payloadGeography(flattenFields(schema), payload)) {
    const resolved = await resolveGeographyNames(db, value);
    if (resolved) names[path] = resolved;
  }
  return names;
}
/** PAR-06: present address. Omitted or `sameAsPermanent: true` keeps the single registered address. */
export const presentAddressInput = z.discriminatedUnion("sameAsPermanent", [
  z.object({ sameAsPermanent: z.literal(true) }).strict(),
  z
    .object({
      sameAsPermanent: z.literal(false),
      addressBn: z.string().trim().min(4).max(500),
      addressEn: z.string().trim().min(4).max(500),
      geography: geographyInput.optional(),
    })
    .strict(),
]);
export type PresentAddress = z.infer<typeof presentAddressInput>;
/** Column values for present_same_as_permanent, present_address_bn/en and the five present_* codes. */
export async function presentAddressValues(
  db: Queryable,
  present?: PresentAddress,
): Promise<unknown[]> {
  if (!present || present.sameAsPermanent)
    return [true, null, null, ...geographyValues(null)];
  // A present address may be outside the office area, so only the hierarchy is checked.
  if (present.geography && !(await resolveGeographyNames(db, present.geography)))
    fail(
      400,
      "GEOGRAPHY_MISMATCH",
      "The selected present-address locations do not form a valid parent-child hierarchy.",
    );
  return [
    false,
    present.addressBn,
    present.addressEn,
    ...geographyValues(present.geography),
  ];
}
export function presentAddressRow(row: any) {
  if (!row || row.present_same_as_permanent !== false)
    return { sameAsPermanent: true as const };
  return {
    sameAsPermanent: false as const,
    addressBn: row.present_address_bn,
    addressEn: row.present_address_en,
    geography: geographyRow({
      division_code: row.present_division_code,
      district_code: row.present_district_code,
      upazila_code: row.present_upazila_code,
      union_code: row.present_union_code,
      ward_code: row.present_ward_code,
    }),
  };
}
export const presentAddressColumns =
  "present_same_as_permanent,present_address_bn,present_address_en,present_division_code,present_district_code,present_upazila_code,present_union_code,present_ward_code";
/** Compare a typed place name with dataset names, ignoring case, spacing and a trailing level word. */
function placeKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ (division|district|upazila|thana|union|বিভাগ|জেলা|উপজেলা|থানা|ইউনিয়ন)$/u, "")
    .trim();
}
async function uniqueChild(
  db: Queryable,
  table: "geo_divisions" | "geo_districts" | "geo_upazilas" | "geo_unions",
  name: unknown,
  parentCode?: string,
): Promise<string | null> {
  const key = placeKey(name);
  if (!key) return null;
  const rows = (
    await db.query(
      `SELECT code,name_en,name_bn FROM ${table}${parentCode ? " WHERE parent_code=$1" : ""}`,
      parentCode ? [parentCode] : [],
    )
  ).rows.filter((r: any) => placeKey(r.name_en) === key || placeKey(r.name_bn) === key);
  return rows.length === 1 ? rows[0].code : null;
}
export type LocationUpgrade = "NONE" | "RESOLVED" | "UNRESOLVED";
/**
 * B5: carry a pre-selector payload (free-text division/district/thana/union) into the selector version.
 * The texts become `org_location` only when every level matches exactly one dataset entry under its parent;
 * nothing is guessed. UNRESOLVED means the caller must keep the payload on its original version.
 */
export async function upgradeLegacyLocation(
  db: Queryable,
  serviceNo: number,
  payload: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; status: LocationUpgrade }> {
  if (!geographySelectorServices.includes(serviceNo))
    return { payload, status: "NONE" };
  const legacy = legacyLocationFieldIds.filter((id) => id in payload);
  if (!legacy.length) return { payload, status: "NONE" };
  const upgraded = { ...payload };
  for (const id of legacy) delete upgraded[id];
  if (upgraded.org_location) return { payload: upgraded, status: "NONE" };
  const division =
    payload.division_id ?? payload.noc_org_division ?? payload.trade_license_org_division;
  const typed = [division, payload.district_id, payload.thana_id, payload.union_id];
  if (typed.every((value) => !placeKey(value))) return { payload: upgraded, status: "NONE" };
  const addressKind = Object.keys(payload).find((key) => key.endsWith("org_add_type"));
  const wantsUnion = addressKind ? payload[addressKind] === "union" : false;
  const divisionCode = await uniqueChild(db, "geo_divisions", division);
  const districtCode = divisionCode
    ? await uniqueChild(db, "geo_districts", payload.district_id, divisionCode)
    : null;
  const upazilaCode = districtCode
    ? await uniqueChild(db, "geo_upazilas", payload.thana_id, districtCode)
    : null;
  const unionCode =
    upazilaCode && wantsUnion
      ? await uniqueChild(db, "geo_unions", payload.union_id, upazilaCode)
      : null;
  if (!upazilaCode || (wantsUnion && !unionCode))
    return { payload, status: "UNRESOLVED" };
  upgraded.org_location = {
    divisionCode,
    districtCode,
    upazilaCode,
    ...(unionCode ? { unionCode } : {}),
  };
  return { payload: upgraded, status: "RESOLVED" };
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
