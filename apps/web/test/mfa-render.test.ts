import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MfaChallenge, mfaErrorMessage } from "../src/MfaChallenge.js";
import { setLanguage } from "../src/i18n.js";
import { ApiError } from "../src/api.js";

test("MFA challenge renders labelled one-time-code input in both languages without leaking challenge token", () => {
  for (const language of ["en", "bn"] as const) {
    setLanguage(language);
    try {
      const html = renderToStaticMarkup(
        createElement(MfaChallenge, {
          challenge: {
            mfaRequired: true,
            challengeToken: "private-challenge-do-not-render",
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          },
          onLogin() {},
          onCancel() {},
        }),
      );
      assert.match(html, /autoComplete="one-time-code"/);
      assert.match(html, /aria-describedby="mfa-login-help"/);
      assert.doesNotMatch(
        html,
        /private-challenge-do-not-render|Workspace navigation/,
      );
      assert.match(
        html,
        language === "bn" ? /লগইনের দ্বিতীয় ধাপ/ : /One more step to sign in/,
      );
      assert.match(
        html,
        language === "bn"
          ? /recovery code ব্যবহার করুন/
          : /saved recovery code/,
      );
    } finally {
      setLanguage("en");
    }
  }
});

test("MFA errors explain expiry, retry and server unavailability without reflecting raw diagnostics", () => {
  for (const language of ["en", "bn"] as const) {
    setLanguage(language);
    try {
      for (const [code, status, expected] of [
        [
          "MFA_CHALLENGE_INVALID",
          422,
          language === "bn" ? /মেয়াদ শেষ/ : /sign-in has expired/,
        ],
        [
          "MFA_ENROLLMENT_EXPIRED",
          422,
          language === "bn" ? /সেটআপের মেয়াদ/ : /Setup has expired/,
        ],
        [
          "MFA_RATE_LIMIT",
          429,
          language === "bn" ? /অপেক্ষা/ : /Wait a little/,
        ],
        [
          "MFA_UNAVAILABLE",
          503,
          language === "bn" ? /ব্যবহার করা যাচ্ছে না/ : /is unavailable/,
        ],
        [
          "PASSWORD_MISMATCH",
          422,
          language === "bn"
            ? /পাসওয়ার্ডটি সঠিক হয়নি/
            : /current password is incorrect/,
        ],
        [
          "INTERNAL_ERROR",
          500,
          language === "bn" ? /যাচাই করা যায়নি/ : /Verification failed/,
        ],
      ] as const) {
        const message = mfaErrorMessage(
          new ApiError(
            "private diagnostic 123456",
            { error: { code } },
            status,
          ),
        );
        assert.match(message, expected);
        assert.doesNotMatch(message, /private diagnostic|123456/);
      }
    } finally {
      setLanguage("en");
    }
  }
});
