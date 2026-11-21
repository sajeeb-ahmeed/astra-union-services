import test from "node:test";
import assert from "node:assert/strict";
import { formatDateTime, localDigits } from "../src/ui/fmt.js";

/**
 * FULL-UIUX-01 (B21 locale lock): in the Bangla UI, timestamps must carry
 * Bengali digits and a Bengali day-period — never a Latin "AM"/"PM" (some
 * ICU builds render bn-BD day periods in Latin letters).
 */
test("formatDateTime bn: Bengali digits, no Latin AM/PM", () => {
  const afternoon = formatDateTime("2026-11-18T17:46:00+06:00", "bn");
  assert.ok(!/\b(AM|PM)\b/.test(afternoon), `Latin day period leaked: ${afternoon}`);
  assert.ok(/[০-৯]/.test(afternoon), `No Bengali digits: ${afternoon}`);
  const morning = formatDateTime("2026-11-18T09:05:00+06:00", "bn");
  assert.ok(!/\b(AM|PM)\b/.test(morning), `Latin day period leaked: ${morning}`);
});

test("formatDateTime en: unchanged English rendering", () => {
  const out = formatDateTime("2026-11-18T17:46:00+06:00", "en");
  assert.ok(/2026/.test(out), out);
});

test("localDigits: bn converts, en passes through", () => {
  assert.equal(localDigits("2026111832694893", "bn"), "২০২৬১১১৮৩২৬৯৪৮৯৩");
  assert.equal(localDigits("2026", "en"), "2026");
});
