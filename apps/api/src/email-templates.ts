import type { MailMessage } from "./mailer.js";

/**
 * Phase 7: the platform's email templates in one place. Until now each event's
 * subject and body were built inline at its call site (email-verification.ts,
 * status-notifications.ts); the wording is unchanged — bilingual BN/EN, matching
 * the product voice — only the home moved, so a copy edit or a future HTML part
 * happens once. Templates return subject + text; the caller adds the recipient.
 */
type Template = Omit<MailMessage, "to">;

/** Registration / account email verification (link carries the one-time token). */
export function emailVerificationTemplate(input: {
  link: string;
  ttlHours: number;
}): Template {
  return {
    subject: "আপনার ইমেইল যাচাই করুন / Verify your email — DigitalUnion",
    text: [
      "DigitalUnion-এ আপনার অ্যাকাউন্টের ইমেইল ঠিকানা যাচাই করতে নিচের লিংকটি খুলুন:",
      "Open the link below to verify the email address on your DigitalUnion account:",
      "",
      input.link,
      "",
      `লিংকটি ${input.ttlHours} ঘণ্টা পর্যন্ত কার্যকর থাকবে। / The link is valid for ${input.ttlHours} hours.`,
      "আপনি এই অ্যাকাউন্ট তৈরি না করে থাকলে এই বার্তাটি উপেক্ষা করুন। / If you did not create this account, ignore this message.",
    ].join("\n"),
  };
}

/** A certificate was issued for the citizen's application. */
export function certificateIssuedTemplate(input: {
  certificateNumber: string;
  service: string;
}): Template {
  return {
    subject: `সনদ ইস্যু হয়েছে / Certificate issued — ${input.certificateNumber}`,
    text: [
      "আপনার আবেদনের সনদ ইস্যু হয়েছে।",
      "Your certificate has been issued.",
      "",
      `সেবা / Service: ${input.service}`,
      `সনদ নম্বর / Certificate number: ${input.certificateNumber}`,
      "",
      "সাইন ইন করে সনদটি ডাউনলোড করুন। / Sign in to download your certificate.",
    ].join("\n"),
  };
}

/** The citizen's application was rejected, with the office's reason. */
export function applicationRejectedTemplate(input: {
  reason: string;
  service: string;
}): Template {
  return {
    subject: "আবেদন বাতিল হয়েছে / Application rejected — DigitalUnion",
    text: [
      "আপনার আবেদনটি বাতিল করা হয়েছে।",
      "Your application has been rejected.",
      "",
      `সেবা / Service: ${input.service}`,
      `কারণ / Reason: ${input.reason}`,
      "",
      "বিস্তারিত জানতে সাইন ইন করুন অথবা আপনার অফিসে যোগাযোগ করুন। / Sign in or contact your office for details.",
    ].join("\n"),
  };
}
