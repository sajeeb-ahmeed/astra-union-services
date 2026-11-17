import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api.js";

/**
 * Phase UX: the web app's single source of issuance mode.
 *
 * The API's /health reports the deployment mode. OFFICIAL means a production
 * deployment issuing real documents: no demo wording, pills or disclaimers
 * anywhere in the UI. Anything else (including the public demonstration)
 * keeps the honesty notices. While the mode is unknown, components render
 * neither — a production deployment must never flash demo text, and a demo
 * must never hide its notices once the mode is known.
 */
export type IssuanceMode = "OFFICIAL" | "DEMO" | null;

const ModeContext = createContext<IssuanceMode>(null);
let cached: Exclude<IssuanceMode, null> | null = null;
let inflight: Promise<void> | null = null;

function loadMode(): Promise<void> {
  if (!inflight) {
    inflight = api("/health")
      .then((health) => {
        cached =
          String(health?.mode ?? "").toUpperCase() === "OFFICIAL"
            ? "OFFICIAL"
            : "DEMO";
      })
      .catch(() => {
        // If the mode cannot be proven official, the honesty notices stay.
        cached = "DEMO";
      });
  }
  return inflight;
}

export function IssuanceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<IssuanceMode>(cached);
  useEffect(() => {
    if (cached) {
      setMode(cached);
      return;
    }
    let active = true;
    void loadMode().then(() => {
      if (active) setMode(cached);
    });
    return () => {
      active = false;
    };
  }, []);
  return <ModeContext.Provider value={mode}>{children}</ModeContext.Provider>;
}

export function useIssuanceMode(): IssuanceMode {
  return useContext(ModeContext);
}

/** True only when the deployment is proven OFFICIAL. */
export function useIsOfficial(): boolean {
  return useContext(ModeContext) === "OFFICIAL";
}

/** True only when the deployment is known to be a demonstration. */
export function useIsDemo(): boolean {
  return useContext(ModeContext) === "DEMO";
}
