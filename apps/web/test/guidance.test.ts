import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApplicationGuidance,
  type ApplicationGuidanceProps,
} from "../src/ApplicationGuidance.js";
import { setLanguage } from "../src/i18n.js";

// Phase UX: the product default language is now Bangla; these render
// assertions are written in English, so pin the language explicitly.
setLanguage("en");

function render(props: Partial<ApplicationGuidanceProps>) {
  return renderToStaticMarkup(
    createElement(ApplicationGuidance, {
      state: "DRAFT",
      role: "citizen",
      hasCertificate: false,
      revoked: false,
      ...props,
    }),
  );
}

test("guidance: saving a draft is not submission and only applicant roles get submission navigation", () => {
  for (const role of ["citizen", "staff", "admin"]) {
    const html = render({ role });
    assert.match(html, /Saving a draft alone does not start review/);
    assert.match(html, /href="#application-actions"/);
    assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  }
  for (const role of ["reviewer", "approver", "finance", "owner"]) {
    const html = render({ role });
    assert.match(html, /must submit this draft first/);
    assert.doesNotMatch(html, /href=/);
  }
});

test("guidance: the Chairman alone verifies and decides; the Secretary is view-only", () => {
  for (const state of ["SUBMITTED", "RESUBMITTED"]) {
    assert.match(render({ state, role: "approver" }), /Go to decision controls/);
    const reviewerHtml = render({ state, role: "reviewer" });
    assert.doesNotMatch(reviewerHtml, /href=/);
    assert.match(reviewerHtml, /Chairman&#x27;s work/);
    assert.match(
      render({ state, role: "citizen" }),
      /do not need to submit the same application again/,
    );
  }
  // Legacy records already under review are decided by the Chairman the same way.
  assert.match(
    render({ state: "UNDER_REVIEW", role: "approver" }),
    /issues the certificate at once/,
  );
  assert.doesNotMatch(
    render({ state: "UNDER_REVIEW", role: "approver" }),
    /separate step/,
  );
  assert.doesNotMatch(
    render({ state: "UNDER_REVIEW", role: "citizen" }),
    /href=/,
  );
});

test("guidance: corrections require saved edits and resubmission rather than approval", () => {
  const applicant = render({ state: "CORRECTION_REQUIRED" });
  assert.match(applicant, /save the changes, then resubmit/);
  assert.match(applicant, /Go to resubmission controls/);
  assert.match(applicant, /Correct details/);
  const approver = render({ state: "CORRECTION_REQUIRED", role: "approver" });
  assert.match(approver, /Waiting for the applicant/);
  assert.doesNotMatch(approver, /href=/);
});

test("guidance: provider PAID or unknown payment flags cannot imply settled application fees", () => {
  for (const state of ["APPROVED", "ISSUANCE_PENDING"]) {
    for (const paymentStatus of [
      "NOT_COLLECTED",
      "PENDING",
      "PAID",
      "REVIEW_REQUIRED",
      "UNKNOWN",
    ]) {
      for (const role of ["citizen", "approver"]) {
        const html = render({
          state,
          role,
          order: { totalMinor: 15210, paymentStatus },
        });
        assert.match(
          html,
          /Certificate issuance requires server-verified fee payment/,
        );
        assert.match(html, /Check the current payment information below/);
        assert.match(html, /Approval is not a payment receipt/);
        assert.doesNotMatch(html, /href=|Pay with|Certificate PDF available/);
      }
    }
  }
  const collected = render({
    state: "APPROVED",
    role: "approver",
    order: { totalMinor: 15210, paymentStatus: "COLLECTED" },
  });
  assert.match(
    collected,
    /server checks approval, any required payment and credits again/,
  );
  assert.match(collected, /Go to issuance controls/);
  assert.doesNotMatch(
    collected,
    /Certificate PDF available|Payment verified|Verified paid/,
  );
  const noFee = render({
    state: "APPROVED",
    role: "citizen",
    order: { totalMinor: 0, paymentStatus: "NOT_REQUIRED" },
  });
  assert.match(noFee, /authorised officer must issue/);
  assert.doesNotMatch(noFee, /href=/);
});

test("guidance: certificate links require the issued record and revocation overrides available state", () => {
  const issued = render({ state: "ISSUED", hasCertificate: true });
  assert.match(issued, /href="#application-certificate"/);
  assert.doesNotMatch(issued, /DEMO \/ NOT OFFICIAL/);
  const missing = render({ state: "ISSUED", hasCertificate: false });
  assert.match(missing, /certificate record is unavailable/);
  assert.doesNotMatch(missing, /href=|aria-current="step"/);
  for (const props of [
    { state: "ISSUED", revoked: true },
    { state: "REVOKED", revoked: false },
  ]) {
    const revoked = render({ ...props, hasCertificate: true });
    assert.match(revoked, /Certificate revoked/);
    assert.match(revoked, /retained PDF does not make the certificate active/);
    assert.match(revoked, /View certificate record/);
    assert.doesNotMatch(
      revoked,
      /Certificate PDF available|aria-current="step"/,
    );
  }
});

test("guidance: closed and unknown applications do not promise a next workflow transition", () => {
  for (const state of ["REJECTED", "CANCELLED", "UNKNOWN"]) {
    const html = render({ state, role: "approver" });
    assert.doesNotMatch(html, /href=|aria-current="step"|<button|<form/);
  }
  assert.match(
    render({ state: "REJECTED" }),
    /cannot proceed to certificate issuance/,
  );
  assert.match(render({ state: "CANCELLED" }), /start a new application/);
  assert.match(
    render({ state: "UNKNOWN" }),
    /next step for this status could not be determined/,
  );
});

test("guidance: Bangla copy preserves correction and fee holds without adding mutation controls", () => {
  setLanguage("bn");
  try {
    const corrected = render({ state: "CORRECTION_REQUIRED" });
    assert.match(corrected, /এরপর কী করবেন/);
    assert.match(
      corrected,
      /পরিবর্তন সংরক্ষণ করুন, তারপর পুনরায় আবেদন জমা দিন/,
    );
    assert.match(corrected, /aria-label="আবেদনের ধাপ"/);
    const feeHold = render({
      state: "APPROVED",
      role: "approver",
      order: { totalMinor: 15210, paymentStatus: "NOT_COLLECTED" },
    });
    assert.match(feeHold, /পরিশোধ সার্ভারে যাচাই হতে হবে/);
    assert.doesNotMatch(feeHold, /<button|<form|href=/);
  } finally {
    setLanguage("en");
  }
});
