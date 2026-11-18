import { useEffect, useSyncExternalStore } from "react";

/**
 * Phase 3D: the platform branding (display name + taglines) is owner-editable from the
 * dashboard and stored in platform_settings (see apps/api/src/billing.ts). The shells
 * render these values; until the fetch resolves — and whenever it fails — they render
 * the built-in defaults, which are exactly the wording the shells hard-coded before 3D,
 * so an untouched platform looks identical and first paint never waits on the network.
 * The value lives in a tiny external store so that when the owner saves new branding,
 * every mounted shell (sidebar, header, footer) re-renders with it in the same session.
 */
export type Branding = { name: string; taglineBn: string; taglineEn: string };

export const DEFAULT_BRANDING: Branding = {
  name: "DigitalUnion",
  taglineBn: "স্মার্ট ইউনিয়ন, স্মার্ট বাংলাদেশ",
  taglineEn: "Smart Union, Smart Bangladesh",
};

let current: Branding = DEFAULT_BRANDING;
let loadPromise: Promise<Branding> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function loadBranding(): Promise<Branding> {
  loadPromise ??= fetch("/api/v1/branding", { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) return DEFAULT_BRANDING;
      const data = (await response.json()) as Partial<Branding>;
      return {
        name: data.name || DEFAULT_BRANDING.name,
        taglineBn: data.taglineBn || DEFAULT_BRANDING.taglineBn,
        taglineEn: data.taglineEn || DEFAULT_BRANDING.taglineEn,
      };
    })
    .catch(() => DEFAULT_BRANDING)
    .then((value) => {
      current = value;
      emit();
      return value;
    });
  return loadPromise;
}

/** After the owner saves new branding, later renders in this session use it without a reload. */
export function setCachedBranding(branding: Branding) {
  current = branding;
  loadPromise = Promise.resolve(branding);
  emit();
}

export function useBranding(): Branding {
  const branding = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => DEFAULT_BRANDING,
  );
  useEffect(() => {
    void loadBranding();
  }, []);
  return branding;
}
