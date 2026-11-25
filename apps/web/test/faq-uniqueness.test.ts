import test from "node:test";
import assert from "node:assert/strict";
import faq from "../src/faq.json" with { type: "json" };

/**
 * L-003: the live audit found the same FAQ question twice on /help. The
 * file itself has no duplicate — but nothing stopped one from landing.
 * This test pins uniqueness so a duplicate can never regress in silently:
 * unique ids, and unique questions in both languages.
 */
test("L-003: faq.json has unique ids and unique questions in both languages", () => {
  assert.ok(Array.isArray(faq) && faq.length > 0, "faq.json must not be empty");
  const ids = faq.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate faq id: ${ids.find((id, i) => ids.indexOf(id) !== i)}`);
  for (const lang of ["bn", "en"] as const) {
    const questions = faq.map((item) => item.q[lang].trim());
    assert.ok(questions.every((q) => q.length > 0), `empty ${lang} question`);
    assert.equal(
      new Set(questions).size,
      questions.length,
      `duplicate ${lang} question: ${questions.find((q, i) => questions.indexOf(q) !== i)}`,
    );
  }
});
