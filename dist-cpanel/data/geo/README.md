# Bangladesh Administrative Geography Dataset

## Scope

This UTF-8 dataset supplies a normalized rural administrative hierarchy for MongoDB seeding:

`Division → District → Upazila → Union → Union Parishad Ward`

The dataset contains 8 divisions, 64 districts, 495 upazilas, 4,586 unions, and 41,274 rural Union Parishad wards.

`wards.json` contains rural Union Parishad wards only. Bangladesh city-corporation and municipality wards do not have a Union parent and therefore cannot be represented truthfully by the required `unionCode` schema. They are intentionally excluded.

## JSON Schemas

### Division

```json
{
  "code": "div-01",
  "nameEn": "Dhaka",
  "nameBn": "ঢাকা"
}
```

### District

```json
{
  "code": "dis-01",
  "divisionCode": "div-01",
  "nameEn": "Dhaka",
  "nameBn": "ঢাকা"
}
```

### Upazila

```json
{
  "code": "upa-001",
  "districtCode": "dis-01",
  "nameEn": "Dhamrai",
  "nameBn": "ধামরাই"
}
```

### Union

```json
{
  "code": "uni-0001",
  "upazilaCode": "upa-089",
  "nameEn": "Subil Union",
  "nameBn": "সুবিল ইউনিয়ন"
}
```

### Ward

```json
{
  "code": "uni-0001-w01",
  "unionCode": "uni-0001",
  "nameEn": "Ward No. 1",
  "nameBn": "ওয়ার্ড নং ১"
}
```

## Encoding

All files are JSON arrays encoded as UTF-8 without a byte-order mark. Strings are normalized to Unicode NFC. Line endings are LF.

## Code Semantics

Division, district, upazila, and union codes preserve the stable identifiers from the primary open-source package. They are application identifiers, not representations of official BBS geographic codes.

Ward codes are deterministic dataset identifiers composed as `<unionCode>-w<01..09>`. They are not BBS codes.

## Parent Relationships

- `districts.divisionCode` references `divisions.code`.
- `upazilas.districtCode` references `districts.code`.
- `unions.upazilaCode` references `upazilas.code`.
- `wards.unionCode` references `unions.code`.

## MongoDB Importer Assumptions

- Each file contains one top-level JSON array.
- Import parents before children in this order: divisions, districts, upazilas, unions, wards.
- Treat every `code` and parent code as a string.
- Create a unique index on `code` in each collection.
- Create indexes on `divisionCode`, `districtCode`, `upazilaCode`, and `unionCode` in child collections.
- Do not coerce codes into ObjectIds or numbers.
- Recommended uniqueness for names is `(parentCode, normalized name)` rather than global name uniqueness because legitimate names repeat in different parents.

See `VALIDATION_REPORT.md` before production deployment.
