import test from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_SEO,
  faqFor,
  serviceFormFacts,
  stepsFor,
} from "../src/seo/service-seo.js";
import { getServiceSchema } from "@astra/shared-schemas";

/**
 * F-004: "How to apply" steps, "At a glance" facts and most FAQ answers
 * were identical templates on all 47 service pages. The steps and FAQ
 * now derive from each service's own form schema (serviceFormFacts), so
 * no two pages share identical steps/FAQ text — without inventing
 * per-service copy: the text comes from the real schema.
 */
function factsFor(no: number) {
  try {
    return serviceFormFacts(getServiceSchema(no));
  } catch {
    return undefined;
  }
}

test("F-004: no two service pages share identical steps", () => {
  assert.equal(SERVICE_SEO.length, 47, "registry must cover all 47 services");
  const seen = new Map<string, number>();
  for (const seo of SERVICE_SEO) {
    const steps = stepsFor(seo, factsFor(seo.no));
    assert.equal(steps.length, 4, `service ${seo.no} must have 4 steps`);
    const key = JSON.stringify(steps);
    assert.ok(!seen.has(key), `services ${seen.get(key)} and ${seo.no} share identical steps`);
    seen.set(key, seo.no);
  }
});

test("F-004: no two service pages share identical FAQ text", () => {
  const seen = new Map<string, number>();
  for (const seo of SERVICE_SEO) {
    const faq = faqFor(seo, factsFor(seo.no));
    // The schema-derived item is present wherever the schema has fields.
    const facts = factsFor(seo.no);
    if (facts && facts.fields.length > 0) {
      assert.ok(
        faq.some((item) => item.q.en.startsWith("What information will I need")),
        `service ${seo.no} is missing its schema-derived FAQ item`,
      );
    }
    const key = JSON.stringify(faq);
    assert.ok(!seen.has(key), `services ${seen.get(key)} and ${seo.no} share identical FAQ text`);
    seen.set(key, seo.no);
  }
});

test("F-004: faqFor without facts keeps the four standard items (prerender fallback)", () => {
  const faq = faqFor(SERVICE_SEO[0]);
  assert.equal(faq.length, 4 + (SERVICE_SEO[0].extraFaq?.length ?? 0));
});

test("F-004: stepsFor without facts keeps the generic second step", () => {
  const steps = stepsFor(SERVICE_SEO[0]);
  assert.equal(steps.length, 4);
  assert.match(steps[1].en, /Complete the service form/);
});
