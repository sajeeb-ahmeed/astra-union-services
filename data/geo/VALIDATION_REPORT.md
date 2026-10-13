# Validation Report

## Status

- Result: **PASS WITH WARNINGS**
- Errors: **0**
- Warnings: source duplicate cleanup, repeated legitimate place names, one upazila without union children, derived rural wards, and exclusion of urban wards.

## Record Counts

| Level | Source count | Output count | Matches source |
|---|---:|---:|---|
| Divisions | 8 | 8 | Yes |
| Districts | 64 | 64 | Yes |
| Upazilas | 495 | 495 | Yes |
| Unions | 4,599 | 4,586 | No — 13 exact semantic duplicates removed |
| Wards | 462 urban wards | 41,274 rural union wards | No — different parent model and scope |

No expected national count was forced. Counts are compared only with the retrieved source and documented derivation.

## Validation Summary

| Check | Result | Count |
|---|---|---:|
| Duplicate codes | PASS | 0 |
| Missing parents / orphan nodes | PASS | 0 |
| Empty values | PASS | 0 |
| Invalid English-name characters | PASS | 0 |
| Invalid Bengali-name characters | PASS | 0 |
| UTF-8 decoding and round-trip | PASS | 5 files |
| Unicode NFC normalization | PASS | all strings |
| Hierarchy loops | PASS | 0 |
| Exact semantic source duplicates removed | TRANSFORMED | 13 |

## Duplicate Name Analysis

### Divisions
- Same-parent duplicate English-name groups: 0
- Same-parent duplicate Bengali-name groups: 0
- Global repeated English-name groups: 0
- Global repeated Bengali-name groups: 0

### Districts
- Same-parent duplicate English-name groups: 0
- Same-parent duplicate Bengali-name groups: 0
- Global repeated English-name groups: 0
- Global repeated Bengali-name groups: 0

### Upazilas
- Same-parent duplicate English-name groups: 0
- Same-parent duplicate Bengali-name groups: 0
- Global repeated English-name groups: 11
- Global repeated Bengali-name groups: 11

### Unions
- Same-parent duplicate English-name groups: 2
- Same-parent duplicate Bengali-name groups: 3
- Global repeated English-name groups: 301
- Global repeated Bengali-name groups: 343
- Same-parent English examples: natai union → uni-0242, uni-0243; dhamgar union → uni-2962, uni-4568
- Same-parent Bengali examples: পেরাছড়া ইউনিয়ন → uni-0886, uni-4573; জামতৈল ইউনিয়ন → uni-0965, uni-4585; কলাগাছিয়া ইউনিয়ন → uni-2963, uni-4567

### Wards
- Same-parent duplicate English-name groups: 0
- Same-parent duplicate Bengali-name groups: 0
- Global repeated English-name groups: 9
- Global repeated Bengali-name groups: 9

Global repeated names are warnings, not automatic duplicates, because different administrative parents may legally contain places with the same name.

## Parent and Orphan Validation

- Districts: 0 orphan records
- Upazilas: 0 orphan records
- Unions: 0 orphan records
- Wards: 0 orphan records

- Upazilas with no retained union children: 1
  - `upa-388` — Shaistaganj / শায়েস্তাগঞ্জ

## Hierarchy Loop Validation

- No record can point to its own level because every parent field references a separate typed collection.
- All parent references resolve to the immediately preceding level.
- No cycles were found.

## Encoding and Character Validation

- Every JSON file decodes as strict UTF-8.
- Every JSON file re-encodes and parses successfully.
- All text is Unicode NFC.
- Bengali validation permits the Bengali Unicode block, Bengali/ASCII numerals, ordinary punctuation, and Bengali ZWJ/ZWNJ usage.
- Bidirectional formatting controls were removed during normalization.
- No invalid English or Bengali name values remain.

## Removed Exact Duplicate Union Records

| Removed code | Retained semantic key | Parent upazila | English | Bengali |
|---|---|---|---|---|
| uni-2353 | normalized bilingual name | upa-349 | Awajpur Union | আওয়াজপুর ইউনিয়ন |
| uni-2546 | normalized bilingual name | upa-373 | Talimpur Union | তালিমপুর ইউনিয়ন |
| uni-3686 | normalized bilingual name | upa-405 | Bhojoanpur Union | ভজনপুর ইউনিয়ন |
| uni-4565 | normalized bilingual name | upa-495 | Bandar Union | বন্দর ইউনিয়ন |
| uni-4575 | normalized bilingual name | upa-176 | Golabari Union | গোলাবাড়ী ইউনিয়ন |
| uni-4578 | normalized bilingual name | upa-128 | Belaichari Union | বিলাইছড়ি ইউনিয়ন |
| uni-4579 | normalized bilingual name | upa-128 | Farua Union | ফারুয়া ইউনিয়ন |
| uni-4580 | normalized bilingual name | upa-130 | Naniarchar Union | নানিয়ারচর ইউনিয়ন |
| uni-4591 | normalized bilingual name | upa-129 | Juraichari Union | জুরাছড়ি ইউনিয়ন |
| uni-4592 | normalized bilingual name | upa-178 | Panchari Union | পানছড়ি ইউনিয়ন |
| uni-4593 | normalized bilingual name | upa-179 | Laxmichhari Union | লক্ষীছড়ি ইউনিয়ন |
| uni-4594 | normalized bilingual name | upa-181 | Manikchari Union | মানিকছড়ি ইউনিয়ন |
| uni-4595 | normalized bilingual name | upa-182 | Ramgarh Union | রামগড় ইউনিয়ন |

## Ward Derivation Validation

- Retained unions: 4,586
- Wards generated per union: 9
- Expected derived wards: 4,586 × 9 = 41,274
- Actual derived wards: 41,274
- Ward count check: PASS
- Every ward parent resolves to a retained union.
- Urban wards from the package were excluded; no urban ward was assigned a fabricated union parent.

## Warnings

1. The primary source is community maintained and is not a signed BBS master register.
2. Source identifiers are not official BBS geocodes.
3. Open sources disagree on current union totals; this export does not force an expected count.
4. Same-parent bilingual name conflicts that are not exact semantic duplicates remain in the data and are listed above.
5. Shaistaganj upazila has no union children in the primary source.
6. Ward records are statutory rural ward-number records derived from the nine-ward rule, not imported boundary or gazette records.
7. City-corporation and municipality wards require a different parent schema and are outside this export.

## Errors

No blocking validation errors detected.

## SHA-256 Checksums

- `divisions.json`: `7cd85edac040eac2d66a692be3c709ee74d35f43eaa1701a62a679e7275c79b8`
- `districts.json`: `8ee180d77ea24161cd9b0fa1ad669f3d554772f2424ad535882fe43097fe3622`
- `upazilas.json`: `d88126d4862bcab11915903b58f2d78a644c2d61cb8835fbcb5550165ffeaebd`
- `unions.json`: `80664b1a45b865d03013b760bd3aabd653e5c71cc33d24e8214192a5a7ae49a5`
- `wards.json`: `b83239fa631618404ecdd4a7c34df6507c5a68f1ce91d154ee2ea19138456c8a`
