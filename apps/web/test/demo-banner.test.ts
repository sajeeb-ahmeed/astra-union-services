import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setLanguage } from "../src/i18n.js";
import { DemoBanner } from "../src/DemoModeBanner.js";

/**
 * F-008: the mode honesty system was dead code — nothing read the mode.
 * The banner renders only when the deployment is proven to be a
 * demonstration; OFFICIAL and unknown modes render nothing.
 */
test("F-008: DemoBanner renders the demo notice in DEMO mode (both languages)", () => {
  setLanguage("bn");
  const bn = renderToStaticMarkup(createElement(DemoBanner, { mode: "DEMO" }));
  assert.match(bn, /নমুনা সংস্করণ/);
  assert.match(bn, /সরকারি নয়/);
  setLanguage("en");
  const en = renderToStaticMarkup(createElement(DemoBanner, { mode: "DEMO" }));
  assert.match(en, /Demonstration/);
  assert.match(en, /not official/);
});

test("F-008: DemoBanner renders nothing in OFFICIAL mode or while unknown", () => {
  assert.equal(renderToStaticMarkup(createElement(DemoBanner, { mode: "OFFICIAL" })), "");
  assert.equal(renderToStaticMarkup(createElement(DemoBanner, { mode: null })), "");
});
