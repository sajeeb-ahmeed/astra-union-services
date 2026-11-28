import test from "node:test";
import assert from "node:assert/strict";
import { definitionsAcceptable } from "../src/clamav-freshness.js";

// Owner decision, 28 Nov 2026: the rule shared by the scanner engine check and
// the API that accepts scan results.
const now = Date.parse("2026-11-28T12:00:00Z");
const hours = (h: number) => now - h * 3600_000;

test("ClamAV freshness: within 48 h is accepted whatever the published version", () => {
  assert.equal(definitionsAcceptable(hours(47), 28100, null, now), true);
  assert.equal(definitionsAcceptable(hours(1), Number.NaN, null, now), true, "the version is not needed while fresh");
});

test("ClamAV freshness: older than 48 h only while it is the newest published daily", () => {
  assert.equal(definitionsAcceptable(hours(72), 28194, 28194, now), true, "ClamAV paused: the newest that exists");
  assert.equal(definitionsAcceptable(hours(72), 28195, 28194, now), true);
  assert.equal(definitionsAcceptable(hours(72), 28193, 28194, now), false, "a newer daily exists but was not installed");
  assert.equal(definitionsAcceptable(hours(72), 28194, null, now), false, "unknown published version: strict 48 h");
  assert.equal(definitionsAcceptable(hours(72), Number.NaN, 28194, now), false, "unknown loaded version");
});

test("ClamAV freshness: never past 14 days, never in the future", () => {
  assert.equal(definitionsAcceptable(hours(15 * 24), 28194, 28194, now), false);
  assert.equal(definitionsAcceptable(now + 6 * 60_000, 28194, 28194, now), false);
  assert.equal(definitionsAcceptable(Number.NaN, 28194, 28194, now), false);
});
