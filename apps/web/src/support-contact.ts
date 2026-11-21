/**
 * HOME-REDESIGN-02: the platform's public support contact.
 *
 * Citizens and offices look for a phone number and an email before they
 * trust a service site. Fill these with the REAL support channels — never a
 * placeholder. Every surface that shows them (utility bar, help widget,
 * footer) renders a field only when it is non-empty, so leaving one blank
 * simply hides it.
 */
export const SUPPORT_CONTACT = {
  /** e.g. "+8801XXXXXXXXX" — shown as a tap-to-call link. */
  phone: "",
  /** e.g. "support@your-domain" — shown as a mailto link. */
  email: "",
  /** Office hours, e.g. { bn: "শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা", en: "Sat–Thu, 9am–5pm" }. */
  hours: { bn: "", en: "" },
};

export const hasSupportContact = () =>
  !!(SUPPORT_CONTACT.phone || SUPPORT_CONTACT.email);
