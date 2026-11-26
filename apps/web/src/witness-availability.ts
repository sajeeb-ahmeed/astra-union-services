import { useEffect, useSyncExternalStore } from "react";

/**
 * L-004: the witness generator offers nothing until the owner enters its
 * certificate types — but its entry points (home help card, drawer,
 * footer) linked to an empty generator. The shell hides those links once
 * the options list is CONFIRMED empty, and only then.
 *
 * Fail-open by design: while the fetch is in flight ("unknown") or fails
 * (a network error must never hide a working feature), the links stay
 * visible. The state lives in a tiny external store (same pattern as
 * branding.ts) so every mounted shell re-renders with it in the same
 * session. The /witness page itself stays reachable by direct URL — its
 * own empty state is the generator's business, not the shell's.
 */
type WitnessAvailability = "unknown" | "available" | "empty";

let current: WitnessAvailability = "unknown";
let loadPromise: Promise<WitnessAvailability> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function loadWitnessAvailability(): Promise<WitnessAvailability> {
  loadPromise ??= fetch("/api/v1/public/witness/options", { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) return "unknown" as WitnessAvailability;
      const data = (await response.json()) as { items?: unknown[] };
      return (Array.isArray(data.items) && data.items.length > 0 ? "available" : "empty") as WitnessAvailability;
    })
    .catch(() => "unknown" as WitnessAvailability)
    .then((value) => {
      current = value;
      emit();
      return value;
    });
  return loadPromise;
}

/** True while the witness generator may have something to offer (unknown or confirmed available). */
export function useWitnessAvailable(): boolean {
  const availability = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => "unknown" as WitnessAvailability,
  );
  useEffect(() => {
    void loadWitnessAvailability();
  }, []);
  return availability !== "empty";
}
