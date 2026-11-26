import { useEffect, useSyncExternalStore } from "react";

/**
 * F-001 (HOME-REDESIGN-02): the platform's public support contact.
 *
 * Citizens and offices look for a phone number and an email before they
 * trust a service site. The values are owner-configurable (Settings →
 * Support contact) and stored in platform_settings — fill them with the
 * REAL support channels, never a placeholder. Until the owner sets them,
 * every field is empty and every surface that shows them (utility bar,
 * help widget, footer) renders a field only when it is non-empty, so
 * leaving one blank simply hides it. The value lives in a tiny external
 * store so that when the owner saves a new contact, every mounted shell
 * re-renders with it in the same session (same pattern as branding.ts).
 */
export type SupportContact = {
  /** e.g. "+8801XXXXXXXXX" — shown as a tap-to-call link. */
  phone: string;
  /** e.g. "support@your-domain" — shown as a mailto link. */
  email: string;
  /** Office hours, e.g. { bn: "শনি–বৃহস্পতি, সকাল ৯টা–বিকাল ৫টা", en: "Sat–Thu, 9am–5pm" }. */
  hours: { bn: string; en: string };
};

export const DEFAULT_SUPPORT_CONTACT: SupportContact = {
  phone: "",
  email: "",
  hours: { bn: "", en: "" },
};

let current: SupportContact = DEFAULT_SUPPORT_CONTACT;
let loadPromise: Promise<SupportContact> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function loadSupportContact(): Promise<SupportContact> {
  loadPromise ??= fetch("/api/v1/support-contact", { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) return DEFAULT_SUPPORT_CONTACT;
      const data = (await response.json()) as Partial<{
        phone: string;
        email: string;
        hoursBn: string;
        hoursEn: string;
      }>;
      return {
        phone: data.phone || "",
        email: data.email || "",
        hours: { bn: data.hoursBn || "", en: data.hoursEn || "" },
      };
    })
    .catch(() => DEFAULT_SUPPORT_CONTACT)
    .then((value) => {
      current = value;
      emit();
      return value;
    });
  return loadPromise;
}

/** After the owner saves a new contact, later renders in this session use it without a reload. */
export function setCachedSupportContact(contact: SupportContact) {
  current = contact;
  loadPromise = Promise.resolve(contact);
  emit();
}

export function useSupportContact(): SupportContact {
  const contact = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => DEFAULT_SUPPORT_CONTACT,
  );
  useEffect(() => {
    void loadSupportContact();
  }, []);
  return contact;
}

export const hasSupportContact = (contact: SupportContact) =>
  !!(contact.phone || contact.email);
