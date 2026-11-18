import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Font } from "@react-pdf/renderer";

/**
 * REACTPDF-MIGRATION-01 — certificate font policy for the react-pdf engine.
 *
 * The spike (PDF-LIBS-SPIKE-01) proved the on-hand Noto Sans Bengali TTFs are
 * Bengali-only builds: 679 glyphs, NO Latin letters at all. Chromium survives
 * that only through silent font fallback (it embeds LiberationSans for Latin
 * in the reference PDFs). The react-pdf engine must not inherit a silent
 * behaviour, so the policy here is explicit and total:
 *
 *   - Bengali-script runs (U+0980–U+09FF, incl. Bengali digits, plus the
 *     ZWJ/ZWNJ that join Bengali conjuncts, plus the danda U+0964/U+0965 —
 *     Bengali sentence punctuation that Unicode places in the Devanagari
 *     block) render in "Astra Bengali" (Noto Sans Bengali, bundled in
 *     apps/api/assets/fonts).
 *   - Latin-script runs (letters, ASCII digits, Latin punctuation) render in
 *     "Astra Latin" (Liberation Sans, bundled alongside) — the same typeface
 *     Chromium's fallback chose, so the two engines look alike.
 *   - Neutral characters (spaces, shared punctuation) attach to the run
 *     before them; a string of neutrals only takes the caller's base family.
 *
 * Every dynamic string on the certificate goes through splitScriptRuns() /
 * the <Runs> component in pdf-react.tsx — no string reaches the page in a
 * single-family assumption. The proof pack verifies the policy mechanically:
 * pdffonts must list BOTH bundled families and pdftotext must recover the
 * Latin certificate number whole (a .notdef would lose it).
 */
export const CERT_BENGALI_FAMILY = "Astra Bengali";
export const CERT_LATIN_FAMILY = "Astra Latin";

const FONT_FILES = {
  bengaliRegular: "NotoSansBengali-Regular.ttf",
  bengaliBold: "NotoSansBengali-Bold.ttf",
  latinRegular: "LiberationSans-Regular.ttf",
  latinBold: "LiberationSans-Bold.ttf",
} as const;

const moduleFonts = fileURLToPath(new URL("../assets/fonts/", import.meta.url));

function fontFile(name: string): string {
  const candidates = [
    process.env.CERTIFICATE_FONT_DIR
      ? path.join(process.env.CERTIFICATE_FONT_DIR, name)
      : null,
    path.join(moduleFonts, name),
    path.join(process.cwd(), "apps", "api", "assets", "fonts", name),
    path.join(process.cwd(), "assets", "fonts", name),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(
    `Certificate font ${name} not found (looked in CERTIFICATE_FONT_DIR, the package assets/fonts and the working directory). The react-pdf engine bundles its fonts; see apps/api/assets/fonts.`,
  );
}

let registered = false;
/** Idempotent: register the two policy families once per process. */
export function ensureCertificateFonts(): void {
  if (registered) return;
  Font.register({
    family: CERT_BENGALI_FAMILY,
    fonts: [
      { src: fontFile(FONT_FILES.bengaliRegular) },
      { src: fontFile(FONT_FILES.bengaliBold), fontWeight: 700 },
    ],
  });
  Font.register({
    family: CERT_LATIN_FAMILY,
    fonts: [
      { src: fontFile(FONT_FILES.latinRegular) },
      { src: fontFile(FONT_FILES.latinBold), fontWeight: 700 },
    ],
  });
  // Never split a word with a hyphen: Bengali conjuncts and certificate
  // numbers must wrap whole or not at all (the spike's working setting).
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export type CertFamily = typeof CERT_BENGALI_FAMILY | typeof CERT_LATIN_FAMILY;
export interface ScriptRun {
  text: string;
  family: CertFamily;
}

// The danda (।, U+0964) and double danda (॥, U+0965) are classified as
// Bengali, not neutral: Noto Sans Bengali carries both glyphs, Liberation
// Sans carries neither. As neutrals they attached to a preceding Latin run
// (a clause-final danda after a Latin field value), fell out of the Latin
// font, and react-pdf substituted Helvetica — the proof pack's services
// 6/9/10/20/38 printed a Latin "d" where the sentence-ending । belonged
// (REACTPDF-MIGRATION-02). Bengali runs keep them in the Bengali font.
const BENGALI_CHAR = /[\u0964\u0965\u0980-\u09FF\u200C\u200D]/;
const LATIN_CHAR = /[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF]/;

/**
 * Split a string into Bengali / Latin script runs. Neutral characters attach
 * to the preceding run (leading neutrals attach to the first classified run;
 * a neutral-only string yields one run in `baseFamily`).
 */
export function splitScriptRuns(
  value: string,
  baseFamily: CertFamily = CERT_BENGALI_FAMILY,
): ScriptRun[] {
  const runs: ScriptRun[] = [];
  let pending = "";
  const push = (family: CertFamily, chunk: string) => {
    if (!chunk) return;
    const last = runs[runs.length - 1];
    if (last && last.family === family) last.text += chunk;
    else runs.push({ text: chunk, family });
  };
  for (const char of value) {
    const family = BENGALI_CHAR.test(char)
      ? CERT_BENGALI_FAMILY
      : LATIN_CHAR.test(char)
        ? CERT_LATIN_FAMILY
        : null;
    if (family === null) {
      pending += char;
      continue;
    }
    if (pending) {
      // Neutrals attach to the run before them; leading neutrals (no run yet)
      // attach to the first classified run instead.
      push(runs.length ? runs[runs.length - 1]!.family : family, pending);
      pending = "";
    }
    push(family, char);
  }
  if (pending) {
    if (runs.length) push(runs[runs.length - 1]!.family, pending);
    else runs.push({ text: pending, family: baseFamily });
  }
  return runs;
}
