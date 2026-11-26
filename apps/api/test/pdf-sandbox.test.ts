import test from "node:test";
import assert from "node:assert/strict";
import {
  pdfChromiumSandboxEnabled,
  pdfLightLaunchArgs,
} from "../src/pdf.js";

/**
 * P-013: PDF Chromium runs --no-sandbox by default (shared-hosting
 * compatibility); PDF_CHROMIUM_SANDBOX=1 opts into the sandbox where the
 * host allows it. The flag must be honoured when set and the default must
 * be unchanged when unset.
 */
test("P-013: sandbox opt-in is honoured when set, default unchanged when unset", () => {
  const previous = process.env.PDF_CHROMIUM_SANDBOX;
  try {
    delete process.env.PDF_CHROMIUM_SANDBOX;
    assert.equal(pdfChromiumSandboxEnabled(), false);
    assert.ok(pdfLightLaunchArgs().includes("--no-sandbox"));
    assert.ok(pdfLightLaunchArgs().includes("--single-process"));

    process.env.PDF_CHROMIUM_SANDBOX = "1";
    assert.equal(pdfChromiumSandboxEnabled(), true);
    assert.ok(!pdfLightLaunchArgs().includes("--no-sandbox"));
    // The rest of the light profile is unchanged by the opt-in.
    assert.deepEqual(pdfLightLaunchArgs(), [
      "--single-process",
      "--no-zygote",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ]);

    process.env.PDF_CHROMIUM_SANDBOX = "0";
    assert.equal(pdfChromiumSandboxEnabled(), false);
    assert.ok(pdfLightLaunchArgs().includes("--no-sandbox"));

    process.env.PDF_CHROMIUM_SANDBOX = "yes";
    assert.equal(pdfChromiumSandboxEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.PDF_CHROMIUM_SANDBOX;
    else process.env.PDF_CHROMIUM_SANDBOX = previous;
  }
});
