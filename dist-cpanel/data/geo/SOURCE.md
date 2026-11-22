# Source Register

## Primary Data Source

- Package: `bangladesh-geo-data`
- Version: `4.0.9`
- Publisher/maintainer: Shodorson / Shodorson Nath
- Distribution: npm registry
- Source repository/homepage: `https://github.com/shodorsonnath/bangladesh-geo-data`
- Package homepage: `https://shodorsonnath.github.io/bangladesh-geo-data/`
- Original filenames:
  - `dist/data/divisions.json`
  - `dist/data/districts.json`
  - `dist/data/upazilas.json`
  - `dist/data/unions.json`
  - `dist/data/wards.json`
- Download date: 2026-07-19
- Declared license: MIT

The package supplies bilingual division, district, upazila, union, city-corporation, and ward records. Only the division-through-union rural hierarchy was projected into the required schema. The package's 462 wards are city-corporation wards with `cityCorpId` parents and were not reassigned to unions.

## Ward Rule Source

- Source organization: Legislative and Parliamentary Affairs Division, Ministry of Law, Justice and Parliamentary Affairs, Government of Bangladesh
- Instrument: Local Government (Union Parishads) Ordinance, 1983, section 18, as published in the Laws of Bangladesh portal
- Source URL: `https://bdlaws.minlaw.gov.bd/act-print-652.html`
- Rule used: a Union is divided into nine general wards.
- Access date: 2026-07-19

The rule was applied deterministically to every retained union. No urban ward was converted into a rural ward.

## Official Coding Context

- Organization: Directorate General of Health Services, Ministry of Health and Family Welfare, Bangladesh
- Resource: Bangladesh GeoCodes CodeSystem, Bangladesh Core FHIR Implementation Guide
- Version observed: 0.4.6
- URL: `https://fhir.dghs.gov.bd/core/CodeSystem-bd-geocodes.html`
- Access date: 2026-07-19

This resource was used to verify that official Bangladesh geocodes are distinct from the primary package's application IDs. The official codes were not substituted because the requested bilingual parent-linked export could not be mapped record-for-record without introducing guessed relationships.

## Normalization Performed

- Selected only required fields.
- Converted all codes to strings.
- Trimmed leading and trailing whitespace.
- Collapsed repeated whitespace.
- Normalized strings to Unicode NFC.
- Removed Unicode bidirectional formatting controls.
- Preserved Bengali zero-width joiner/non-joiner characters where linguistically valid.
- Removed exact semantic duplicate union records sharing the same parent and normalized bilingual names; the earliest source identifier was retained.
- Generated nine rural ward records per retained union using the statutory ward rule.
- Generated deterministic ward identifiers.
- Excluded city-corporation wards because the required schema has no city-corporation parent field.

## Source Limitations

The primary source is an MIT-licensed community dataset, not a signed BBS master register. Its identifiers are not BBS geographic codes. Open sources disagree on the current union total. The validation report records the exact source and output counts without forcing an expected national count.
