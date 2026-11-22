# Changelog

## 2026-07-19 — Initial Canonical Export

- Imported `bangladesh-geo-data@4.0.9`.
- Projected source records into the required MongoDB seed schemas.
- Preserved source division, district, upazila, and union identifiers as strings.
- Removed non-schema fields such as URLs, coordinates, post offices, postal codes, city-corporation IDs, and ward numbers.
- Normalized all text to Unicode NFC.
- Trimmed and collapsed whitespace.
- Removed bidirectional formatting control characters.
- Removed 13 exact semantic duplicate union records while retaining the earliest source identifier.
- Removed source union IDs: uni-2353, uni-2546, uni-3686, uni-4565, uni-4575, uni-4578, uni-4579, uni-4580, uni-4591, uni-4592, uni-4593, uni-4594, uni-4595.
- Generated nine rural Union Parishad wards for every retained union.
- Generated deterministic ward codes using `<unionCode>-w<01..09>`.
- Excluded 462 city-corporation ward records because they cannot truthfully reference `unionCode`.
- Sorted every JSON array by natural code order.
- Wrote UTF-8 JSON without BOM using LF line endings.
- Executed duplicate, parent, orphan, encoding, character, hierarchy, and empty-value validation.
