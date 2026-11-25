import test from "node:test";
import assert from "node:assert/strict";
import { certificateNumberInput } from "../src/verify-input.js";

/**
 * VERIFY-FIX-01: official certificate numbers are dashless digit strings
 * — 14 digits since CERTNO-DDMM (25 Nov 2026, e.g. 25113269489312);
 * already-issued CERTNO-01 numbers are 16 digits (e.g. 2026111832694893)
 * and must keep resolving. The homepage verify form must classify a bare
 * number as a certificate number (by-number lookup), not as a QR token —
 * otherwise every officially issued certificate reports "not found".
 */
test("certificateNumberInput: dashless 14-digit number is a certificate number (CERTNO-DDMM)", () => {
  assert.equal(certificateNumberInput("25113269489312"), "25113269489312");
});

test("certificateNumberInput: Bengali-digit 14-digit number normalises to a certificate number", () => {
  assert.equal(certificateNumberInput("২৫১১৩২৬৯৪৮৯৩১২"), "25113269489312");
});

test("certificateNumberInput: dashless 16-digit number is a certificate number (already-issued CERTNO-01)", () => {
  assert.equal(certificateNumberInput("2026111832694893"), "2026111832694893");
});

test("certificateNumberInput: Bengali-digit 16-digit number normalises to a certificate number", () => {
  assert.equal(certificateNumberInput("২০২৬১১১৮৩২৬৯৪৮৯৩"), "2026111832694893");
});

test("certificateNumberInput: pasted ?searchText= URL yields the certificate number", () => {
  assert.equal(
    certificateNumberInput(
      "https://digitalunion.com.bd/verify?searchText=2026111832694893",
    ),
    "2026111832694893",
  );
});

test("certificateNumberInput: 64-hex QR token is not a certificate number", () => {
  assert.equal(certificateNumberInput("a".repeat(64)), null);
  assert.equal(
    certificateNumberInput(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ),
    null,
  );
});

test("certificateNumberInput: dashed legacy number still accepted", () => {
  assert.equal(
    certificateNumberInput("2026-1118-3269-4893"),
    "2026-1118-3269-4893",
  );
});

test("certificateNumberInput: garbage is rejected", () => {
  assert.equal(certificateNumberInput("hello world!"), null);
  assert.equal(certificateNumberInput(""), null);
  assert.equal(certificateNumberInput("123"), null);
});
