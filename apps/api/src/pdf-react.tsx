import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { Style } from "@react-pdf/stylesheet";
import {
  type FormSchema,
  type FieldDefinition,
  isFieldVisible,
  getServiceSchema,
} from "@astra/shared-schemas";
import type { PdfInput } from "./certificate-template.js";
import {
  ATTESTATIONS_BN,
  ATTESTATIONS_EN,
  FORM_SERVICES,
  STATUS_SENTENCE_BN,
  STATUS_SENTENCE_EN,
  STATUS_SENTENCE_SERVICES,
  correctionFieldLabel,
  WORDING_BLESSING_BN,
  WORDING_BLESSING_EN,
  WORDING_BLESSING_SERVICES,
  WORDING_INTRO_BN,
  wordingSpouseLabel,
  deceasedName,
  consentGuardianName,
  consentGuardianPurpose,
  transferReasonPhrase,
  orgTypeLabel,
  amountInWordsBn,
  amountInWordsEn,
  bnDigits,
  CERT_PAPER_BG,
  bnDate,
  bnDateIso,
  bnDateSlash,
  bnDateDash,
  bnOrd,
  enDateDash,
  enOrd,
  deathCauseEn,
  deathPlaceEn,
  enDate,
  enDateIso,
  enDateSlash,
  fiscalYear,
  money,
  ordDate,
  latinDigits,
  passportPurposeLabel,
  present,
  text,
  chairmanTitle,
  certificatePageFormat,
  officeLine,
  permanentAddress,
  presentAddress,
  selectLabel,
  tableAge,
  tableRelation,
  HEIR_TABLE_WIDTHS,
  HEIR_TABLE_ALIGNS,
  HEIR_TABLE_HEAD_ALIGNS,
  HEIR_TABLE_HEADERS_BN,
  HEIR_TABLE_HEADERS_EN,
  type AttestContext,
  type DocContext,
} from "./certificate-template-v7.js";
import {
  certificateAssetsBundle,
  governmentEmblemDataUrl,
} from "./template-assets.js";
import {
  DEMO_BANNER_BN,
  DEMO_BANNER_EN,
  DEMO_NOTICE_BN,
  DEMO_NOTICE_EN,
} from "./demo-notice.js";
import {
  CERT_BENGALI_FAMILY,
  CERT_LATIN_FAMILY,
  ensureCertificateFonts,
  splitScriptRuns,
  type CertFamily,
} from "./certificate-fonts.js";

/**
 * REACTPDF-MIGRATION-01 — Template v7 re-expressed as React-PDF components.
 *
 * This is a presentation-layer twin of certificate-template-v7.ts: it consumes
 * the SAME DocContext inputs, the SAME attestation corpus (ATTESTATIONS_BN/EN),
 * the SAME per-service page formats and the SAME asset resolvers
 * (template-assets.ts), and produces the same document structure — header with
 * government emblem, office name/address, document title, number/date line,
 * the paragraph / deceased / generic-form / trade-licence bodies, the chairman
 * signature block, the QR + verification footer, the office-seal
 * watermark and the double-rule frame. The Chromium renderer remains the
 * default engine (PDF_ENGINE in pdf.ts); this module renders only when
 * PDF_ENGINE=react-pdf.
 *
 * CERTNO-01 SUPERSEDED (Md's order, 25 Nov 2026 — all certificates in
 * Prottoyon's design/format): the certificate number prints PLAIN (no
 * one-digit-per-box strip) and the centre watermark is the office's own UP
 * SEAL, resolved per tenant from that office's profile SEAL setting first,
 * then the deployment asset dir (template-assets.ts) — never hardcoded,
 * never a shared default, never the Government emblem; with no seal asset
 * there is no watermark. (Md re-confirmed the per-UP profile-first
 * resolution 25 Nov 2026, 12:12.) The header carries the government emblem
 * only — no government line, no office logo — as on the Prottoyon
 * references.
 *
 * Deliberate differences from the HTML twin, all forced by the engine:
 *  - Text is set through the explicit font policy in certificate-fonts.ts
 *    (script runs), never a single-family assumption.
 *  - CSS 600-weight text uses the 700 font file (the bundled families ship
 *    Regular + Bold only).
 *  - Layout is flex rows instead of HTML tables/floats; sizes are the CSS
 *    values converted px→pt (×0.75), mm kept as mm.
 */

const MM = 2.83465;
const px = (n: number) => n * 0.75;

// CERT-REFINE-02 (R2-10): never hyphenate certificate text. The layout
// engine's default hyphenation split a bold name run mid-word and left a
// dangling "-," fragment at a line start; whole-word wrapping plus the
// comma glued to its preceding fragment (joinSegs) removes the artefact.
Font.registerHyphenationCallback((word) => [word]);

/* ---------- text segments (the structured twin of the HTML <strong> runs) ---------- */
interface Seg {
  t: string;
  b?: boolean;
}
const seg = (t: string, b = false): Seg => ({ t, b });
const joinSegs = (parts: Seg[][]): Seg[] => {
  const out: Seg[] = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      // CERT-REFINE-02 (R2-10): the comma is glued to the preceding
      // fragment so a name and its comma form one unbreakable unit — a
      // line break can never strand "-," or "," at a line start.
      const prev = out[out.length - 1];
      if (prev) out[out.length - 1] = { ...prev, t: `${prev.t},` };
      out.push(seg(" "));
    }
    out.push(...part);
  });
  return out;
};

/** Render segments through the font policy: every string is script-split. */
function Runs({
  segs,
  base,
  bold = false,
}: {
  segs: Seg[];
  base: CertFamily;
  /** Container-level weight: v7 styles whole lines bold (number line,
   * headings, field labels). Nested react-pdf Text does NOT inherit a
   * parent Text's fontWeight once it sets its own, so bold containers must
   * pass it explicitly; a segment's own bold flag also forces 700. */
  bold?: boolean;
}) {
  const nodes: React.ReactNode[] = [];
  segs.forEach((s, i) => {
    if (!s.t) return;
    splitScriptRuns(s.t, base).forEach((run, j) => {
      nodes.push(
        <Text
          key={`${i}-${j}`}
          style={{
            fontFamily: run.family,
            fontWeight: s.b || bold ? 700 : 400,
          }}
        >
          {run.text}
        </Text>,
      );
    });
  });
  return <>{nodes}</>;
}

/** A single styled paragraph whose content is segments. */
function Para({
  segs,
  base,
  style,
}: {
  segs: Seg[];
  base: CertFamily;
  style?: Style;
}) {
  return (
    <Text style={style}>
      <Runs segs={segs} base={base} />
    </Text>
  );
}

/* ---------- styles (converted from the v7 stylesheet) ---------- */
const styles = StyleSheet.create({
  // CERT-REFINE-02 (R2-22): all certificate text is true black.
  // CERT-PAPER (Md's order, 25 Nov 2026 15:59): warm cream/ivory
  // government-paper page background — covers the full page, inside
  // and outside the frame (see CERT_PAPER_BG in the v7 template).
  page: { color: "#000", backgroundColor: CERT_PAPER_BG },
  content: {},
  header: { alignItems: "center" },
  // Prottoyon reference header (Md's order 25 Nov 2026): one header
  // lockup — emblem 62 pt (≈22 mm, as measured on the references),
  // office name 21 pt bold, address 10.5 pt, title below.
  emblem: { width: 62, height: 62, objectFit: "contain", marginBottom: 3 },
  officeName: { fontSize: 21, lineHeight: 1.35, textAlign: "center", fontWeight: 700 },
  officeAddress: { fontSize: 10.5, textAlign: "center", lineHeight: 1.35 },
  docTitle: { fontSize: 17, lineHeight: 1.4, textAlign: "center", fontWeight: 700, marginTop: 9 },
  numline: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    columnGap: 9 * MM,
    rowGap: 1.5 * MM,
    fontWeight: 700,
    marginTop: 4.5 * MM,
    marginBottom: 2.5 * MM,
  },
  // CERT-REFINE-02 (R2-06): body 12.5 pt on 21 pt leading.
  bodyPara: { textAlign: "justify", fontSize: 12.5, lineHeight: 1.55 },
  // GATE FIX (25 Nov 2026): compact body for the long heir/member services
  // (2/3) — the reference's warish/family bodies are denser (table rows
  // ~17pt, body font ~11.5pt, leading ~1.5). The standard 12.5pt/1.55
  // leading + 2.5pt table padding pushed the 7-row warish body ~61pt past
  // the page in the FLOW layout (services 2/3/4 are NOT anchored — see
  // CertificateDocument: the signature + footer render in-flow after the
  // body, so the bodyReserve never applied to them). The compact set
  // reclaims it without touching the other 45 types.
  // REFINE (25 Nov 2026): 11.5/1.5 -> 12/1.55 — the reference warish
  // body pitch measures 6.53mm; 12pt x 1.55 = 18.6pt = 6.56mm, and it
  // closes most of the gap to the standard 12.5pt body. Fit re-verified
  // on the proof renders (7-row warish stays 1 page anchored).
  bodyParaCompact: { textAlign: "justify", fontSize: 12, lineHeight: 1.55 },
  closingCompact: { marginTop: 8, textAlign: "justify", fontSize: 12, lineHeight: 1.55 },
  closing: { marginTop: 10, textAlign: "justify", fontSize: 12.5, lineHeight: 1.68 },
  freeFooter: { fontSize: px(12), marginTop: 4 * MM },
  // CERT-REFINE-02 (R2-13): the signature block is a fixed 200 pt column;
  // its position comes from the anchored wrapper in CertificateDocument.
  signBlock: {
    width: 200,
    fontSize: 10.5,
    lineHeight: 1.5,
  },
  signName: { fontWeight: 700, fontSize: 12, textAlign: "center" },
  // Prottoyon reference: every signature block signs on a dotted rule
  // above the name (chairman, admin officer, collector, guardian alike).
  signLineDotted: {
    borderTopWidth: px(1.6),
    borderTopColor: "#333",
    borderTopStyle: "dotted",
    marginTop: 1.6 * MM,
    marginBottom: 1.6 * MM,
    marginLeft: 5 * MM,
    marginRight: 5 * MM,
  },
  signTitle: { textAlign: "center", fontSize: 10.5 },
  signOffice: { fontWeight: 700, textAlign: "center", fontSize: 12 },
  signAddress: { textAlign: "center", fontSize: 10 },
  // QR-MOVE (Md's order 25 Nov 2026 15:00): the old footer-QR styles
  // (docFoot / qr / verifyLine) are removed — the QR now sits top-left
  // in the header on every certificate and DocFooter carries only the
  // centred verify text (inline styles there).
  tableWrap: { marginTop: 4 * MM },
  tableRow: { flexDirection: "row" },
  // GATE FIX (25 Nov 2026): 4.5/5 -> 2.5/3. The reference's data tables are
  // tight (~17pt rows); ours were ~25pt, and the 8-row heir/member tables
  // (services 2/3) pushed the verbatim bodies onto a second page. The
  // denser rows match the reference and free ~36pt on the long tables.
  tableCell: {
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#666",
    paddingVertical: 1.5,
    paddingHorizontal: 7,
    fontSize: 10.5,
    lineHeight: 1.4,
  },
  // REFINE (25 Nov 2026): header cells are WHITE on the references
  // (bold text only, no grey band) — was #E8E8E8. CERT-PAPER (25 Nov
  // 2026): the "white" is now the paper tone itself, so the header
  // still carries no band against the government-paper background.
  tableHeadCell: {
    fontWeight: 700,
    backgroundColor: CERT_PAPER_BG,
    fontSize: 10.5,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  // GATE FIX (25 Nov 2026): compact table cells for services 2/3 — rows
  // ~17pt, matching the reference's heir/member tables.
  // REFINE (25 Nov 2026): tighter still — the reference heir rows
  // measure ~4.85mm (13.7pt); 10pt x 1.25 + 1pt padding = 13.5pt.
  tableCellCompact: {
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#666",
    paddingVertical: 0.5,
    paddingHorizontal: 7,
    fontSize: 10,
    lineHeight: 1.25,
  },
  tableHeadCellCompact: {
    fontWeight: 700,
    backgroundColor: CERT_PAPER_BG,
    fontSize: 10,
    paddingVertical: 1,
    paddingHorizontal: 7,
    lineHeight: 1.25,
  },
});

/* ---------- shared blocks ---------- */

/**
 * CERTNO-01 superseded (Md's order, 25 Nov 2026): the certificate number
 * prints PLAIN, exactly as stored (Bengali digits on Bangla, Latin digits
 * on English) — no one-digit-per-box strip on any certificate.
 */
function NumberDisplay({
  number,
  bn,
  base,
}: {
  number: string;
  bn: boolean;
  base: CertFamily;
}) {
  return (
    <Text>
      <Runs segs={[seg(bn ? bnDigits(number) : latinDigits(number))]} base={base} bold />
    </Text>
  );
}

/** CERTNO-01: the citizen photo — rendered only when one is on file.
 * WS-SHELL-GAPS (25 Nov 2026): the reference photo measures ≈150×134 px
 * at 110 DPI ≈ 35×31 mm (WS-4, notes/01-ws-tables-s02-s03-evidence.md
 * §1.1) — near-square, not the old 26×32 mm portrait box. In points:
 * 35 mm ≈ 99 pt, 31 mm ≈ 88 pt image, 3 pt white padding, 0.75 pt
 * #8A8A8A border → 107×96 pt frame. Absent photo → nothing renders
 * (no placeholder, no reserved space). */
function CitizenPhoto({
  ctx,
  style,
}: {
  ctx: DocContext;
  style?: Style;
}) {
  if (!ctx.input.citizenPhoto) return null;
  return (
    <View
      style={[
        {
          width: 107,
          height: 96,
          borderWidth: 0.75,
          borderColor: "#8A8A8A",
          // CERT-PAPER (25 Nov 2026): photo matte in the paper tone.
          backgroundColor: CERT_PAPER_BG,
          padding: 3,
        },
        style ?? {},
      ]}
    >
      <Image
        src={ctx.input.citizenPhoto}
        style={{ width: 99, height: 88, objectFit: "cover" }}
      />
    </View>
  );
}

function HeaderBlock({
  ctx,
  title,
  emblemUrl,
  base,
  emblemSize = 62,
}: {
  ctx: DocContext;
  title: string;
  emblemUrl: string | null;
  base: CertFamily;
  // REFINE (25 Nov 2026): the reference emblem disc is ~22.6 mm on
  // landscape certs vs ~17.7 mm on portrait (pixel-measured; the
  // asset's disc is ~84% of the image box) — landscape passes 76 pt
  // (~27 mm), portrait keeps the 62 pt (~22 mm) default.
  emblemSize?: number;
}) {
  // Prottoyon reference header (Md's order 25 Nov 2026): emblem → office
  // name → address → title. No government line, no office logo, no
  // hairline, no title accent rule — none appears on any reference.
  return (
    <View style={styles.header}>
      {emblemUrl ? (
        <Image
          // CERT-PAPER (25 Nov 2026): borderRadius clips the emblem
          // asset's white corners to the disc, so no white square
          // shows on the cream paper (the disc is tangent to the
          // square asset's edges — nothing of the emblem is cut).
          style={[
            styles.emblem,
            {
              width: emblemSize,
              height: emblemSize,
              borderRadius: emblemSize / 2,
            },
          ]}
          src={emblemUrl}
        />
      ) : null}
      <Text style={styles.officeName}>
        <Runs segs={[seg(ctx.officeName)]} base={base} bold />
      </Text>
      <Text style={styles.officeAddress}>
        <Runs segs={[seg(ctx.officeAddressLine)]} base={base} />
      </Text>
      <Text style={styles.docTitle}>
        <Runs segs={[seg(title)]} base={base} bold />
      </Text>
    </View>
  );
}

function SignBlock({
  ctx,
  base,
}: {
  ctx: DocContext;
  base: CertFamily;
}) {
  const { input, bn, official } = ctx;
  // CERT-REFINE-02 (R2-03): the approver's name prints in the certificate's
  // language — name_bn on Bangla documents, the Latin name on English ones
  // (fallback to the other form only when the matching one is absent; the
  // issuance path warns when name_bn is missing in official mode).
  const issuerName = input.issuer
    ? bn
      ? text(input.issuer.nameBn) || text(input.issuer.nameEn)
      : text(input.issuer.nameEn) || text(input.issuer.nameBn)
    : "";
  // CERT-REFINE-01 (A11/G5): the chairman's signature IMAGE prints above the
  // line when one is configured (it never rendered in this engine before);
  // the issuance gate now blocks official issuance without one.
  const bundle = certificateAssetsBundle(input.tenant.id, input.assets, input.issuer);
  const signature = official && bundle.signature ? bundle.signature : null;
  // WS-SHELL-GAPS (25 Nov 2026): Prottoyon reference order — the chairman
  // signs on a DOTTED rule ABOVE the bold name, then title → office →
  // address, and NO তারিখ line under the block (verified on
  // /tmp/ref-cit-sign.png and /tmp/ref-warish-sign.png). The signature
  // image, when configured, prints above the rule. The trade licence's
  // TradeSignRow mirrors this order (dotted rules on both blocks).
  return (
    <View style={styles.signBlock}>
      {signature ? (
        <Image
          src={signature}
          style={{
            height: 30,
            width: 150,
            objectFit: "contain",
            alignSelf: "center",
            marginTop: 4,
          }}
        />
      ) : null}
      <View style={styles.signLineDotted} />
      {issuerName ? (
        <Text style={styles.signName}>
          <Runs segs={[seg(issuerName)]} base={base} bold />
        </Text>
      ) : null}
      <Text style={styles.signTitle}>
        <Runs segs={[seg(chairmanTitle(input.issuer?.accountType, bn))]} base={base} />
      </Text>
      <Text style={styles.signOffice}>
        <Runs segs={[seg(ctx.officeName)]} base={base} bold />
      </Text>
      {ctx.officeAddressLine ? (
        <Text style={styles.signAddress}>
          <Runs segs={[seg(ctx.officeAddressLine)]} base={base} />
        </Text>
      ) : null}
    </View>
  );
}

/**
 * WS-SHELL-GAPS (25 Nov 2026): QR centre emblem — the Prottoyon references
 * print a small red govt emblem in the centre of every QR (citizenship +
 * trade licence). The emblem is 20% of the QR width and circular, on the
 * H-level QR pdf.ts now encodes. Without an emblem asset (demo mode) the
 * QR renders bare, as before.
 */
function QrWithEmblem({
  qrDataUrl,
  emblemUrl,
  size,
}: {
  qrDataUrl: string;
  emblemUrl: string | null;
  size: number;
}) {
  const emblemSize = Math.round(size * 0.2);
  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      <Image style={{ width: size, height: size }} src={qrDataUrl} />
      {emblemUrl ? (
        <Image
          src={emblemUrl}
          style={{
            position: "absolute",
            left: (size - emblemSize) / 2,
            top: (size - emblemSize) / 2,
            width: emblemSize,
            height: emblemSize,
            borderRadius: emblemSize / 2,
            // CERT-PAPER (25 Nov 2026): circle in the paper tone.
            backgroundColor: CERT_PAPER_BG,
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * W-001: the demo banner — the same Bengali + English wording as the HTML
 * templates, in one bordered box at the top of the document, plus the
 * "not an official certificate" lines. Official mode renders neither this
 * nor the DEMO watermark below.
 */
function DemoBanner({ base }: { base: CertFamily }) {
  return (
    <View
      style={{
        borderWidth: 2,
        borderColor: "#b3261e",
        padding: 6,
        marginBottom: 4 * MM,
        alignItems: "center",
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: 700, color: "#b3261e", textAlign: "center", lineHeight: 1.4 }}>
        <Runs segs={[seg(DEMO_BANNER_BN, true)]} base={base} bold />
      </Text>
      <Text style={{ fontSize: 13, fontWeight: 700, color: "#b3261e", textAlign: "center", lineHeight: 1.4 }}>
        <Runs segs={[seg(DEMO_BANNER_EN, true)]} base={base} bold />
      </Text>
      <Text style={{ fontSize: 9, color: "#444", textAlign: "center", lineHeight: 1.4, marginTop: 2 }}>
        <Runs segs={[seg(DEMO_NOTICE_BN)]} base={base} />
      </Text>
      <Text style={{ fontSize: 9, color: "#444", textAlign: "center", lineHeight: 1.4 }}>
        <Runs segs={[seg(DEMO_NOTICE_EN)]} base={base} />
      </Text>
    </View>
  );
}

function DocFooter({
  ctx,
  base,
}: {
  ctx: DocContext;
  base: CertFamily;
}) {
  const { input, bn, origin } = ctx;
  // CERT-REFINE-01 (A6): Latin digits in both languages; the QR payload is
  // this same URL (pdf.ts).
  const verifyUrl = `${origin}/verify?searchText=${latinDigits(input.number)}`;
  // QR-MOVE (Md's order 25 Nov 2026 15:00): the QR now sits top-left in
  // the header on EVERY certificate (the trade licence already did), so
  // the footer carries only the verify text. PHOTO-CORNER round (Md's
  // order 25 Nov 2026 15:21): the verify line is LEFT-ALIGNED at the
  // bottom-left (was centred since QR-MOVE). No overlap returns: the
  // anchored footer sits in its own band BELOW the signature row
  // (bottom:42 vs the signature row's bottom:80), so the left-aligned
  // text stays clear of the right-side signature block (svc45/47/26/46
  // re-checked in the photo-corner proof renders).
  // REFINE (25 Nov 2026): ONE verify line, as on the references and in
  // the Chromium engine (CERT-REFINE-01 A6: "one verify label in both
  // languages and both layouts") — "যাচাইকরণ: <url>". The react-pdf
  // twin previously printed "যাচাই করুন:" plus a second
  // number-in-numerals line; both are retired so the two engines and
  // the reference agree.
  return (
    <View style={{ alignItems: "flex-start" }}>
      <Text style={{ fontSize: 8.5, lineHeight: 1.3, textAlign: "left" }}>
        <Runs
          segs={[
            seg(bn ? "যাচাইকরণ: " : "Verification: "),
            seg(verifyUrl),
          ]}
          base={base}
        />
      </Text>
    </View>
  );
}

function DataTable({
  headers,
  rows,
  flexes,
  base,
  aligns,
  headAligns,
  compact,
}: {
  headers: string[];
  rows: string[][];
  flexes: number[];
  base: CertFamily;
  aligns?: readonly string[];
  headAligns?: readonly string[];
  compact?: boolean;
}) {
  if (!rows.length) return null;
  const cell = (isHead: boolean, flex: number, align?: string) => ({
    ...(compact ? styles.tableCellCompact : styles.tableCell),
    ...(isHead ? (compact ? styles.tableHeadCellCompact : styles.tableHeadCell) : {}),
    flex,
    borderTopWidth: isHead ? 0.5 : 0,
    borderLeftWidth: 0,
    ...(align ? { textAlign: align as "left" | "center" | "right" } : {}),
  });
  return (
    // REFINE (25 Nov 2026): the reference heir/member tables run ~95%
    // of the text width (left-aligned, ending short of the right edge).
    <View style={[styles.tableWrap, compact ? { marginTop: 2 * MM, width: "95%" } : {}]}>
      <View style={[styles.tableRow, { borderLeftWidth: 0.5, borderColor: "#666" }]}>
        {headers.map((h, i) => (
          <Text key={i} style={cell(true, flexes[i] ?? 1, headAligns?.[i] ?? aligns?.[i])}>
            <Runs segs={[seg(h)]} base={base} bold />
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.tableRow, { borderLeftWidth: 0.5, borderColor: "#666" }]}>
          {row.map((c, i) => (
            <Text key={i} style={cell(false, flexes[i] ?? 1, aligns?.[i])}>
              {/* CERT-REFINE-02 (R2-11): an empty cell prints "—". */}
              <Runs segs={[seg(c === "" ? "—" : c)]} base={base} />
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ---------- identity + paragraph chassis (structured mirrors of v7) ---------- */

/**
 * CERT-REFINE-01 (A2): the standard identity block — name, father, mother,
 * then NID (birth registration only when no NID). No spouse segment.
 */
function identitySegs(ctx: DocContext): Seg[] {
  const { input, bn } = ctx;
  const c = input.citizen;
  const parts: Seg[][] = [];
  parts.push([seg(bn ? c.full_name_bn : c.full_name_en, true)]);
  const nid = input.identity?.nid;
  const birthReg = input.identity?.birthReg;
  if (bn) {
    if (present(c.father_name_bn)) parts.push([seg("পিতাঃ "), seg(text(c.father_name_bn), true)]);
    if (present(c.mother_name_bn)) parts.push([seg("মাতাঃ "), seg(text(c.mother_name_bn), true)]);
    if (present(nid)) parts.push([seg("জাতীয় পরিচয়পত্র নম্বরঃ "), seg(bnDigits(nid), true)]);
    else if (present(birthReg)) parts.push([seg("জন্ম নিবন্ধন নম্বরঃ "), seg(bnDigits(birthReg), true)]);
  } else {
    if (present(c.father_name_en)) parts.push([seg("Father: "), seg(text(c.father_name_en), true)]);
    if (present(c.mother_name_en)) parts.push([seg("Mother: "), seg(text(c.mother_name_en), true)]);
    if (present(nid)) parts.push([seg("National ID No: "), seg(text(nid), true)]);
    else if (present(birthReg)) parts.push([seg("Birth Registration No: "), seg(text(birthReg), true)]);
  }
  return joinSegs(parts);
}

const runAttestation = (
  a:
    | string
    | ((p: Record<string, unknown>, ctx?: AttestContext) => string)
    | undefined,
  payload: Record<string, unknown>,
  ctx?: AttestContext,
) => (typeof a === "function" ? a(payload, ctx) : (a ?? ""));

/* ---------- WS-WORDING (25 Nov 2026): Prottoyon verbatim bodies (BN only) ----------
 * Structured twin of the HTML builders in certificate-template-v7.ts —
 * same identity orders, same address clause, same per-service sentences.
 * English documents keep the existing chassis (no English reference). */
type WordingIdentitySpec = ("birthReg" | "spouse" | "father" | "mother")[];
function wordingIdentitySegs(
  ctx: DocContext,
  spec: WordingIdentitySpec,
  opts?: { fatherLabel?: string; spouseName?: string },
): Seg[] {
  const { input, bn } = ctx;
  const c = input.citizen;
  const parts: Seg[][] = [[seg(bn ? c.full_name_bn : c.full_name_en, true)]];
  for (const s of spec) {
    if (s === "birthReg") {
      if (present(input.identity?.birthReg))
        parts.push([
          seg("জন্ম নিবন্ধন নম্বরঃ "),
          seg(bnDigits(input.identity!.birthReg), true),
        ]);
    } else if (s === "spouse") {
      const spouseName =
        opts?.spouseName ?? text(bn ? c.spouse_name_bn : c.spouse_name_en);
      if (present(spouseName))
        parts.push([seg(`${wordingSpouseLabel(c.gender)}ঃ `), seg(spouseName, true)]);
    } else if (s === "father") {
      if (present(bn ? c.father_name_bn : c.father_name_en))
        parts.push([
          seg(`${opts?.fatherLabel ?? "পিতাঃ"} `),
          seg(text(bn ? c.father_name_bn : c.father_name_en), true),
        ]);
    } else if (s === "mother") {
      if (present(bn ? c.mother_name_bn : c.mother_name_en))
        parts.push([
          seg("মাতাঃ "),
          seg(text(bn ? c.mother_name_bn : c.mother_name_en), true),
        ]);
    }
  }
  return joinSegs(parts);
}
/** "তাহার স্থায়ী ঠিকানাঃ- …। বর্তমান ঠিকানাঃ- …।" — present prints even when identical (D5). */
function wordingAddressSegs(ctx: DocContext): Seg[] {
  return [
    seg(
      `তাহার স্থায়ী ঠিকানাঃ- ${permanentAddress(ctx)}। বর্তমান ঠিকানাঃ- ${presentAddress(ctx)}।`,
    ),
  ];
}
/**
 * WS-WORDING bodies for 12/15/22/33/35/37 (BN). Returns the body WITHOUT
 * the closing blessing — paragraphBody appends it. Service 33 includes its
 * 3-column table (no serial column); the intro is the paragraph's own
 * closing sentence.
 */
function wordingBody(ctx: DocContext, serviceNo: number, base: CertFamily) {
  const { input } = ctx;
  const p = input.payload;
  const head = (identity: Seg[]): Seg[] => [
    seg(`${WORDING_INTRO_BN} `),
    ...identity,
    seg(", "),
    ...wordingAddressSegs(ctx),
  ];
  switch (serviceNo) {
    case 12:
      return (
        <Para
          segs={[
            ...head(wordingIdentitySegs(ctx, ["birthReg", "spouse", "father", "mother"])),
            seg(" তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশী নাগরিক।"),
          ]}
          base={base}
          style={styles.bodyPara}
        />
      );
    case 15:
      return (
        <Para
          segs={[
            ...head(wordingIdentitySegs(ctx, ["father", "mother"])),
            seg(
              " তিনি অত্র ইউনিয়নের স্থায়ী বাসিন্দা এবং বাংলাদেশের নাগরিক। তাহাকে অত্র ইউনিয়ন পরিষদ হইতে নাগরিক সনদ এবং ট্যাক্স রশিদ প্রদান করা হইয়াছে এবং আমার জানা মতে তিনি ইতিপূর্বে কোথাও ভোটার হন নাই। তাই তাহাকে নতুন ভোটার হিসেবে নিবন্ধন করে জাতীয় পরিচয় পত্র দেওয়া যেতে পারে মর্মে সুপারিশ করা হইলো।",
            ),
          ]}
          base={base}
          style={styles.bodyPara}
        />
      );
    case 22:
      return (
        <Para
          segs={[
            ...head(wordingIdentitySegs(ctx, ["father", "mother"])),
            seg(" তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা। আমার জানা মতে, বর্তমানে তিনি অবিবাহিত।"),
          ]}
          base={base}
          style={styles.bodyPara}
        />
      );
    case 33: {
      // The resident clause follows the mother's name with NO comma, BEFORE
      // the addresses — unlike every other service.
      const identity = wordingIdentitySegs(ctx, ["spouse", "father", "mother"]);
      const paraSegs: Seg[] = [
        seg(`${WORDING_INTRO_BN} `),
        ...identity,
        seg(" অত্র এলাকার একজন স্থায়ী বাসিন্দা। "),
        ...wordingAddressSegs(ctx),
        seg(
          " আবেদনকারীর প্রদত্ত তথ্য মতে, তাহার জাতীয় পরিচয়পত্রে নিম্নোক্ত তথ্য ভুল লিপিবদ্ধ করা হয় এবং তাহার আবেদনের প্রেক্ষিতে তা সঠিকভাবে লিপিবদ্ধ করার সুপারিশ করা হলঃ",
        ),
      ];
      const corrections = Array.isArray(p.corrections)
        ? (p.corrections as Record<string, unknown>[])
        : [];
      const schema = input.schema ?? getServiceSchema(33);
      const rows = corrections.map((c) => [
        correctionFieldLabel(c.correction_category_id, schema, true),
        text(c.incorrect_info),
        text(c.correct_info),
      ]);
      return (
        <>
          <Para segs={paraSegs} base={base} style={styles.bodyPara} />
          <DataTable
            headers={["ধরণ", "ভুল তথ্য", "সুপারিশকৃত সঠিক তথ্য"]}
            rows={rows}
            flexes={[1, 1.15, 1.3]}
            base={base}
            aligns={["center", "left", "left"]}
            headAligns={["center", "center", "center"]}
          />
        </>
      );
    }
    case 35:
      return (
        <Para
          segs={[
            ...head(wordingIdentitySegs(ctx, ["father", "mother"])),
            seg(
              " সে অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশের নাগরিক। আমার জানা মতে, তাহার স্বভাব চরিত্র ভাল এবং বর্তমানে সে অবিবাহিত।",
            ),
          ]}
          base={base}
          style={styles.bodyPara}
        />
      );
    case 37: {
      const reason = transferReasonPhrase(p, true);
      return (
        <Para
          segs={[
            ...head(wordingIdentitySegs(ctx, ["spouse", "father", "mother"])),
            ...(reason ? [seg(` ${reason}`)] : []),
            seg(
              " তিনি অত্র এলাকায় স্থায়ীভাবে বসবাস করছেন এবং বাংলাদেশের নাগরিক। তাহার পূর্বের ভোটার এলাকা পরিবর্তন করে অত্র এলাকার ভোটার হিসেবে নিবন্ধন করা যায়।",
            ),
          ]}
          base={base}
          style={styles.bodyPara}
        />
      );
    }
    default:
      return null;
  }
}

function deceasedBody(ctx: DocContext, serviceNo: number, base: CertFamily) {
  const { input, bn } = ctx;
  const p = input.payload;
  const prefix = serviceNo === 3 || serviceNo === 4 ? "warish_info_" : "dead_info_";
  const get = (key: string) => p[`${prefix}${key}`];
  const name = bn ? get("name_bn") : get("name");
  const father = bn ? get("father_name_bn") : get("father_name");
  const mother = bn ? get("mother_name_bn") : get("mother_name");
  const address = permanentAddress(ctx);
  const idParts: Seg[][] = [[seg(text(name ?? ""), true)]];
  if (bn) {
    if (present(father)) idParts.push([seg("পিতাঃ "), seg(text(father), true)]);
    if (present(mother)) idParts.push([seg("মাতাঃ "), seg(text(mother), true)]);
    // CERT-REFINE-01 §§3–4: the deceased's NID prints inside the block.
    if ((serviceNo === 3 || serviceNo === 4) && present(get("nid")))
      idParts.push([seg("জাতীয় পরিচয়পত্র নম্বরঃ "), seg(bnDigits(get("nid")), true)]);
  } else {
    if (present(father)) idParts.push([seg("Father: "), seg(text(father), true)]);
    if (present(mother)) idParts.push([seg("Mother: "), seg(text(mother), true)]);
    if ((serviceNo === 3 || serviceNo === 4) && present(get("nid")))
      idParts.push([seg("National ID No: "), seg(text(get("nid")), true)]);
  }
  const identity = joinSegs(idParts);
  const dod = get("dod");
  const registerNo = get("register_no");
  const sentences: string[] = [];
  if (serviceNo === 7 || serviceNo === 31) {
    const place = bn ? get("place_bn") : get("place");
    const reason = bn ? get("reason_bn") : get("reason");
    if (bn) {
      sentences.push(
        `তিনি ${present(dod) ? `${bnDateIso(dod)} তারিখে ` : ""}${present(place) ? `${text(place)} এ ` : ""}মৃত্যুবরণ করেছেন।`,
      );
      if (present(reason)) sentences.push(`মৃত্যুর কারণঃ ${text(reason)}।`);
      if (serviceNo === 31) sentences.push("তিনি অবিবাহিত অবস্থায় মৃত্যুবরণ করেছেন।");
      if (present(registerNo)) sentences.push(`মৃত্যু নিবন্ধন নংঃ ${bnDigits(registerNo)}।`);
    } else {
      // CERT-REFINE-02 (R2-15): "The death occurred on … at the
      // deceased's own residence, …" + the mapped cause wording.
      sentences.push(
        `The death occurred${present(dod) ? ` on ${enDateIso(dod)}` : ""}${present(place) ? ` at ${deathPlaceEn(place)}` : ""}.`,
      );
      if (present(reason)) sentences.push(`Cause of death: ${deathCauseEn(reason)}.`);
      if (serviceNo === 31) sentences.push("The person died unmarried.");
      if (present(registerNo)) sentences.push(`Death registration no: ${text(registerNo)}.`);
    }
  } else if (!(bn && serviceNo === 3)) {
    // WS-WORDING: BN service 3 prints the reference intro instead of the
    // death/register sentences (see the intro branch below).
    if (bn) {
      sentences.push(
        `তিনি মৃত্যুবরণ করেছেন${present(dod) ? ` (মৃত্যুর তারিখঃ ${bnDateIso(dod)})` : ""}। তাঁহার ওয়ারিশগণ নিম্নরূপ:`,
      );
      if (present(registerNo)) sentences.push(`নিবন্ধন নংঃ ${bnDigits(registerNo)}।`);
    } else {
      sentences.push(
        `The person has died${present(dod) ? ` (date of death: ${enDateIso(dod)})` : ""}. The legal heirs are as follows:`,
      );
      if (present(registerNo)) sentences.push(`Registration no: ${text(registerNo)}.`);
    }
  }
  if (serviceNo === 31) {
    // CERTNO-01 catalog §31: the applicant is identified with their relation
    // to the deceased (mirrors the HTML template).
    const applicant = bn ? input.citizen.full_name_bn : input.citizen.full_name_en;
    const relation = selectLabel(
      input.schema ?? getServiceSchema(31),
      "dead_info_relation",
      undefined,
      p.dead_info_relation,
      bn,
    );
    sentences.push(
      bn
        ? `আবেদনকারী ${text(applicant)}${present(relation) ? ` মৃতের ${relation}` : ""}।`
        : `The applicant, ${text(applicant)}, is the ${relation || "relative"} of the deceased.`,
    );
  }
  let table: React.ReactNode = null;
  let after: React.ReactNode = null;
  if (serviceNo === 3 || serviceNo === 4) {
    const heirs = Array.isArray(p.heirs) ? (p.heirs as Record<string, unknown>[]) : [];
    const schema = input.schema ?? getServiceSchema(serviceNo);
    if (serviceNo === 3) {
      // WS-TABLES (Prottoyon parity, mirror of the HTML chassis): the
      // 5-column heir table — ক্রমিক নং | নাম | জন্ম তারিখ | বয়স | সম্পর্ক.
      const rows = heirs.map((h, i) => [
        bn ? bnDigits(i + 1) : String(i + 1),
        text(bn ? h.warish_heir_name_bn : h.warish_heir_name),
        bn ? bnDateDash(h.warish_heir_dob) : enDateDash(h.warish_heir_dob),
        tableAge(h, "warish_heir_dob", ctx.issued, bn),
        tableRelation(h, schema, "heirs", "warish_heir_relation", bn),
      ]);
      const headers = bn ? HEIR_TABLE_HEADERS_BN : HEIR_TABLE_HEADERS_EN;
      table = (
        <DataTable
          headers={headers}
          rows={rows}
          flexes={[1.5, 3.7, 1.6, 0.7, 2.7]}
          base={base}
          aligns={HEIR_TABLE_ALIGNS}
          headAligns={HEIR_TABLE_HEAD_ALIGNS}
          compact
        />
      );
    } else {
      // Service 4 keeps the CERT-REFINE-01 §§3–4 column set until its own
      // Prottoyon reference is confirmed.
      // CERT-REFINE-01 §§3–4: spec column order; NID column always present;
      // father's name in the certificate's language; DD/MM/YYYY dates.
      const withMobile = heirs.some((h) => present(h.warish_heir_mobile_no));
      const rows = heirs.map((h, i) => {
        const row = [
          bn ? bnDigits(i + 1) : String(i + 1),
          text(bn ? h.warish_heir_name_bn : h.warish_heir_name),
          text(bn ? h.warish_heir_father_name_bn : h.warish_heir_father_name),
          bn ? bnDateSlash(h.warish_heir_dob) : enDateSlash(h.warish_heir_dob),
          bn ? bnDigits(h.warish_heir_nid) : text(h.warish_heir_nid),
          selectLabel(schema, "heirs", "warish_heir_relation", h.warish_heir_relation, bn),
        ];
        if (withMobile) row.push(bn ? bnDigits(h.warish_heir_mobile_no) : text(h.warish_heir_mobile_no));
        return row;
      });
      const headers = bn
        ? ["ক্রমিক", "ওয়ারিশের নাম", "পিতা/স্বামীর নাম", "জন্ম তারিখ", "জাতীয় পরিচয়পত্র নম্বর", "সম্পর্ক"]
        : ["Sl", "Heir's name", "Father/Husband name", "Date of birth", "NID No", "Relation"];
      if (withMobile) headers.push(bn ? "মোবাইল নম্বর" : "Mobile No");
      const flexes = [0.5, 1.6, 1.3, 0.9, 1.3, 0.9];
      if (withMobile) flexes.push(1);
      table = <DataTable headers={headers} rows={rows} flexes={flexes} base={base} />;
    }
    if (bn && serviceNo === 3) {
      // WS-WORDING: no total line; the reference's own after-table lines,
      // blessing and falsity caveat.
      after = (
        <>
          <Para
            segs={[
              seg(
                "উল্লিখিত ব্যক্তি/ব্যক্তিগণ ছাড়া আর কোনো ওয়ারিশান নাই। সকল প্রকার দেনাপাওনা/সম্পত্তি/বিষয় নিষ্পত্তি করার ব্যাপারে কেবলমাত্র উল্লিখিত ব্যক্তি/ব্যক্তিগণই ওয়ারিশান হিসেবে বিবেচিত হইবে।",
              ),
            ]}
            base={base}
            style={{ ...styles.bodyParaCompact, marginTop: 3 * MM }}
          />
          <Para
            segs={[seg("আমি সকল ওয়ারিশগণের মঙ্গল কামনা করিতেছি।")]}
            base={base}
            style={styles.closingCompact}
          />
          <Para
            segs={[
              seg(
                "বিঃদ্রঃ আবেদনকারী যদি ইচ্ছাকৃতভাবে কোন ওয়ারিশ বাদ দিয়ে থাকেন বা কোন ভুল তথ্য প্রদান করিয়া থাকেন তাহলে তিনি দায়ী থাকিবেন। তাহার জন্য বেলাবো ইউনিয়ন পরিষদ কার্যালয় কোন ভাবেই দায়ী থাকিবেন না এবং উক্ত সনদ বাতিল বলিয়া গণ্য করা হইবে।",
              ),
            ]}
            base={base}
            style={styles.bodyParaCompact}
          />
        </>
      );
    } else {
      const totalLine = bn
        ? `মোট ওয়ারিশ: ${bnDigits(heirs.length)} জন।`
        : `Total heirs: ${heirs.length}.`;
      const closingLine = bn
        ? serviceNo === 4
          ? "উল্লিখিত ব্যক্তিগণই তাঁহার আইনগত উত্তরাধিকারী; তাঁহাদের ছাড়া আর কোনো ওয়ারিশ আছে বলে জানা যায় না।"
          : "উল্লিখিত ব্যক্তিগণ ছাড়া তাঁহার আর কোনো ওয়ারিশ আছে বলে জানা যায় না।"
        : serviceNo === 4
          ? "The persons listed are the legal successors; no other heir is known."
          : "No other heir is known besides the persons listed.";
      const caveat = bn
        ? "উল্লেখ্য যে, উপরোক্ত তথ্য পরবর্তীতে ভুল প্রমাণিত হলে এই সনদ বাতিল বলে গণ্য হবে এবং এ ব্যাপারে কর্তৃপক্ষ দায়ী থাকবে না।"
        : "If the above information is later proved incorrect, this certificate shall be deemed cancelled and the authority shall bear no responsibility.";
      after = (
        <>
          <Para segs={[seg(totalLine)]} base={base} style={{ ...styles.bodyPara, marginTop: 3 * MM }} />
          <Para segs={[seg(closingLine)]} base={base} style={styles.bodyPara} />
          <Para segs={[seg(caveat)]} base={base} style={styles.bodyPara} />
        </>
      );
    }
  }
  // WS-WORDING service 3 (BN): the verbatim reference intro — "মৃত {name},
  // পিতা/স্বামীঃ {father}, মাতাঃ {mother} অত্র এলাকার একজন স্থায়ী
  // বাসিন্দা।" + both addresses + the list ending (see the HTML twin for
  // the মৃত-prefix rule).
  const wIntroParts: Seg[][] = [[seg(deceasedName(name), true)]];
  if (bn && present(father))
    wIntroParts.push([seg("পিতা/স্বামীঃ "), seg(text(father), true)]);
  if (bn && present(mother))
    wIntroParts.push([seg("মাতাঃ "), seg(text(mother), true)]);
  const intro: Seg[] =
    bn && serviceNo === 3
      ? [
          seg(`${WORDING_INTRO_BN} `),
          ...joinSegs(wIntroParts),
          seg(" অত্র এলাকার একজন স্থায়ী বাসিন্দা। "),
          ...wordingAddressSegs(ctx),
          seg(" উল্লিখিত ব্যক্তির ওয়ারিশগণের তালিকা নিম্নরূপঃ"),
        ]
      : bn
        ? [seg("এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, "), ...identity, seg(`, ঠিকানাঃ ${address}।`)]
        : // CERT-REFINE-02 (R2-15): "of address: Village/House:" → "of Village/House:".
          [seg("This is to certify that "), ...identity, seg(`, of ${address}.`)];
  return (
    <>
      <Para
        segs={sentences.length ? [...intro, seg(` ${sentences.join(" ")}`)] : intro}
        base={base}
        style={serviceNo === 3 ? styles.bodyParaCompact : styles.bodyPara}
      />
      {table}
      {after}
    </>
  );
}

/** CERT-REFINE-01 §2: family certificate body (mirror of the HTML chassis). */
function familyBody(ctx: DocContext, base: CertFamily) {
  const { input, bn } = ctx;
  const p = input.payload;
  const members = Array.isArray(p.members) ? (p.members as Record<string, unknown>[]) : [];
  const schema = input.schema ?? getServiceSchema(2);
  const children = members.filter((m) => text(m.relationship) === "child");
  const sons = children.filter((m) => text(m.gender) === "male").length;
  const daughters = children.filter((m) => text(m.gender) === "female").length;
  const genderKnown = children.length > 0 && sons + daughters === children.length;
  const counts = !children.length
    ? ""
    : bn
      ? genderKnown
        ? `তাঁহার ${bnDigits(sons)} জন পুত্র ও ${bnDigits(daughters)} জন কন্যা রয়েছে।`
        : `তাঁহার ${bnDigits(children.length)} জন সন্তান রয়েছে।`
      : genderKnown
        ? `The person has ${sons} son(s) and ${daughters} daughter(s).`
        : `The person has ${children.length} children.`;
  // WS-TABLES (Prottoyon parity, mirror of the HTML chassis): the 5-column
  // member table — ক্রমিক নং | নাম | জন্ম তারিখ | বয়স | সম্পর্ক.
  const rows = members.map((m, i) => [
    bn ? bnDigits(i + 1) : String(i + 1),
    text(bn ? m.name_bn : m.name_en),
    bn ? bnDateDash(m.dob) : enDateDash(m.dob),
    tableAge(m, "dob", ctx.issued, bn),
    tableRelation(m, schema, "members", "relationship", bn),
  ]);
  const headers = bn ? HEIR_TABLE_HEADERS_BN : HEIR_TABLE_HEADERS_EN;
  const tableNode = (
    <DataTable
      headers={headers}
      rows={rows}
      flexes={[1.5, 3.7, 1.6, 0.7, 2.7]}
      base={base}
      aligns={HEIR_TABLE_ALIGNS}
      headAligns={HEIR_TABLE_HEAD_ALIGNS}
      compact
    />
  );
  if (bn) {
    // WS-WORDING: verbatim reference intro + after-table lines. No
    // children-counts line, no same-family line, no total line.
    const introSegs: Seg[] = [
      seg(`${WORDING_INTRO_BN} `),
      ...wordingIdentitySegs(ctx, ["father", "mother"], { fatherLabel: "পিতা/স্বামীঃ" }),
      seg(" অত্র এলাকার একজন স্থায়ী বাসিন্দা। "),
      ...wordingAddressSegs(ctx),
      seg(" উল্লিখিত ব্যক্তির পরিবারের সদস্যগণের তালিকা নিম্নরূপঃ"),
    ];
    return (
      <>
        <Para segs={introSegs} base={base} style={styles.bodyParaCompact} />
        {tableNode}
        <Para
          segs={[
            seg(
              "উল্লিখিত সদস্য/সদস্যগণ ছাড়া আর কোনো সদস্য নাই। আবেদনকারী যদি ইচ্ছাকৃতভাবে কোন সদস্য বাদ দিয়ে থাকেন তাহলে অনুমোদনকারী কোন ভাবেই দায়ী থাকিবেন না এবং উক্ত সনদ বাতিল বলিয়া গণ্য করা হইবে।",
            ),
          ]}
          base={base}
          style={styles.bodyParaCompact}
        />
        <Para
          segs={[seg("আমি সকল সদস্যগণের মঙ্গল কামনা করিতেছি।")]}
          base={base}
          style={styles.closingCompact}
        />
      </>
    );
  }
  // CERT-REFINE-01 (A3): service 2 is on the status-sentence list.
  const status = bn ? STATUS_SENTENCE_BN : STATUS_SENTENCE_EN;
  const introSegs: Seg[] = bn
    ? [
        seg("এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, "),
        ...identitySegs(ctx),
        seg(", তাঁহার "),
        seg("স্থায়ী ঠিকানাঃ"),
        seg(` ${permanentAddress(ctx)}। ${status}`),
        ...(counts ? [seg(` ${counts}`)] : []),
      ]
    : [
        seg("This is to certify that "),
        ...identitySegs(ctx),
        seg(", "),
        seg("permanent address:"),
        seg(` ${permanentAddress(ctx)}. ${status}`),
        ...(counts ? [seg(` ${counts}`)] : []),
      ];
  const closing = bn
    ? "আমি উক্ত পরিবারের সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
    : "I wish the family every prosperity.";
  // The base same-family attestation is retained (cholito register).
  const familyLine = bn
    ? "এই সনদে উল্লিখিত ব্যক্তিগণ একই পরিবারের সদস্য বলে প্রত্যয়ন করা যাচ্ছে।"
    : "The persons listed in this certificate are members of the same family.";
  return (
    <>
      <Para segs={introSegs} base={base} style={styles.bodyParaCompact} />
      {tableNode}
      <Para segs={[seg(familyLine)]} base={base} style={styles.bodyParaCompact} />
      <Para segs={[seg(closing)]} base={base} style={styles.closingCompact} />
    </>
  );
}

/** CERT-REFINE-01 §19: consent certificate body (mirror). */
function consentBody(ctx: DocContext, base: CertFamily) {
  const { input, bn } = ctx;
  const p = input.payload;
  const schema = input.schema ?? getServiceSchema(19);
  if (bn) {
    // WS-WORDING (D9): the Prottoyon model — the applicant IS the child
    // (the citizen record), and the guardian consents. Single paragraph;
    // no child-detail grid, no first-person clause. The guardian signature
    // block renders bottom-left in the anchored signature zone
    // (CertificateDocument), not here. {guardian_purpose} maps from the
    // schema's consent subject (GAP-19-PURPOSE); the guardian name has no
    // schema field (GAP-19-GUARDIAN-NAME).
    const guardianName = consentGuardianName(p, true);
    const purpose = consentGuardianPurpose(p, schema, true);
    const segs: Seg[] = [
      seg(`${WORDING_INTRO_BN} `),
      ...wordingIdentitySegs(ctx, ["father", "mother"]),
      seg(", "),
      ...wordingAddressSegs(ctx),
      seg(
        ` তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা। তাহার অভিভাবক${guardianName ? ` ${guardianName}` : ""} স্বজ্ঞানে/স্বেচ্ছায় তাহাকে${purpose ? ` ${purpose}` : ""} অনুমতি/সম্মতি প্রদান করিল। এ বিষয়ে তাহার অভিভাবক ও তার পরিবারের কারও কোনো আপত্তি নেই।`,
      ),
    ];
    return (
      <>
        <Para segs={segs} base={base} style={styles.bodyPara} />
        <Para segs={[seg(WORDING_BLESSING_BN)]} base={base} style={styles.closing} />
      </>
    );
  }
  const guardianSegs: Seg[] = bn
    ? [
        seg("অভিভাবকঃ "),
        ...identitySegs(ctx),
        seg(", তাঁহার "),
        seg("স্থায়ী ঠিকানাঃ"),
        seg(` ${permanentAddress(ctx)}।`),
      ]
    : [
        seg("Guardian: "),
        ...identitySegs(ctx),
        seg(", "),
        seg("permanent address:"),
        seg(` ${permanentAddress(ctx)}.`),
      ];
  const childName = text(bn ? p.consent_child_name_bn : p.consent_child_name_en);
  const relation = selectLabel(schema, "consent_child_relation", undefined, p.consent_child_relation, bn);
  const subject = selectLabel(schema, "consent_subject", undefined, p.consent_subject, bn);
  // CERT-REFINE-01 §19: the child block prints as labelled lines.
  const childLines: [string, string][] = bn
    ? [
        ["সন্তানের নাম:", childName],
        ["জন্ম তারিখ:", present(p.consent_child_dob) ? bnDateIso(p.consent_child_dob) : ""],
        ["জন্ম নিবন্ধন নম্বর:", present(p.consent_child_birth_reg) ? bnDigits(p.consent_child_birth_reg) : ""],
        ["সম্পর্ক:", relation],
      ]
    : [
        ["Child's name:", childName],
        ["Date of birth:", present(p.consent_child_dob) ? enDateIso(p.consent_child_dob) : ""],
        ["Birth registration no:", present(p.consent_child_birth_reg) ? text(p.consent_child_birth_reg) : ""],
        ["Relationship:", relation],
      ];
  const guardianName = text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en);
  const clauseSegs: Seg[] = bn
    ? [
        seg(`আমি ${guardianName}, আমার `),
        ...(relation ? [seg(`${relation} `)] : []),
        seg(childName, true),
        seg(` এর ${subject} বিষয়ে সম্মতি প্রদান করিলাম।`),
      ]
    : [
        seg(`I, ${guardianName}, give my consent for my `),
        ...(relation ? [seg(`${relation} `)] : []),
        seg(childName, true),
        seg(` in respect of ${subject}.`),
      ];
  return (
    <>
      <Para segs={guardianSegs} base={base} style={styles.bodyPara} />
      {/* CERT-REFINE-02 (R2-18): the child block takes the standard
          label-value grid — label column 132 pt regular, value bold,
          4 pt row padding — instead of loose lines. */}
      <View style={{ marginVertical: 4 }}>
        {childLines
          .filter(([, v]) => present(v))
          .map(([l, v], i) => (
            <View key={i} style={{ flexDirection: "row", paddingVertical: 4 }}>
              <Text style={{ width: 132, fontSize: 12.5, lineHeight: 1.68 }}>
                <Runs segs={[seg(l)]} base={base} />
              </Text>
              <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 1.68 }}>
                <Runs segs={[seg(v)]} base={base} bold />
              </Text>
            </View>
          ))}
      </View>
      <Para segs={clauseSegs} base={base} style={styles.bodyPara} />
      {/* The guardian signature block renders in the anchored signature
          zone (CertificateDocument) on the chairman's baseline (R2-02). */}
    </>
  );
}

/** CERT-REFINE-01 §§25–26: marriage certificate body (mirror). */
function marriageBody(ctx: DocContext, serviceNo: number, base: CertFamily) {
  const { input, bn } = ctx;
  const p = input.payload;
  const c = input.citizen;
  if (bn && serviceNo === 25) {
    // WS-WORDING (D10): single-paragraph married attestation — no
    // groom/bride blocks. Spouse NID/DOB/marriage date inline, dates
    // DD-MM-YYYY in Bengali digits with hyphens. The pronoun switch
    // (তিনি … সে বিবাহিত। তিনি …) is verbatim. The closing sentence
    // prints only when a marriage date is recorded.
    const spouseName = text(c.spouse_name_bn) || text(p.marriage_info_spouse_name_bn);
    const spouseNid = text(p.marriage_info_spouse_nid);
    const spouseDob = present(p.marriage_info_spouse_dob)
      ? bnDateDash(p.marriage_info_spouse_dob)
      : "";
    const marriageDate = present(p.marriage_info_date)
      ? bnDateDash(p.marriage_info_date)
      : "";
    const segs: Seg[] = [
      seg(`${WORDING_INTRO_BN} `),
      ...wordingIdentitySegs(ctx, ["spouse", "father", "mother"], { spouseName }),
      seg(", "),
      ...wordingAddressSegs(ctx),
      seg(" তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা। আমার জানা মতে, বর্তমানে সে বিবাহিত।"),
      ...(marriageDate
        ? [
            seg(
              ` তিনি ${spouseName}` +
                `${spouseNid ? `, জাতীয় পরিচয়পত্র নম্বরঃ ${bnDigits(spouseNid)}` : ""}` +
                `${spouseDob ? `, জন্ম তারিখঃ ${spouseDob}` : ""} এর সাথে, ${marriageDate} তারিখে বিবাহ বন্ধনে আবদ্ধ হন।`,
            ),
          ]
        : []),
    ];
    return (
      <>
        <Para segs={segs} base={base} style={styles.bodyPara} />
        <Para segs={[seg(WORDING_BLESSING_BN)]} base={base} style={styles.closing} />
      </>
    );
  }
  // CERT-REFINE-02 (R2-17): each party box gets a heading band
  // (11 pt bold on #F2F2F2); inside, the label column is fixed at
  // 118 pt (10.5 pt) with 11.5 pt bold values; the boxes sit 10 pt
  // apart. Fit deviation from the plan's padding targets (band 3,
  // box 5, rows 1.5, leading 1.22): at the plan's 5/8/4 paddings the
  // two boxes + closing exceed the anchored body reserve and spill
  // onto a second page — R2-01's one-page rule outranks the padding
  // targets. The band, 118 pt column, type sizes, 10 pt box gap and
  // the 12 pt closing with bold date are all as specified.
  const block = (title: string, lines: [string, string][]) => (
    <View
      style={{
        borderWidth: 0.75,
        borderColor: "#555",
        marginVertical: 5,
      }}
    >
      <View style={{ backgroundColor: "#F2F2F2", paddingVertical: 3, paddingHorizontal: 8 }}>
        <Text style={{ fontWeight: 700, fontSize: 11, lineHeight: 1.25 }}>
          <Runs segs={[seg(title)]} base={base} bold />
        </Text>
      </View>
      <View style={{ padding: 5 }}>
        {lines
          .filter(([, v]) => present(v))
          .map(([l, v], i) => (
            <View key={i} style={{ flexDirection: "row", paddingVertical: 1.5 }}>
              <Text style={{ width: 118, fontSize: 10.5, lineHeight: 1.22 }}>
                <Runs segs={[seg(l)]} base={base} />
              </Text>
              <Text style={{ flex: 1, fontSize: 11.5, lineHeight: 1.22 }}>
                <Runs segs={[seg(v)]} base={base} bold />
              </Text>
            </View>
          ))}
      </View>
    </View>
  );
  const citizenLines: [string, string][] = bn
    ? [
        ["নামঃ", text(c.full_name_bn)],
        ["পিতাঃ", text(c.father_name_bn)],
        ["মাতাঃ", text(c.mother_name_bn)],
        ["ঠিকানাঃ", permanentAddress(ctx)],
        ["জন্ম তারিখঃ", present(c.date_of_birth) ? bnDateIso(c.date_of_birth) : ""],
        ["জাতীয় পরিচয়পত্র নম্বরঃ", bnDigits(input.identity?.nid ?? "")],
      ]
    : [
        ["Name:", text(c.full_name_en)],
        ["Father:", text(c.father_name_en)],
        ["Mother:", text(c.mother_name_en)],
        ["Address:", permanentAddress(ctx)],
        ["Date of birth:", present(c.date_of_birth) ? enDateIso(c.date_of_birth) : ""],
        ["National ID No:", text(input.identity?.nid ?? "")],
      ];
  const spouseLines: [string, string][] = bn
    ? [
        ["নামঃ", text(p.marriage_info_spouse_name_bn)],
        ["পিতাঃ", text(p.marriage_info_spouse_father_name_bn)],
        ["মাতাঃ", text(p.marriage_info_spouse_mother_name_bn)],
        ["ঠিকানাঃ", text(p.marriage_info_spouse_address_bn)],
        ["জন্ম তারিখঃ", present(p.marriage_info_spouse_dob) ? bnDateIso(p.marriage_info_spouse_dob) : ""],
        ["জাতীয় পরিচয়পত্র নম্বরঃ", bnDigits(p.marriage_info_spouse_nid ?? "")],
      ]
    : [
        ["Name:", text(p.marriage_info_spouse_name)],
        ["Father:", text(p.marriage_info_spouse_father_name_en)],
        ["Mother:", text(p.marriage_info_spouse_mother_name_en)],
        ["Address:", text(p.marriage_info_spouse_address_en)],
        ["Date of birth:", present(p.marriage_info_spouse_dob) ? enDateIso(p.marriage_info_spouse_dob) : ""],
        ["National ID No:", text(p.marriage_info_spouse_nid ?? "")],
      ];
  const citizenIsGroom = c.gender !== "female";
  const groom = citizenIsGroom ? citizenLines : spouseLines;
  const bride = citizenIsGroom ? spouseLines : citizenLines;
  // CERT-REFINE-02 (R2-17): the closing lines form ONE standalone 12 pt
  // paragraph 10 pt below the second box, the marriage date bold; the
  // dowry sentence (svc26) joins the same paragraph.
  const closingSegs: Seg[] = bn
    ? [
        seg("বিবাহের তারিখঃ "),
        seg(present(p.marriage_info_date) ? bnDateIso(p.marriage_info_date) : "", true),
        ...(present(p.marriage_info_spouse_place_bn)
          ? [seg(`, বিবাহের স্থানঃ ${text(p.marriage_info_spouse_place_bn)}`)]
          : []),
        seg("।"),
        ...(serviceNo === 26 ? [seg(" উক্ত বিবাহ যৌতুক বিহীনভাবে সম্পন্ন হয়েছে।")] : []),
      ]
    : [
        seg("Date of marriage: "),
        seg(present(p.marriage_info_date) ? enDateIso(p.marriage_info_date) : "", true),
        ...(present(p.marriage_info_spouse_place)
          ? [seg(`, Place of marriage: ${text(p.marriage_info_spouse_place)}`)]
          : []),
        seg("."),
        ...(serviceNo === 26 ? [seg(" The said marriage was completed without dowry.")] : []),
      ];
  return (
    <>
      <Para
        segs={[seg(bn ? "এই মর্মে প্রত্যয়ন করা যাচ্ছে যে," : "This is to certify that")]}
        base={base}
        style={styles.bodyPara}
      />
      {block(bn ? "বর" : "Groom", groom)}
      {block(bn ? "কনে" : "Bride", bride)}
      <Para
        segs={closingSegs}
        base={base}
        style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5, textAlign: "justify" }}
      />
    </>
  );
}

/** CERT-REFINE-01 §39: same-person declaration body (mirror). */
function samePersonBody(ctx: DocContext, base: CertFamily) {
  const { input, bn } = ctx;
  const p = input.payload;
  const name = text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en);
  const v1 = text(bn ? p.spi_name_bn : p.spi_name_en);
  const v2 = text(bn ? p.spi_name_2_bn : p.spi_name_2_en);
  const introSegs: Seg[] = bn
    ? [
        seg("এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, "),
        ...identitySegs(ctx),
        seg(", তাঁহার "),
        seg("স্থায়ী ঠিকানাঃ"),
        seg(` ${permanentAddress(ctx)}।`),
      ]
    : [
        seg("This is to certify that "),
        ...identitySegs(ctx),
        seg(", "),
        seg("permanent address:"),
        seg(` ${permanentAddress(ctx)}.`),
      ];
  // CERT-REFINE-01 §39: the spec's declaration construction.
  const clauseSegs: Seg[] =
    present(v2) && v2 !== name
      ? bn
        ? [
            seg("আবেদনকারীর সঠিক নাম: "),
            seg(name, true),
            seg(`। বিভিন্ন নথিতে তাঁহার নাম ${v1} এবং ${v2} হিসেবে উল্লেখিত হয়েছে। উল্লিখিত সকল নাম একই ব্যক্তির।`),
          ]
        : [
            seg("The applicant's correct name is "),
            seg(name, true),
            seg(`. The names ${v1} and ${v2} appearing in various documents all belong to one and the same person.`),
          ]
      : bn
        ? [
            seg("আবেদনকারীর সঠিক নাম: "),
            seg(name, true),
            seg(`। বিভিন্ন নথিতে তাঁহার নাম ${v1} হিসেবে উল্লেখিত হয়েছে। উল্লিখিত সকল নাম একই ব্যক্তির।`),
          ]
        : [
            seg("The applicant's correct name is "),
            seg(name, true),
            seg(`. The name ${v1} appearing in various documents belongs to one and the same person.`),
          ];
  return (
    <>
      <Para segs={introSegs} base={base} style={styles.bodyPara} />
      <Para segs={clauseSegs} base={base} style={styles.bodyPara} />
    </>
  );
}

/** Spouse sentence for services 15 and 34 (mirror of the HTML chassis). */
function spouseSentenceText(ctx: DocContext): string {
  const { input, bn } = ctx;
  const c = input.citizen;
  if (bn) {
    if (!present(c.spouse_name_bn)) return "";
    return c.gender === "male"
      ? `তাঁহার স্ত্রীর নাম ${text(c.spouse_name_bn)}।`
      : `তাঁহার স্বামীর নাম ${text(c.spouse_name_bn)}।`;
  }
  if (!present(c.spouse_name_en)) return "";
  return `The person's spouse is ${text(c.spouse_name_en)}.`;
}

// CERT-REFINE-02 (R2-12): the well-wish sentence is not boilerplate — it
// prints ONLY on these services; everywhere else the certificate ends
// with its attestation.
// WS-WORDING: the blessing service set lives in certificate-template-v7.ts
// (WORDING_BLESSING_SERVICES — [12, 15, 19, 21, 22, 25, 27, 33, 35, 37, 45],
// corrected তাহার spelling); the local set is retired so the two engines
// cannot drift apart again.

function paragraphBody(ctx: DocContext, serviceNo: number, base: CertFamily) {
  const { input, bn } = ctx;
  const p = input.payload;
  if (serviceNo === 3 || serviceNo === 4 || serviceNo === 7 || serviceNo === 31)
    return deceasedBody(ctx, serviceNo, base);
  if (serviceNo === 2) return familyBody(ctx, base);
  if (serviceNo === 19) return consentBody(ctx, base);
  if (serviceNo === 25 || serviceNo === 26) return marriageBody(ctx, serviceNo, base);
  if (serviceNo === 39) return samePersonBody(ctx, base);
  if (serviceNo === 47) {
    const body = text(bn ? p.certificate_details_bn : p.certificate_details_en);
    const footer = text(bn ? p.certificate_footer_bn : p.certificate_footer_en);
    // CERT-REFINE-01 §47: the A2 identity paragraph prints above the narrative.
    const introSegs: Seg[] = bn
      ? [
          seg("এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, "),
          ...identitySegs(ctx),
          seg(", তাঁহার "),
          seg("স্থায়ী ঠিকানাঃ"),
          seg(` ${permanentAddress(ctx)}।`),
        ]
      : [
          seg("This is to certify that "),
          ...identitySegs(ctx),
          seg(", "),
          seg("permanent address:"),
          seg(` ${permanentAddress(ctx)}.`),
        ];
    return (
      <>
        <Para segs={introSegs} base={base} style={styles.bodyPara} />
        <Para segs={[seg(body)]} base={base} style={styles.bodyPara} />
        {footer ? <Para segs={[seg(footer)]} base={base} style={styles.freeFooter} /> : null}
      </>
    );
  }
  if (serviceNo === 27) {
    // CERTNO-01 (owner decision D5): the passport recommendation LETTER —
    // keeps both addresses per the owner-approved letter format;
    // CERT-REFINE-01 register fixes apply.
    // CERT-REFINE-02 (R2-16): the purpose localises by value (free-text
    // field; standard purposes map, others print as stored).
    const purpose = passportPurposeLabel(p.passport_purpose, bn);
    const closing = bn ? WORDING_BLESSING_BN : WORDING_BLESSING_EN;
    const letterSegs: Seg[] = bn
      ? [
          seg("এই মর্মে সুপারিশ করা যাচ্ছে যে, "),
          ...identitySegs(ctx),
          seg(", তাঁহার "),
          seg("স্থায়ী ঠিকানাঃ"),
          seg(` ${permanentAddress(ctx)}। `),
          seg("বর্তমান ঠিকানাঃ"),
          seg(` ${presentAddress(ctx)}। তিনি পাসপোর্টের জন্য আবেদন করেছেন${purpose ? ` (উদ্দেশ্যঃ ${purpose})` : ""}। তাঁহার বিরুদ্ধে কোনো ফৌজদারি অভিযোগ জানা নাই। তাঁহাকে পাসপোর্ট প্রদানে এই কার্যালয়ের কোনো আপত্তি নাই।`),
        ]
      : [
          seg("This is to recommend that "),
          ...identitySegs(ctx),
          seg(", "),
          seg("permanent address:"),
          seg(` ${permanentAddress(ctx)}. `),
          seg("Present address:"),
          seg(` ${presentAddress(ctx)}. The person has applied for a passport${purpose ? ` (purpose: ${purpose})` : ""}. No criminal complaint is known against the person. This office has no objection to a passport being issued to the person.`),
        ];
    return (
      <>
        {/* CERT-REFINE-02 (R2-18): addressee lines at 12 pt with 4 pt
            spacing; the subject line stays bold; the body keeps the
            global body type. */}
        <Para
          segs={[seg(bn ? "বরাবর,\nসহকারী পরিচালক,\nআঞ্চলিক পাসপোর্ট অফিস।" : "To,\nThe Assistant Director,\nRegional Passport Office.")]}
          base={base}
          style={{ fontSize: 12, lineHeight: 1.33, textAlign: "justify" }}
        />
        <Para
          segs={[seg(bn ? "বিষয়ঃ পাসপোর্ট প্রদানের সুপারিশ।" : "Subject: Recommendation for passport issuance.", true)]}
          base={base}
          style={styles.bodyPara}
        />
        <Para segs={letterSegs} base={base} style={styles.bodyPara} />
        <Para segs={[seg(closing)]} base={base} style={styles.closing} />
      </>
    );
  }
  const attestation = runAttestation(
    bn ? ATTESTATIONS_BN[serviceNo] : ATTESTATIONS_EN[serviceNo],
    p,
    { gender: input.citizen.gender },
  );
  // CERT-REFINE-01 (A3 + §§9/15/34): sentences that follow the identity block.
  const extras = [
    STATUS_SENTENCE_SERVICES.has(serviceNo)
      ? bn
        ? STATUS_SENTENCE_BN
        : STATUS_SENTENCE_EN
      : "",
    serviceNo === 15 || serviceNo === 34 ? spouseSentenceText(ctx) : "",
    serviceNo === 9 && present(input.identity?.nid)
      ? bn
        ? `জাতীয় পরিচয়পত্র/ভোটার নম্বর: ${bnDigits(input.identity?.nid)}।`
        : `National ID/Voter No: ${text(input.identity?.nid)}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const paraSegs: Seg[] = bn
    ? [
        seg("এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, "),
        ...identitySegs(ctx),
        seg(", তাঁহার "),
        seg("স্থায়ী ঠিকানাঃ"),
        seg(` ${permanentAddress(ctx)}।`),
        ...(extras ? [seg(` ${extras}`)] : []),
        ...(attestation ? [seg(` ${attestation}`)] : []),
      ]
    : [
        seg("This is to certify that "),
        ...identitySegs(ctx),
        seg(", "),
        seg("permanent address:"),
        seg(` ${permanentAddress(ctx)}.`),
        ...(extras ? [seg(` ${extras}`)] : []),
        ...(attestation ? [seg(` ${attestation}`)] : []),
      ];
  // CERT-REFINE-01 §20: the service narrative prints as its own paragraph,
  // under the spec's label.
  const narrative =
    serviceNo === 20
      ? text(bn ? p.freedom_fighter_service_narrative_bn : p.freedom_fighter_service_narrative_en)
      : "";
  const narrativeLabel = bn
    ? "মুক্তিযুদ্ধে অংশগ্রহণের বিবরণ:"
    : "Details of participation in the Liberation War:";
  // WS-WORDING: the standard blessing (corrected তাহার spelling, no
  // chandrabindu) prints on [12, 15, 19, 21, 22, 25, 27, 33, 35, 37, 45] —
  // 19/25/33/35/37 were missing it. Computed up front: the BN wording
  // branch below and the 37 branch both append it.
  const closing = WORDING_BLESSING_SERVICES.has(serviceNo)
    ? bn
      ? WORDING_BLESSING_BN
      : WORDING_BLESSING_EN
    : "";
  if (bn && [12, 15, 22, 33, 35, 37].includes(serviceNo)) {
    // WS-WORDING: verbatim Prottoyon bodies. Services 19/25 branch inside
    // consentBody/marriageBody and 2/3 inside familyBody/deceasedBody;
    // English keeps the generic chassis below.
    return (
      <>
        {wordingBody(ctx, serviceNo, base)}
        {closing ? <Para segs={[seg(closing)]} base={base} style={styles.closing} /> : null}
      </>
    );
  }
  if (serviceNo === 33) {
    // English path only — Bangla returns early through wordingBody above
    // (3-column table, no serial column, reference headers).
    const corrections = Array.isArray(p.corrections)
      ? (p.corrections as Record<string, unknown>[])
      : [];
    const schema = input.schema ?? getServiceSchema(33);
    // WS-WORDING: the fixed label map is authoritative (correctionFieldLabel),
    // so English-name rows never print raw ids (name_en, father_name_en).
    const rows = corrections.map((c, i) => {
      const fieldLabel = correctionFieldLabel(c.correction_category_id, schema, bn);
      return [
        bn ? bnDigits(i + 1) : String(i + 1),
        fieldLabel,
        text(c.incorrect_info),
        text(c.correct_info),
      ];
    });
    const intro = bn
      ? "তাঁহার জাতীয় পরিচয় তথ্যে নিম্নোক্ত সংশোধন প্রয়োজন বলে প্রত্যয়ন করা যাচ্ছে:"
      : "The following corrections to the national identity information are required:";
    return (
      <>
        <Para segs={paraSegs} base={base} style={styles.bodyPara} />
        <Para segs={[seg(intro)]} base={base} style={styles.bodyPara} />
        <DataTable
          headers={
            bn
              ? ["ক্রমিক", "তথ্যের ধরণ", "ভুল তথ্য", "সঠিক তথ্য"]
              : ["Sl", "Field", "Incorrect information", "Correct information"]
          }
          rows={rows}
          flexes={[0.5, 1, 1.4, 1.4]}
          base={base}
        />
      </>
    );
  }
  if (serviceNo === 37) {
    // CERT-REFINE-01 §37: the fields line under the recommendation clause.
    // English path only — Bangla returns early through wordingBody above
    // (no previous-area / residing-since / NID line on the reference).
    const fields = bn
      ? `পূর্বের ভোটার এলাকাঃ ${text(p.previous_voter_area)}${present(p.voter_transfer_residing_since) ? `, অত্র এলাকায় বসবাসের শুরু: ${bnDateIso(p.voter_transfer_residing_since)}` : ""}${present(input.identity?.nid) ? `, জাতীয় পরিচয়পত্র নম্বরঃ ${bnDigits(input.identity?.nid)}` : ""}।`
      : `Previous voter area: ${text(p.previous_voter_area_en ?? p.previous_voter_area)}${present(p.voter_transfer_residing_since) ? `, residing at the present address since: ${enDateIso(p.voter_transfer_residing_since)}` : ""}${present(input.identity?.nid) ? `, National ID No: ${text(input.identity?.nid)}` : ""}.`;
    return (
      <>
        <Para segs={paraSegs} base={base} style={styles.bodyPara} />
        <Para segs={[seg(fields)]} base={base} style={styles.bodyPara} />
        {closing ? <Para segs={[seg(closing)]} base={base} style={styles.closing} /> : null}
      </>
    );
  }
  return (
    <>
      <Para segs={paraSegs} base={base} style={styles.bodyPara} />
      {narrative ? <Para segs={[seg(`${narrativeLabel} ${narrative}`)]} base={base} style={styles.bodyPara} /> : null}
      {closing ? <Para segs={[seg(closing)]} base={base} style={styles.closing} /> : null}
    </>
  );
}

/* ---------- generic numbered-form layout (FORM services 1, 41, 46) ---------- */

const gfStyles = StyleSheet.create({
  wrap: { fontSize: px(12.8), lineHeight: 1.55, marginTop: 3 * MM },
  sectionTitle: { fontSize: px(13), fontWeight: 700, marginTop: 3 * MM, marginBottom: 1 * MM },
  field: { flexDirection: "row" },
  fieldLabel: { width: 58 * MM, fontWeight: 700 },
  fieldValue: { flex: 1 },
  total: { fontWeight: 700, marginTop: 2 * MM },
  repeatRow: {
    borderTopWidth: 0.5,
    borderTopColor: "#999",
    borderTopStyle: "dotted",
    paddingVertical: 1 * MM,
  },
});

interface GField {
  label: string;
  value: string;
}
interface GGroup {
  label: string;
  rows: GField[][];
}

function renderGFields(
  ctx: DocContext,
  fields: readonly FieldDefinition[],
  values: Record<string, unknown>,
  prefix = "",
): (GField | GGroup)[] {
  const { input, bn } = ctx;
  return fields
    .filter(
      (f) =>
        isFieldVisible(f, values) &&
        values[f.id] !== undefined &&
        !["delivery_language", "confirmation", "supporting_documents", "attachments"].includes(f.id) &&
        !(bn && (f.id.endsWith("_en") || /\(English\)$/i.test(f.label.en))) &&
        !(!bn && (f.id.endsWith("_bn") || /\(Bangla\)$/i.test(f.label.bn))),
    )
    .map((f) => {
      const value = values[f.id];
      const label = f.label[bn ? "bn" : "en"];
      if (f.type === "repeatable")
        return {
          label,
          rows: (value as Record<string, unknown>[]).map(
            (row) =>
              renderGFields(ctx, f.children ?? [], row, `${prefix}${f.id}.`).filter(
                (x): x is GField => "value" in x,
              ),
          ),
        } as GGroup;
      let out: unknown = value;
      if (f.type === "geography")
        out = input.geographyNames?.[`${prefix}${f.id}`]?.[bn ? "bn" : "en"] ?? "";
      else if (f.type === "checkbox") out = bn ? (value ? "হ্যাঁ" : "না") : value ? "Yes" : "No";
      else if (f.type === "select")
        out = f.options?.find((o) => o.value === value)?.label[bn ? "bn" : "en"] ?? value;
      else if (bn && (f.type === "date" || f.type === "number")) out = bnDigits(value);
      return { label, value: String(out ?? "") } as GField;
    });
}

function GFieldRow({ field, base }: { field: GField; base: CertFamily }) {
  return (
    <View style={gfStyles.field}>
      <Text style={gfStyles.fieldLabel}>
        <Runs segs={[seg(field.label)]} base={base} bold />
      </Text>
      <Text style={gfStyles.fieldValue}>
        <Runs segs={[seg(`: ${field.value}`)]} base={base} />
      </Text>
    </View>
  );
}

function genericFormBody(ctx: DocContext, base: CertFamily) {
  const { input, bn } = ctx;
  const schema: FormSchema = input.schema ?? getServiceSchema(input.service.service_no!);
  const sections = schema.sections
    .map((section) => ({
      title: section.title[bn ? "bn" : "en"],
      items: renderGFields(ctx, section.fields, input.payload),
    }))
    .filter((s) => s.items.length > 0);
  return (
    <View style={gfStyles.wrap}>
      {sections.map((section, si) => (
        <View key={si}>
          <Text style={gfStyles.sectionTitle}>
            <Runs segs={[seg(section.title)]} base={base} bold />
          </Text>
          {section.items.map((item, ii) =>
            "rows" in item ? (
              <View key={ii}>
                <Text style={gfStyles.sectionTitle}>
                  <Runs segs={[seg(item.label)]} base={base} bold />
                </Text>
                {item.rows.map((row, ri) => (
                  <View key={ri} style={gfStyles.repeatRow}>
                    {row.map((f, fi) => (
                      <GFieldRow key={fi} field={f} base={base} />
                    ))}
                  </View>
                ))}
              </View>
            ) : (
              <GFieldRow key={ii} field={item} base={base} />
            ),
          )}
        </View>
      ))}
      {input.order ? (
        <View style={[gfStyles.field, gfStyles.total]}>
          <Text style={gfStyles.fieldLabel}>
            <Runs segs={[seg(bn ? "সর্বমোট ফি" : "Total fee")]} base={base} bold />
          </Text>
          <Text style={gfStyles.fieldValue}>
            <Runs
              segs={[seg(`: ${bn ? bnDigits(money(input.order.totalMinor)) : money(input.order.totalMinor)}`)]}
              base={base}
              bold
            />
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ---------- CERTNO-01 form layouts: receipt (1), premises licence (41), transport card (46) ---------- */

/**
 * CERT-REFINE-02 (R2-08): ONE number/date row for the whole family. The
 * row spans the full content width ABOVE the body/photo row (it used to
 * live inside the narrowed text column, which forced the date to wrap
 * under the number). Label 11 pt bold + the plain number, date 11 pt bold
 * on the same baseline at the right edge. The hyphens in the old "নং:-"
 * labels are deleted (R2-16).
 */
function NumLine({
  ctx,
  base,
  numberLabel,
  dateLabel,
  marginTop = 35,
  ordinalDate = false,
}: {
  ctx: DocContext;
  base: CertFamily;
  numberLabel: string;
  /** null → no date on the row (the trade licence renders its own
   * issue-details row — TradeIssueRow — instead of this component). */
  dateLabel: string | null;
  marginTop?: number;
  /** WS-SHELL-GAPS: true only for the certificate numline — the issue date
   * prints with the reference ordinal suffix (২২শে / 22nd). Form/receipt
   * meta lines (FormMetaLine) keep the suffix-free bnDate/enDate. */
  ordinalDate?: boolean;
}) {
  const { bn, issued } = ctx;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop }}>
      <Text style={{ marginRight: 8, fontSize: 11, fontWeight: 700 }}>
        <Runs segs={[seg(numberLabel)]} base={base} bold />
      </Text>
      <NumberDisplay number={ctx.input.number} bn={bn} base={base} />
      {dateLabel ? (
        <Text style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>
          <Runs
            segs={[seg(`${dateLabel} ${ordinalDate ? ordDate(issued, bn) : bn ? bnDate(issued) : enDate(issued)}`)]}
            base={base}
            bold
          />
        </Text>
      ) : null}
    </View>
  );
}

function FormMetaLine({ ctx, base }: { ctx: DocContext; base: CertFamily }) {
  const { bn } = ctx;
  const serviceNo = Number(ctx.input.service?.service_no ?? 0);
  // CERT-REFINE-02 (R2-08): svc01 "রসিদ নং:", svc41 "লাইসেন্স নং:".
  const label =
    serviceNo === 1
      ? bn
        ? "রসিদ নং:"
        : "Receipt No:"
      : bn
        ? "লাইসেন্স নং:"
        : "Licence No:";
  return (
    <NumLine
      ctx={ctx}
      base={base}
      numberLabel={label}
      dateLabel={bn ? "তারিখ:" : "Date:"}
    />
  );
}

/**
 * CERT-REFINE-02 (R2-05): service 46's number row is a plain field line —
 * "লাইসেন্স নং / Licence No: TL-…" — the licence number printed EXACTLY
 * as stored (no digit conversion inside identifiers, R2-16).
 */
function LicenceNoLine({ ctx, base }: { ctx: DocContext; base: CertFamily }) {
  const { input, bn } = ctx;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 22 }}>
      <Text style={{ marginRight: 8, fontSize: 11, fontWeight: 700 }}>
        <Runs segs={[seg(bn ? "লাইসেন্স নং:" : "Licence No:")]} base={base} bold />
      </Text>
      <Text style={{ fontSize: 11, fontWeight: 700 }}>
        <Runs segs={[seg(text(input.payload.transport_license_no))]} base={base} bold />
      </Text>
    </View>
  );
}

function taxReceiptBody(ctx: DocContext, base: CertFamily) {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const c = input.citizen;
  const totalTaka = input.order ? Number(input.order.totalMinor) / 100 : null;
  const totalFig = totalTaka !== null ? totalTaka.toLocaleString("en-IN") : "";
  const totalWords =
    totalTaka !== null ? (bn ? amountInWordsBn(totalTaka) : amountInWordsEn(totalTaka)) : "";
  // CERT-REFINE-01 §1: the full receipt field set (mirror of the HTML twin).
  const taxYearRaw = text(p.tax_year);
  const yearLabel = /^\d{4}$/.test(taxYearRaw)
    ? `${taxYearRaw}-${Number(taxYearRaw) + 1}`
    : taxYearRaw;
  const ward = input.citizenGeography?.permanent?.wardNo ?? "";
  const property = bn
    ? text(p.property_description_bn ?? p.property_description)
    : text(p.property_description_en ?? p.property_description);
  const fields: GField[] = [
    { label: bn ? "রসিদ নং" : "Receipt No", value: bn ? bnDigits(input.number) : latinDigits(input.number) },
    { label: bn ? "তারিখ" : "Date", value: bn ? bnDate(issued) : enDate(issued) },
    { label: bn ? "করদাতার নাম" : "Taxpayer", value: text(bn ? c.full_name_bn : c.full_name_en) },
    { label: bn ? "পিতা/স্বামীর নাম" : "Father/Husband name", value: text(bn ? c.father_name_bn : c.father_name_en) },
    { label: bn ? "মাতা" : "Mother", value: text(bn ? c.mother_name_bn : c.mother_name_en) },
    { label: bn ? "গ্রাম" : "Village", value: text(bn ? c.address_bn : c.address_en) },
    { label: bn ? "ওয়ার্ড নং" : "Ward No", value: bn ? bnDigits(ward) : text(ward) },
    { label: bn ? "হোল্ডিং নম্বর" : "Holding No", value: bn ? bnDigits(p.holding_reference) : text(p.holding_reference) },
    { label: bn ? "অর্থবছর" : "Fiscal year", value: bn ? bnDigits(yearLabel) : yearLabel },
    { label: bn ? "সম্পত্তির বিবরণ" : "Property description", value: property },
  ].filter((f) => present(f.value));
  const rows = [
    [
      bn ? bnDigits(yearLabel) : yearLabel,
      bn ? bnDigits(totalFig) : totalFig,
      bn ? bnDigits(totalFig) : totalFig,
      bn ? "০" : "0",
    ],
    [
      bn ? "সর্বমোট" : "Total",
      bn ? bnDigits(totalFig) : totalFig,
      bn ? bnDigits(totalFig) : totalFig,
      bn ? "০" : "0",
    ],
  ];
  return (
    <View style={gfStyles.wrap}>
      {/* CERT-REFINE-02: the meta line renders full-width in
          CertificateDocument, above the body/photo row. */}
      {fields.map((f, i) => (
        <GFieldRow key={i} field={f} base={base} />
      ))}
      <DataTable
        headers={
          bn
            ? ["অর্থবছর", "ধার্যকৃত কর (টাকা)", "আদায়কৃত (টাকা)", "বকেয়া (টাকা)"]
            : ["Fiscal year", "Assessed (BDT)", "Collected (BDT)", "Arrear (BDT)"]
        }
        rows={rows}
        flexes={[1, 1, 1, 1]}
        base={base}
      />
      {totalTaka !== null ? (
        <Para
          segs={[seg(bn ? `কথায়ঃ ${totalWords} টাকা মাত্র।` : `In words: ${totalWords} Taka only.`)]}
          base={base}
          style={{ marginTop: 3 * MM }}
        />
      ) : null}
      {/* CERT-REFINE-02 (R2-16): the standalone collection-date line is
          deleted — the date already prints on the number row and in the
          field list (exactly two occurrences). The collector's signature
          renders in the anchored signature zone (CertificateDocument)
          on the chairman's baseline (R2-02). */}
    </View>
  );
}

function premisesLicenceBody(ctx: DocContext, base: CertFamily) {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  const orgGeo = input.geographyNames?.["org_location"];
  // CERT-REFINE-01 §41: TIN only when present; capital with separators; the
  // fee block from the captured components; cholito validity; grant line.
  const capital = present(p.primises_license_capital)
    ? Number(p.primises_license_capital).toLocaleString("en-IN")
    : "";
  const feeLicence = present(p.premises_fee_licence) ? Number(p.premises_fee_licence) : null;
  const feeVat = present(p.premises_fee_vat) ? Number(p.premises_fee_vat) : null;
  const feeTotal =
    feeLicence !== null || feeVat !== null
      ? (feeLicence ?? 0) + (feeVat ?? 0)
      : input.order
        ? Number(input.order.totalMinor) / 100
        : null;
  const feeFmt = (v: number) => {
    const s = v.toLocaleString("en-IN", { minimumFractionDigits: 2 });
    return bn ? bnDigits(s) : s;
  };
  const fields: GField[] = [
    { label: bn ? "লাইসেন্সধারী" : "Licensee", value: text(bn ? p.primises_license_proprietor_bn : p.primises_license_proprietor) },
    { label: bn ? "প্রতিষ্ঠানের নাম" : "Establishment", value: text(bn ? p.primises_license_org_name_bn : p.primises_license_org_name) },
    { label: bn ? "প্রতিষ্ঠানের ধরণ" : "Business type", value: text(bn ? p.primises_license_org_type_bn : p.primises_license_org_type) },
    { label: bn ? "প্রাঙ্গণের ঠিকানা" : "Premises address", value: text(bn ? p.primises_license_org_area_holding_bn : p.primises_license_org_area_holding) },
    ...(orgGeo ? [{ label: bn ? "এলাকা" : "Area", value: orgGeo[bn ? "bn" : "en"] }] : []),
    { label: bn ? "মূলধন (টাকা)" : "Capital (BDT)", value: bn ? bnDigits(capital) : capital },
    ...(present(p.primises_license_tin_no)
      ? [{ label: bn ? "টিআইএন" : "TIN", value: bn ? bnDigits(p.primises_license_tin_no) : text(p.primises_license_tin_no) }]
      : []),
    { label: bn ? "ওয়ার্ড নং" : "Ward No", value: bn ? bnDigits(p.primises_license_org_ward_no) : text(p.primises_license_org_ward_no) },
    ...(feeLicence !== null
      ? [{ label: bn ? "লাইসেন্স ফি (টাকা)" : "Licence fee (BDT)", value: feeFmt(feeLicence) }]
      : []),
    ...(feeVat !== null
      ? [{ label: bn ? "ভ্যাট (টাকা)" : "VAT (BDT)", value: feeFmt(feeVat) }]
      : []),
    ...(feeTotal !== null
      ? [{ label: bn ? "সর্বমোট ফি (টাকা)" : "Total fee (BDT)", value: feeFmt(feeTotal) }]
      : []),
  ];
  // CERT-REFINE-02 (R2-21): the standard grid — label column 150 pt,
  // the colon at a fixed x, values left-aligned from 168 pt.
  const PremisesRow = ({ field }: { field: GField }) => (
    <View style={{ flexDirection: "row", paddingVertical: 2.5 }}>
      <Text style={{ width: 150, fontSize: 10.5, lineHeight: 1.45, fontWeight: 700 }}>
        <Runs segs={[seg(field.label)]} base={base} bold />
      </Text>
      <Text style={{ width: 18, fontSize: 10.5, lineHeight: 1.45 }}>
        <Runs segs={[seg(":")]} base={base} />
      </Text>
      <Text style={{ flex: 1, fontSize: 11, lineHeight: 1.45 }}>
        <Runs segs={[seg(field.value)]} base={base} />
      </Text>
    </View>
  );
  return (
    <View style={gfStyles.wrap}>
      {/* CERT-REFINE-02: the meta line renders full-width in
          CertificateDocument, above the body/photo row. */}
      {fields.map((f, i) => (
        <PremisesRow key={i} field={f} />
      ))}
      {/* CERT-REFINE-02 (R2-21): validity + grant form one 11.5 pt
          closing paragraph, the validity sentence bold. */}
      <Para
        segs={[
          seg(
            bn
              ? // CERT-REFINE-02 (R2-16): হইতে → থেকে, years explicit.
                `মেয়াদ: ১ জুলাই ${bnDigits(fy.start)} থেকে ৩০ জুন ${bnDigits(fy.end)} পর্যন্ত।`
              : `Validity: 1 July ${fy.start} to 30 June ${fy.end}.`,
            true,
          ),
          seg(
            bn
              ? " উল্লিখিত প্রাঙ্গণে ব্যবসা পরিচালনার জন্য এই লাইসেন্স প্রদান করা হলো।"
              : " This licence is granted for carrying on business at the premises stated above.",
          ),
        ]}
        base={base}
        style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, textAlign: "justify" }}
      />
    </View>
  );
}

/** CERT-REFINE-02 (R2-04/R2-05): the family label-value row — label
 * column 190 pt at 10.5 pt bold, value 11 pt, 2.4 pt row padding. An
 * optional row is omitted when its value is empty; a core identity row
 * prints "—" instead of a bare colon. */
function LVRow({
  label,
  value,
  base,
  core = false,
  labelWidth = 190,
}: {
  label: string;
  value: string;
  base: CertFamily;
  core?: boolean;
  labelWidth?: number;
}) {
  if (!present(value)) {
    if (!core) return null;
    value = "—";
  }
  return (
    <View
      style={{ flexDirection: "row", paddingVertical: 1.8, paddingHorizontal: 7 }}
    >
      <Text style={{ width: labelWidth, fontSize: 10.5, fontWeight: 700, lineHeight: 1.22 }}>
        <Runs segs={[seg(label)]} base={base} bold />
      </Text>
      <Text style={{ flex: 1, fontSize: 11, lineHeight: 1.25 }}>
        <Runs segs={[seg(value)]} base={base} />
      </Text>
    </View>
  );
}

/**
 * CERT-REFINE-02 (R2-05): service 46 leaves the landscape card and joins
 * the certificate family — the standard A4 shell (header, licence-no
 * field line, framed photo, signature block, footer) is assembled in
 * CertificateDocument; this body is the vehicle-details table only. The
 * old duplicate pair ("যানবাহন: মিশুক" above "যানবাহনের ধরণ: মিশুক")
 * collapses: the vehicle-name row prints only when it differs from the
 * class label. Licence and engine numbers print EXACTLY as stored
 * (R2-16 — no digit conversion inside identifier strings).
 */
function vehicleLicenceBody(ctx: DocContext, base: CertFamily) {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  const schema = input.schema ?? getServiceSchema(46);
  const vehicleClass = present(p.transport_vehicle_class)
    ? selectLabel(schema, "transport_vehicle_class", undefined, p.transport_vehicle_class, bn)
    : "";
  const vehicleName = text(
    bn ? p.transport_license_transport_name_bn : p.transport_license_transport_name,
  );
  return (
    <View style={{ marginTop: 6 }}>
      <LVRow
        label={bn ? "যানবাহনের ধরণ" : "Vehicle type"}
        value={vehicleClass}
        base={base}
      />
      {vehicleName && vehicleName !== vehicleClass ? (
        <LVRow label={bn ? "যানবাহন" : "Vehicle"} value={vehicleName} base={base} />
      ) : null}
      <LVRow
        label={bn ? "ইঞ্জিন নং" : "Engine No"}
        value={text(p.transport_license_engine_no)}
        base={base}
      />
      <LVRow
        label={bn ? "মালিক" : "Proprietor"}
        value={text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en)}
        base={base}
      />
      <LVRow
        label={bn ? "ইস্যুর তারিখ" : "Issue date"}
        value={bn ? bnDate(issued) : enDate(issued)}
        base={base}
      />
      <LVRow
        label={bn ? "মেয়াদ" : "Validity"}
        value={bn ? bnDigits(`${fy.start}-${fy.end} অর্থবছর`) : `FY ${fy.start}-${fy.end}`}
        base={base}
      />
    </View>
  );
}

/* ---------- trade licence (service 42) ---------- */

/**
 * CERT-REFINE-01 §42 (mirror of the HTML twin): stacked address blocks with
 * empty rows omitted, unnumbered group headings, no serial row, the fee
 * components from the application, validity + grant lines, and the QR in
 * the header row (top-left — see CertificateDocument); the footer carries
 * the verify text only (DocFooter; since QR-MOVE the QR is in the header
 * on every certificate, so no footer carries a QR).
 */
/**
 * CERT-REFINE-02 (R2-04): the trade licence joins the certificate family.
 * The standard shell (header, number row, framed photo, anchored signature
 * block and footer) is assembled in CertificateDocument; this function
 * renders ONLY the body: the statute line, the fields as a two-column
 * label-value table (label 190 pt, value 11 pt, 2.4 pt row padding) under
 * #F2F2F2 group bands, the itemised fee table (R2-11), and the validity +
 * grant lines. Gone from the CERT-REFINE-01 layout: the licence's own
 * header, the issue-details block (incl. the "Issue Time" clock line),
 * all (ক)/(খ) sub-numbering, and the in-flow footer that spilled onto a
 * footer-only page 2 (R2-01). The issue date prints as a field in the
 * fiscal-year group. Empty-field rule:
 * optional rows are omitted; core identity rows print "—". TIN/BIN print
 * EXACTLY as stored (R2-16); the NID keeps Bengali digits on Bangla
 * documents (CERT-REFINE-01 §42, retained).
 */
/** CERT-REFINE-02 (owner order 19 Nov 09:51/09:56): the trade licence
 * follows the Prottoyon reference design zone-by-zone — header, licence
 * issue details, title + plain number, statute line, NUMBERED field
 * list ১–১৪ in the reference's order (with its (ক)–(ঙ) sub-rows), the
 * reference's two-column fee table, the reference's validity sentence,
 * the two-signature block (প্রশাসনিক কর্মকর্তা + প্যানেল চেয়ারম্যান),
 * then the verify footer. The earlier R2-04 two-column group layout,
 * the "থেকে" validity wording and the "no sub-numbering" rule are
 * SUPERSEDED for svc42 by that order. Owner-locked elements stay inside
 * the reference design: plain number + UP-seal centre watermark, BN+EN
 * under one number/QR, dynamic photo, signature image. */
function tradeLicenceBody(ctx: DocContext, base: CertFamily) {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  const orgGeo = input.geographyNames?.["org_location"];
  const businessAddress = [
    text(bn ? p.business_address_bn : p.business_address_en),
    orgGeo ? orgGeo[bn ? "bn" : "en"] : "",
  ]
    .filter(Boolean)
    .join(", ");
  const wardNo =
    p.trade_license_org_ward_no ?? p.trade_license_org_zone_ward ?? input.citizenGeography?.permanent?.wardNo;
  const identityNo = input.identity?.nid ?? input.identity?.birthReg ?? "";
  // The proprietor IS the applicant citizen: parent names and the
  // proprietor name fall back to the citizen record when the application
  // payload does not carry them (the reference prints the applicant's
  // mother/father/proprietor names; the payload keys alone leave them "—").
  const proprietorName =
    text(bn ? p.proprietor_name_bn : p.proprietor_name_en) ||
    text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en);
  const motherName =
    text(bn ? p.proprietor_mother_name_bn : p.proprietor_mother_name) ||
    text(bn ? input.citizen.mother_name_bn : input.citizen.mother_name_en);
  const fatherName =
    text(bn ? p.proprietor_father_name_bn : p.proprietor_father_name) ||
    text(bn ? input.citizen.father_name_bn : input.citizen.father_name_en);
  const addrParts = (which: "permanent" | "present") => {
    const parts =
      which === "present" && input.citizen.present_same_as_permanent !== false
        ? (input.citizenGeography?.present ?? input.citizenGeography?.permanent)
        : input.citizenGeography?.[which];
    const free =
      which === "permanent"
        ? bn
          ? input.citizen.address_bn
          : input.citizen.address_en
        : input.citizen.present_same_as_permanent === false
          ? bn
            ? input.citizen.present_address_bn
            : input.citizen.present_address_en
          : bn
            ? input.citizen.address_bn
            : input.citizen.address_en;
    const lang = bn ? "bn" : "en";
    // CERT-REFINE-02 (owner refinement round): per-part fallback — a
    // present-address part left empty in the record falls back to the
    // permanent part, so the two columns of the reference's address table
    // do not print half-empty when the citizen's present address is only
    // partially recorded (everything stays data-bound; nothing invented —
    // the fallback source is the citizen's own permanent record).
    const perm = input.citizenGeography?.permanent;
    const pick = (part: "upazila" | "district" | "division") =>
      parts?.[part]?.[lang] || (which === "present" ? (perm?.[part]?.[lang] ?? "") : "");
    return {
      free: text(free),
      upazila: pick("upazila"),
      district: pick("district"),
      division: pick("division"),
      country: bn ? "বাংলাদেশ" : "Bangladesh",
    };
  };
  const L = bn
    ? {
        statute: "ইউনিয়ন পরিষদ আদর্শ কর তফসিল ২০১৩ মোতাবেক",
        business: "ব্যবসা প্রতিষ্ঠানের নাম",
        proprietor: "মালিক/স্বত্বাধিকারীর নাম",
        mother: "মাতার নাম",
        father: "পিতার নাম",
        spouse: "স্পাউজের নাম (প্রযোজ্য ক্ষেত্রে)",
        orgType: "ব্যবসার প্রকৃতি (একক/যৌথ/অন্যান্য)",
        businessType: "ব্যবসার ধরণ",
        businessAddress: "ব্যবসা প্রতিষ্ঠানের ঠিকানা",
        zone: "(ক) অঞ্চল",
        ward: "(খ) ওয়ার্ড নং",
        idA: "(ক) জন্ম নিবন্ধন/এনআইডি/পাসপোর্ট নং",
        idB: "(খ) টিআইএন",
        idC: "(গ) বিআইএন",
        idD: "(ঘ) টেলিফোন/মোবাইল নম্বর",
        idE: "(ঙ) ই-মেইল",
        fy: "(ক) অর্থ বছর",
        startDate: "(খ) ব্যবসা শুরুর তারিখ",
        presentHead: "মালিক/স্বত্বাধিকারীর বর্তমান ঠিকানা",
        permanentHead: "মালিক/স্বত্বাধিকারীর স্থায়ী ঠিকানা",
        schedule: "আদর্শ কর তফসিল, ২০১৩-এর ক্রমিক নং",
        feeHead: "ট্রেড লাইসেন্স ফি (নতুন/নবায়ন)",
        fees: ["নতুন", "নবায়ন", "সারচার্জ", "সংশোধন ফি", "সাইনবোর্ড (পরিচিতিমূলক)", "পেশা ব্যবসা ও বৃত্তির উপর কর", "ভ্যাট", "বকেয়া"],
        total: "সর্বমোট",
        addrSub: ["হোল্ডিং নম্বর", "রোড নং", "গ্রাম/মহল্লা", "ডাকঘর", "পোস্ট কোড", "থানা", "উপজেলা", "জেলা", "বিভাগ", "দেশ"],
      }
    : {
        statute: "According to Union Parishad Model Tax Schedule 2013",
        business: "Business Organization Name",
        proprietor: "Owner's/Proprietor's Name",
        mother: "Mother's Name",
        father: "Father's Name",
        spouse: "Spouse's Name (If applicable)",
        orgType: "Nature of Business (Individual/Joint/Others)",
        businessType: "Business Type",
        businessAddress: "Address of Business Organization",
        zone: "(a) Zone",
        ward: "(b) Ward No",
        idA: "(a) Birth Registration/NID/Passport No",
        idB: "(b) TIN",
        idC: "(c) BIN",
        idD: "(d) Telephone/Mobile Number",
        idE: "(e) E-mail",
        fy: "(a) Fiscal Year",
        startDate: "(b) Business Starting Date",
        presentHead: "Owner's/Proprietor's Present Address",
        permanentHead: "Owner's/Proprietor's Permanent Address",
        schedule: "Model Tax Schedule 2013 Serial No",
        feeHead: "Trade License Fee (New/Renewal)",
        fees: ["New", "Renewal", "Surcharge", "Amendment Fee", "Signboard Fee", "Taxes on Profession & Trades", "VAT", "Arrear"],
        total: "Total",
        addrSub: ["Holding No", "Road No", "Village/Moholla", "Post Office", "Post Code", "Police Station", "Upazila", "District", "Division", "Country"],
      };
  const businessType = selectLabel(input.schema ?? getServiceSchema(42), "business_type", undefined, p.business_type, bn);
  // One numbered row of the reference's field table: number + bold label +
  // colon + value, thin rule below. Blank value prints blank (the
  // reference's own convention for unfilled slots — ৯(ক), ১৩).
  const rowStyle = {
    flexDirection: "row" as const,
    // CERT-REFINE-02 (owner refinement round): 0.9 → 0.65 — reclaims ~9 pt
    // across the table so the in-flow verify footer's number line clears
    // the inner frame border (it measured yMax 815.7 vs the border at
    // ~810.8 before this trim).
    paddingVertical: 0.4,
    paddingHorizontal: 7,
    borderBottomWidth: 0.5,
    borderBottomColor: "#666",
    alignItems: "flex-start" as const,
  };
  const numText = (n: number) => (bn ? `${bnDigits(n)}।` : `${n}.`);
  const trow = (n: number, label: string, value: string) => (
    <View key={`${n}-${label}`} style={rowStyle}>
      <Text style={{ width: 22, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
        <Runs segs={[seg(numText(n))]} base={base} bold />
      </Text>
      <Text style={{ width: 212, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
        <Runs segs={[seg(label)]} base={base} bold />
      </Text>
      <Text style={{ width: 8, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>:</Text>
      <Text style={{ flex: 1, fontSize: 10, lineHeight: 1.08 }}>
        <Runs segs={[seg(value)]} base={base} />
      </Text>
    </View>
  );
  // A numbered row split into two labelled halves (৯, ১০, ১১).
  const halfRow = (
    n: number,
    leftLabel: string,
    leftValue: string,
    rightLabel: string,
    rightValue: string,
  ) => (
    <View key={`${n}-${leftLabel}`} style={rowStyle}>
      <Text style={{ width: 22, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
        <Runs segs={[seg(numText(n))]} base={base} bold />
      </Text>
      <View style={{ flex: 1, flexDirection: "row", marginRight: 10 }}>
        <Text style={{ width: 142, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
          <Runs segs={[seg(leftLabel)]} base={base} bold />
        </Text>
        <Text style={{ width: 8, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>:</Text>
        <Text style={{ flex: 1, fontSize: 10, lineHeight: 1.08 }}>
          <Runs segs={[seg(leftValue)]} base={base} />
        </Text>
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <Text style={{ width: 142, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
          <Runs segs={[seg(rightLabel)]} base={base} bold />
        </Text>
        <Text style={{ width: 8, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>:</Text>
        <Text style={{ flex: 1, fontSize: 10, lineHeight: 1.08 }}>
          <Runs segs={[seg(rightValue)]} base={base} />
        </Text>
      </View>
    </View>
  );
  // ১২: the reference's two-column address sub-table — ten sub-rows,
  // present | permanent. Only the geography parts exist in the data model
  // (holding/road/post-office/postcode/thana have no fields — blank).
  const presentAddr = addrParts("present");
  const permanentAddr = addrParts("permanent");
  const addrValues = (a: ReturnType<typeof addrParts>) => [
    "", "", a.free, "", "", "", a.upazila, a.district, a.division, a.country,
  ];
  const presentVals = addrValues(presentAddr);
  const permanentVals = addrValues(permanentAddr);
  const feeKeys = [
    "trade_fee_new", "trade_fee_renewal", "trade_fee_surcharge", "trade_fee_amendment",
    "trade_fee_signboard", "trade_fee_profession_tax", "trade_fee_vat", "trade_fee_arrear",
  ];
  // The reference prints every fee line, ০.০০ for unused ones.
  const feeRows = feeKeys.map((key, i) => ({
    label: L.fees[i]!,
    value: present(p[key]) ? Number(p[key]) : 0,
  }));
  const totalTaka = feeRows.reduce((acc, r) => acc + (r.value ?? 0), 0) || (input.order ? Number(input.order.totalMinor) / 100 : 0);
  const feeFmt = (v: number) => {
    const str = v.toLocaleString("en-IN", { minimumFractionDigits: 2 });
    return bn ? bnDigits(str) : str;
  };
  const feeCell = (label: string, value: number) => (
    <View key={label} style={{ flexDirection: "row", paddingVertical: 0.4, alignItems: "flex-start" }}>
      <Text style={{ flex: 1, fontSize: 10, lineHeight: 1.08 }}>
        <Runs segs={[seg(label)]} base={base} />
      </Text>
      <Text style={{ width: 8, fontSize: 10, lineHeight: 1.08 }}>:</Text>
      <Text style={{ width: 72, fontSize: 10, textAlign: "right", lineHeight: 1.08 }}>
        <Runs segs={[seg(feeFmt(value))]} base={base} />
      </Text>
    </View>
  );
  // Reference validity sentence — the Chromium engine's EN wording, ordinal
  // days ("This Trade Licence is valid from 1st July 2026 to 30th June
  // 2027."); the fiscal span is always July–June. The grant sentence is
  // NOT printed: the Prottoyon reference has none, and the Chromium engine
  // removed it in the trade merge (gate fix 25 Nov 2026 — it also cost a
  // line that pushed the react-pdf EN render to 2 pages).
  const validity = bn
    ? `অত্র ট্রেড লাইসেন্স এর মেয়াদ ${bnOrd(1)} জুলাই ${bnDigits(fy.start)}ইং হইতে ${bnOrd(30)} জুন ${bnDigits(fy.end)}ইং তারিখ পর্যন্ত`
    : `This Trade Licence is valid from ${enOrd(1)} July ${fy.start} to ${enOrd(30)} June ${fy.end}.`;
  return (
    <View>
      <Text
        style={{
          textAlign: "left",
          fontWeight: 700,
          padding: 0,
          // REFINE (25 Nov 2026): 11 -> 10 — the reference statute line
          // is modest, about the field-row size, not a headline.
          fontSize: 10,
          marginBottom: 1,
        }}
      >
        <Runs segs={[seg(L.statute)]} base={base} bold />
      </Text>
      <View style={{ borderWidth: 0.75, borderColor: "#1a1a1a", borderBottomWidth: 0 }}>
        {trow(1, L.business, text(bn ? p.business_name_bn : p.business_name_en))}
        {trow(2, L.proprietor, proprietorName)}
        {trow(3, L.mother, motherName)}
        {trow(4, L.father, fatherName)}
        {trow(5, L.spouse, text(bn ? p.proprietor_spouse_name_bn : p.proprietor_spouse_name))}
        {trow(6, L.orgType, orgTypeLabel(p, bn))}
        {trow(7, L.businessType, businessType)}
        {trow(8, L.businessAddress, businessAddress)}
        {halfRow(
          9,
          L.zone,
          text(p.trade_license_org_zone_bn) || text(p.trade_license_org_zone),
          L.ward,
          present(wardNo) ? (bn ? bnDigits(wardNo) : text(wardNo)) : "",
        )}
        {trow(10, L.idA, present(identityNo) ? (bn ? bnDigits(identityNo) : text(identityNo)) : "")}
        {halfRow(10, L.idB, text(p.trade_license_tin_no), L.idC, text(p.trade_license_bin_no))}
        {halfRow(
          10,
          L.idD,
          present(p.mobile) ? (bn ? bnDigits(p.mobile) : text(p.mobile)) : "",
          L.idE,
          text(p.trade_license_email),
        )}
        {halfRow(
          11,
          L.fy,
          bn ? bnDigits(`${fy.start} - ${fy.end}`) : `${fy.start} - ${fy.end}`,
          L.startDate,
          present(p.start_date) ? (bn ? bnDateIso(p.start_date) : enDateIso(p.start_date)) : "",
        )}
        <View style={{ ...rowStyle, borderBottomWidth: 0.5 }}>
          <Text style={{ width: 22, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
            <Runs segs={[seg(numText(12))]} base={base} bold />
          </Text>
          <Text style={{ flex: 1, fontSize: 10, fontWeight: 700, lineHeight: 1.08, marginRight: 10 }}>
            <Runs segs={[seg(L.presentHead)]} base={base} bold />
          </Text>
          <Text style={{ flex: 1, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
            <Runs segs={[seg(L.permanentHead)]} base={base} bold />
          </Text>
        </View>
        {L.addrSub.map((sub, i) => (
          <View key={`addr-${i}`} style={{ flexDirection: "row", paddingVertical: 0.3, paddingHorizontal: 7, borderBottomWidth: 0.5, borderBottomColor: "#666" }}>
            <View style={{ flex: 1, flexDirection: "row", marginRight: 10 }}>
              <Text style={{ width: 84, fontSize: 9.5, lineHeight: 1.08 }}>
                <Runs segs={[seg(sub)]} base={base} />
              </Text>
              <Text style={{ width: 8, fontSize: 9.5, lineHeight: 1.08 }}>:</Text>
              <Text style={{ flex: 1, fontSize: 9.5, lineHeight: 1.08 }}>
                <Runs segs={[seg(presentVals[i] ?? "")]} base={base} />
              </Text>
            </View>
            <View style={{ flex: 1, flexDirection: "row" }}>
              <Text style={{ width: 84, fontSize: 9.5, lineHeight: 1.08 }}>
                <Runs segs={[seg(sub)]} base={base} />
              </Text>
              <Text style={{ width: 8, fontSize: 9.5, lineHeight: 1.08 }}>:</Text>
              <Text style={{ flex: 1, fontSize: 9.5, lineHeight: 1.08 }}>
                <Runs segs={[seg(permanentVals[i] ?? "")]} base={base} />
              </Text>
            </View>
          </View>
        ))}
        {trow(13, L.schedule, "")}
        <View style={{ ...rowStyle, borderBottomWidth: 0.5 }}>
          <Text style={{ width: 22, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
            <Runs segs={[seg(numText(14))]} base={base} bold />
          </Text>
          <Text style={{ flex: 1, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
            <Runs segs={[seg(L.feeHead)]} base={base} bold />
          </Text>
        </View>
        <View style={{ flexDirection: "row", paddingHorizontal: 7, borderBottomWidth: 0.5, borderBottomColor: "#666" }}>
          <View style={{ flex: 1, marginRight: 10 }}>
            {feeRows.slice(0, 4).map((r) => feeCell(r.label, r.value))}
          </View>
          <View style={{ flex: 1 }}>
            {feeRows.slice(4).map((r) => feeCell(r.label, r.value))}
          </View>
        </View>
        <View style={{ flexDirection: "row", paddingVertical: 2, paddingHorizontal: 7, borderTopWidth: 1, borderTopColor: "#666" }}>
          <Text style={{ flex: 1, fontSize: 10, fontWeight: 700, textAlign: "right", lineHeight: 1.08 }}>
            <Runs segs={[seg(L.total)]} base={base} bold />
          </Text>
          <Text style={{ width: 8, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>:</Text>
          <Text style={{ width: 72, fontSize: 10, fontWeight: 700, textAlign: "right", lineHeight: 1.08 }}>
            <Runs segs={[seg(feeFmt(totalTaka))]} base={base} bold />
          </Text>
        </View>
      </View>
      <Text style={{ fontWeight: 700, fontSize: 11, marginTop: 2, lineHeight: 1.35 }}>
        <Runs segs={[seg(validity)]} base={base} bold />
      </Text>
    </View>
  );
}

/** CERT-REFINE-02 (owner order 19 Nov): the trade licence's issue-details
 * row — "লাইসেন্স ইস্যুর বিবরণ" (date + time) on the left, the plain
 * licence number on the right, as in the Prottoyon reference. */
function TradeIssueRow({ ctx, base }: { ctx: DocContext; base: CertFamily }) {
  const { bn, issued } = ctx;
  const time24 = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(issued);
  return (
    // GATE FIX (25 Nov 2026): the react-pdf EN trade licence spilled its
    // footer "Certificate No:" line onto page 2 (BN fit; EN field labels
    // run slightly taller). Trim 13pt of trade-only vertical space —
    // issue row 6→3, sign row 6→3, body gap 4→1, QR top gap 8→4 — so both
    // languages fit on one page like the reference. No other type touched.
    <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 3 }}>
      <View style={{ width: 155 }}>
        <Text style={{ fontSize: 9.5, fontWeight: 700, lineHeight: 1.2 }}>
          <Runs segs={[seg(bn ? "লাইসেন্স ইস্যুর বিবরণ" : "Licence Issue Details")]} base={base} bold />
        </Text>
        <Text style={{ fontSize: 9.5, lineHeight: 1.2 }}>
          <Runs segs={[seg(bn ? `ইস্যুর তারিখ: ${ordDate(issued, bn)}` : `Date of Issue: ${ordDate(issued, bn)}`)]} base={base} />
        </Text>
        <Text style={{ fontSize: 9.5, lineHeight: 1.2 }}>
          <Runs segs={[seg(bn ? `ইস্যুর সময়: ${bnDigits(time24)}` : `Time of Issue: ${time24}`)]} base={base} />
        </Text>
      </View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
        <Text style={{ marginRight: 6, fontSize: 10.5, fontWeight: 700 }}>
          <Runs segs={[seg(bn ? "ট্রেড লাইসেন্স নং:" : "Trade License No:")]} base={base} bold />
        </Text>
        <NumberDisplay number={ctx.input.number} bn={bn} base={base} />
      </View>
    </View>
  );
}

/** CERT-REFINE-02 (owner order 19 Nov): the trade licence's two-signature
 * block — প্রশাসনিক কর্মকর্তা (label only, as in the reference; no
 * admin-officer signatory exists in the certificate data) on the left, the
 * named chairman on the right. Both blocks carry the dotted rule above the
 * name/label (pixel-verified on the trade reference), chairman order:
 * signature image → dotted rule → bold name → title → office → address. */
function TradeSignRow({ ctx, base }: { ctx: DocContext; base: CertFamily }) {
  const { input, bn, official } = ctx;
  const issuerName = input.issuer
    ? bn
      ? text(input.issuer.nameBn) || text(input.issuer.nameEn)
      : text(input.issuer.nameEn) || text(input.issuer.nameBn)
    : "";
  const bundle = certificateAssetsBundle(input.tenant.id, input.assets, input.issuer);
  const signature = official && bundle.signature ? bundle.signature : null;
  return (
    <View style={{ flexDirection: "row", marginTop: 3 }}>
      <View style={{ width: 200 }}>
        <View style={{ height: 22 }} />
        <View style={styles.signLineDotted} />
        <Text style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, marginTop: 4 }}>
          <Runs segs={[seg(bn ? "প্রশাসনিক কর্মকর্তা" : "Administrative Officer")]} base={base} bold />
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ width: 200 }}>
        {signature ? (
          <Image
            src={signature}
            style={{ height: 22, width: 150, objectFit: "contain", alignSelf: "center", marginTop: 4 }}
          />
        ) : (
          <View style={{ height: 22 }} />
        )}
        <View style={styles.signLineDotted} />
        {issuerName ? (
          <Text style={styles.signName}>
            <Runs segs={[seg(issuerName)]} base={base} bold />
          </Text>
        ) : null}
        <Text style={styles.signTitle}>
          <Runs segs={[seg(chairmanTitle(input.issuer?.accountType, bn))]} base={base} />
        </Text>
        <Text style={styles.signOffice}>
          <Runs segs={[seg(ctx.officeName)]} base={base} bold />
        </Text>
        {ctx.officeAddressLine ? (
          <Text style={styles.signAddress}>
            <Runs segs={[seg(ctx.officeAddressLine)]} base={base} />
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* ---------- document assembly ---------- */

function buildCtx(input: PdfInput): DocContext {
  const official = process.env.ISSUANCE_MODE === "official";
  const bn = input.payload.delivery_language !== "en";
  const issued = input.issuedAt ? new Date(input.issuedAt) : new Date();
  const origin = (() => {
    try {
      return new URL(input.verificationUrl).origin;
    } catch {
      return input.verificationUrl.replace(/\/verify\/.*$/, "");
    }
  })();
  return {
    input,
    bn,
    issued,
    official,
    origin,
    numberDisplay: bn ? bnDigits(input.number) : latinDigits(input.number),
    officeName: bn ? input.tenant.name_bn : input.tenant.name_en,
    officeAddressLine: officeLine(input, bn),
  };
}

function pngSize(dataUrl: string): { w: number; h: number } | null {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const buf = Buffer.from(match[1]!, "base64");
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const PAGE_POINTS: Record<string, { w: number; h: number }> = {
  A4: { w: 595.28, h: 841.89 },
  Letter: { w: 612, h: 792 },
};

function CertificateDocument({
  input,
  qrDataUrl,
}: {
  input: PdfInput;
  qrDataUrl: string;
}) {
  const ctx = buildCtx(input);
  const { bn } = ctx;
  // W-001: demo mode carries the demo banner + DEMO watermark; official
  // mode renders neither.
  const demo = !ctx.official;
  const serviceNo = input.service.service_no ?? 0;
  const format = certificatePageFormat(serviceNo);
  const isTrade = serviceNo === 42;
  const base: CertFamily = bn ? CERT_BENGALI_FAMILY : CERT_LATIN_FAMILY;
  const emblemUrl = ctx.official ? governmentEmblemDataUrl() : null;
  const title =
    serviceNo === 47
      ? text(bn ? input.payload.certificate_type_bn : input.payload.certificate_type_en) ||
        (bn ? input.service.name_bn : input.service.name_en)
      : serviceNo === 33
        ? // WS-WORDING (D21): the reference title, as a per-service
          // template override — NOT a catalog change. English keeps the
          // catalog name (no English reference was supplied).
          bn
          ? "জাতীয় পরিচয়পত্র তথ্য সংশোধন"
          : input.service.name_en
        : serviceNo === 35
          ? // WS-WORDING (D12): the reference title is exactly "চারিত্রিক
            // সনদ" — this overrides the CERTNO-01 decision D2 combined
            // title for Bangla. English keeps the combined title (no
            // English reference was supplied).
            bn
            ? "চারিত্রিক সনদ"
            : "Citizenship and Character Certificate"
        : serviceNo === 1
          ? // CERT-REFINE-01 §1: the receipt's own title.
            bn
            ? "আদায় রশিদ (হোল্ডিং ট্যাক্স)"
            : "Collection Receipt (Holding Tax)"
          : serviceNo === 27
            ? // CERT-REFINE-01 §27: the letter's own title.
              bn
              ? "পাসপোর্ট সুপারিশ পত্র"
              : "Passport Recommendation Letter"
            : serviceNo === 40
              ? // CERT-REFINE-01 §40: the ethnic-minority certificate title.
                bn
                ? "ক্ষুদ্র নৃ-গোষ্ঠী সনদ"
                : "Ethnic Minority Community Certificate"
              : bn
                ? input.service.name_bn
                : input.service.name_en;

  const dims = PAGE_POINTS[format.size]!;
  const explicitSize = format.size.includes("mm");
  const pageW = explicitSize ? dims.w : format.orientation === "landscape" ? dims.h : dims.w;
  const pageH = explicitSize ? dims.h : format.orientation === "landscape" ? dims.w : dims.h;
  // CERT-REFINE-02: one margin for the whole family (the trade licence's
  // tighter 8mm margin and the card's 3mm margin are retired).
  const margin = 11 * MM;

  // Md's order of 25 Nov 2026 (supersedes CERTNO-01; per-UP resolution
  // re-confirmed 25 Nov 2026, 12:12): the centre watermark is the issuing
  // office's own UP SEAL (bundle.watermark — profile SEAL first per
  // tenant, then the deployment drop-in). The pre-faded drop-in
  // (seal-watermark.png) prints at full opacity; a full-strength seal
  // (watermarkDerived) is faded to 0.08 (0.05 on the trade licence). 204 pt
  // ≈ 72 mm, as measured on the Prottoyon references; centred on the page.
  // With no seal asset there is NO watermark — never the Government emblem,
  // never the platform logo.
  const sealBundle = certificateAssetsBundle(input.tenant.id, input.assets, input.issuer);
  let sealNode: React.ReactNode = null;
  if (ctx.official && sealBundle.watermark) {
    const width = 204;
    const size = pngSize(sealBundle.watermark);
    const height = size ? (width * size.h) / size.w : width;
    sealNode = (
      <Image
        fixed
        src={sealBundle.watermark}
        style={{
          position: "absolute",
          left: (pageW - width) / 2,
          top: (pageH - height) / 2,
          width,
          height,
          opacity: sealBundle.watermarkDerived ? (isTrade ? 0.05 : 0.08) : 1,
        }}
      />
    );
  }

  // CERT-REFINE-02: ONE shell for the whole family — header row (QR
  // top-left, centred header, framed photo top-right corner since
  // PHOTO-CORNER 25 Nov 2026), number row, then the full-width body
  // (absent photo → the equal-width spacer keeps the header centred).
  const metaLine = isTrade ? (
    <TradeIssueRow ctx={ctx} base={base} />
  ) : serviceNo === 46 ? (
    <LicenceNoLine ctx={ctx} base={base} />
  ) : FORM_SERVICES.has(serviceNo) ? (
    <FormMetaLine ctx={ctx} base={base} />
  ) : (
    <NumLine
      ctx={ctx}
      base={base}
      numberLabel={bn ? "সনদ নং:-" : "Certificate No:-"}
      dateLabel={bn ? "ইস্যুর তারিখ:-" : "Date of Issue:-"}
      ordinalDate
    />
  );
  const bodyContent = isTrade ? (
    tradeLicenceBody(ctx, base)
  ) : serviceNo === 46 ? (
    vehicleLicenceBody(ctx, base)
  ) : FORM_SERVICES.has(serviceNo) ? (
    serviceNo === 1 ? (
      taxReceiptBody(ctx, base)
    ) : serviceNo === 41 ? (
      premisesLicenceBody(ctx, base)
    ) : (
      genericFormBody(ctx, base)
    )
  ) : (
    paragraphBody(ctx, serviceNo, base)
  );
  const body = isTrade ? (
    <>
      {/* Prottoyon reference (Md's order 25 Nov 2026): on the trade licence
          the QR sits top-left in the header row and the framed photo sits
          top-right, so the numbered field table runs the FULL content width.
          The header lockup itself is the standard one (emblem centred). */}
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ width: 94, alignItems: "center" }}>
          <View style={{ marginTop: 4 }}>
            <QrWithEmblem qrDataUrl={qrDataUrl} emblemUrl={emblemUrl} size={54} />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <HeaderBlock ctx={ctx} title={title} emblemUrl={emblemUrl} base={base} emblemSize={format.orientation === "landscape" ? 76 : 62} />
        </View>
        {input.citizenPhoto ? (
          <CitizenPhoto ctx={ctx} style={{ marginLeft: 8 }} />
        ) : (
          <View style={{ width: 94 }} />
        )}
      </View>
      {metaLine}
      <View style={{ marginTop: 1 }}>{bodyContent}</View>
    </>
  ) : (
    <>
      {/* QR-MOVE (Md's order 25 Nov 2026 15:00) + PHOTO-CORNER (15:20):
          the QR sits top-LEFT and the citizen photo in the TOP-RIGHT
          CORNER — both in the header row, level with each other; the
          photo no longer sits beside the body text. The header row
          mirrors the trade licence's — QR column left, centred header,
          photo right — with EQUAL-WIDTH side columns (107pt, the photo
          frame's width) so the header stays page-centred; the QR hugs
          its column's left edge. QR size kept at 46 (its old footer
          size; the trade header QR stays 54). The body then runs the
          FULL content width. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ width: 107, alignItems: "flex-start" }}>
          <View style={{ marginTop: 4 }}>
            <QrWithEmblem qrDataUrl={qrDataUrl} emblemUrl={emblemUrl} size={46} />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <HeaderBlock ctx={ctx} title={title} emblemUrl={emblemUrl} base={base} emblemSize={format.orientation === "landscape" ? 76 : 62} />
        </View>
        {input.citizenPhoto ? (
          <CitizenPhoto ctx={ctx} />
        ) : (
          <View style={{ width: 107 }} />
        )}
      </View>
      {metaLine}
      <View style={{ marginTop: 8 }}>{bodyContent}</View>
    </>
  );

  // CERT-REFINE-02 (R2-01/R2-02): the signature block and the footer group
  // are ANCHORED to fixed page positions on every certificate — the
  // signature block's bottom edge at Y=762 pt (bottom offset 80 pt), the
  // footer group's bottom edge 11 pt above the inner frame's bottom edge
  // (bottom offset 42 pt; QR-MOVE lowered it from 53 so the centred
  // verify text's top edge stays below the signature block) — so a short
  // body can no longer leave them floating mid-page and a long one can
  // no longer push the footer onto its own page.
  // REFINE (25 Nov 2026): services 2/3/4 are anchored too — the family
  // and warish references anchor the signature at the bottom exactly
  // like the paragraph certs (pixel-measured: signature rule at ~85%
  // of the page height on 75147645374); in-flow left them floating
  // mid-page under short tables. Only the trade licence (42) stays
  // in-flow: its two-signature block follows the grant box, whose
  // height varies with the fee rows.
  const anchored = serviceNo !== 42;
  // CERT-REFINE-02 (R2-17 fit): the two marriage formats carry the
  // tallest anchored body (intro + two banded party boxes + closing);
  // at the family reserve of 218 their content height alone pushes a
  // furniture-only second page. Their reserve is 170 — the anchored
  // furniture itself (signature row, footer) does not move; only the
  // body budget grows, and the closing paragraph sits in the left
  // column, clear of the signature block.
  // GATE FIX (25 Nov 2026): the verbatim wording bodies run taller than the
  // old authored ones (both addresses + blessings + after-table lines), so
  // six paragraph types spilled a blank second page in react-pdf and the
  // warish table (service 3) spilled its signature block — the flow box
  // (body + 218pt reserve) was a hair over one page. The reserve only sets
  // where the flow box breaks; it moves no visible element (the signature
  // and footer are absolutely positioned). 218 -> 190 for the paragraph
  // family; services 2/3 (five-row tables) get 120. The bodies still end
  // well clear of the signature zone.
  // REFINE (25 Nov 2026): services 2/3/4 now anchor (above), so the
  // reserve governs their fit too — 190 like the paragraph family. The
  // compact body + table styles remain the fit lever for long
  // heir/member tables; the reserve only sets where the flow box
  // breaks, it moves no visible element.
  const bodyReserve = serviceNo === 25 || serviceNo === 26 ? 170 : 190;

  // CERT-REFINE-02 (R2-02/R2-13): the secondary signatures (svc01
  // collector, svc19 guardian) anchor to the SAME baseline as the
  // chairman block, on the left side of the anchored row. They keep the
  // dotted rule (170 pt wide) so the chairman's solid rule keeps
  // precedence. The paddingBottom compensates the different below-rule
  // heights so the two RULES share one Y (chairman below-rule ≈ 68 pt:
  // rule margin 4 + title 15.75 + office 18 + address 15 + date 15;
  // collector below-rule ≈ 20 pt, guardian ≈ 35 pt) — verified by
  // measurement on the proof renders.
  // WS-WORDING service 19 (D9/D22): the guardian block is the guardian's
  // NAME ONLY, bold, no dotted rule, no "অভিভাবকের স্বাক্ষর" label — as on
  // the reference crop, where the name's baseline aligns with the
  // chairman's name. The name comes from the payload slot
  // (consentGuardianName — no schema field exists); without one the left
  // side stays empty. pad 49 aligns the name with the chairman's name
  // (chairman block ≈ 77 pt: 10 rule zone + 18 name + 15.75 title + 18
  // office + 15 address; name-only block ≈ 18 pt; 77 − 10 − 18 = 49).
  const guardianSignName =
    serviceNo === 19
      ? consentGuardianName(input.payload, bn) ||
        // English keeps the old model (citizen = guardian), so the
        // citizen name is the guardian there; Bangla must NOT fall back
        // to it — the citizen is the child in the new model.
        (bn ? "" : text(input.citizen.full_name_en))
      : "";
  const secondarySign =
    serviceNo === 1
      ? { label: bn ? "আদায়কারীর স্বাক্ষর" : "Collector's signature", name: "", pad: 48, nameOnly: false }
      : serviceNo === 19 && guardianSignName
        ? {
            label: bn ? "" : "Guardian's signature",
            name: bn ? guardianSignName : `Name: ${guardianSignName}`,
            pad: bn ? 49 : 34,
            nameOnly: bn,
          }
        : null;

  return (
    <Document>
      <Page
        size={
          format.size === "A4"
            ? "A4"
            : format.size === "Letter"
              ? "LETTER"
              : { width: pageW, height: pageH }
        }
        orientation={explicitSize ? undefined : format.orientation}
        style={{
          ...styles.page,
          fontFamily: base,
          fontSize: px(14.5),
          lineHeight: 1.75,
        }}
      >
        <View
          fixed
          style={{
            position: "absolute",
            top: margin - 1.4 * MM,
            left: margin - 1.4 * MM,
            right: margin - 1.4 * MM,
            bottom: margin - 1.4 * MM,
            borderWidth: px(2.6),
            borderColor: "#1a1a1a",
          }}
        />
        {/* REFINE (25 Nov 2026): inner frame line px(1.1) -> px(2.6) —
            the reference's two frame lines are equal (~0.69mm each);
            ours printed the inner line at half weight. */}
        <View
          fixed
          style={{
            position: "absolute",
            top: margin,
            left: margin,
            right: margin,
            bottom: margin,
            borderWidth: px(2.6),
            borderColor: "#1a1a1a",
          }}
        />
        {sealNode}
        {demo ? (
          <Text
            fixed
            style={{
              position: "absolute",
              left: (pageW - 300) / 2,
              top: 380,
              width: 300,
              textAlign: "center",
              fontSize: 68,
              fontWeight: 700,
              color: "#b3261e",
              opacity: 0.09,
              transform: "rotate(-30deg)",
            }}
          >
            DEMO
          </Text>
        ) : null}
        <View
          style={{
            paddingTop: margin + 5 * MM,
            // CERT-REFINE-02: with the bottom zone anchored, the content
            // reserve keeps body content above Y≈606 pt — at least 28 pt
            // clear of the signature block's top edge (≈634 pt).
            paddingBottom: anchored ? bodyReserve : isTrade ? 4 : margin - 3,
            paddingLeft: margin + 6 * MM,
            paddingRight: margin + 6 * MM,
          }}
        >
          {demo ? <DemoBanner base={base} /> : null}
          {body}
          {anchored ? null : (
            <>
              {isTrade ? (
                <TradeSignRow ctx={ctx} base={base} />
              ) : (
                // In-flow signature — reached only by the trade licence
                // (42) since REFINE anchored 2/3/4; kept as the safe
                // fallback shape (8pt gap, per the 25 Nov gate fix).
                <View style={{ marginTop: 8, marginLeft: "auto", width: 200 }}>
                  <SignBlock ctx={ctx} base={base} />
                </View>
              )}
              <View style={{ marginTop: 2 }}>
                <DocFooter ctx={ctx} base={base} />
              </View>
            </>
          )}
        </View>
        {anchored ? (
          <>
            <View
              style={{
                position: "absolute",
                left: margin + 6 * MM,
                right: margin + 6 * MM,
                bottom: 80,
                flexDirection: "row",
                alignItems: "flex-end",
                justifyContent: "space-between",
              }}
            >
              {secondarySign ? (
                secondarySign.nameOnly ? (
                  // WS-WORDING service 19: guardian name only, bold, no
                  // dotted rule, no label — as on the reference.
                  <View style={{ width: 170, paddingBottom: secondarySign.pad }}>
                    <Text style={{ textAlign: "center", fontSize: 12, lineHeight: 1.5 }}>
                      <Runs segs={[seg(secondarySign.name)]} base={base} bold />
                    </Text>
                  </View>
                ) : (
                  <View style={{ width: 170, paddingBottom: secondarySign.pad }}>
                    <View style={styles.signLineDotted} />
                    <Text style={{ textAlign: "center", fontSize: px(13), lineHeight: 1.5 }}>
                      <Runs segs={[seg(secondarySign.label)]} base={base} />
                    </Text>
                    {secondarySign.name ? (
                      <Text style={{ textAlign: "center", fontSize: px(13), lineHeight: 1.5 }}>
                        <Runs segs={[seg(secondarySign.name)]} base={base} />
                      </Text>
                    ) : null}
                  </View>
                )
              ) : (
                <View />
              )}
              <SignBlock ctx={ctx} base={base} />
            </View>
            {/* QR-MOVE + PHOTO-CORNER (25 Nov 2026): the anchored verify
                footer spans the full content width (text LEFT-aligned
                in DocFooter since Md's 15:21 order) and sits at
                bottom:42 — its top edge (~67 pt from the page bottom at
                the 1.3 leading) stays clear of the signature row's
                bottom edge (bottom:80), so the left-aligned URL cannot
                collide with the right-side signature block. */}
            <View
              style={{
                position: "absolute",
                left: margin + 6 * MM,
                right: margin + 6 * MM,
                bottom: 42,
              }}
            >
              <DocFooter ctx={ctx} base={base} />
            </View>
          </>
        ) : null}

      </Page>
    </Document>
  );
}

/**
 * Render a template-v7 certificate with @react-pdf/renderer — no browser
 * process is started. Called by pdf.ts only when PDF_ENGINE=react-pdf.
 */
export async function renderCertificatePdfReact(
  input: PdfInput,
  qrDataUrl: string,
): Promise<Buffer> {
  ensureCertificateFonts();
  const out = await renderToBuffer(
    <CertificateDocument input={input} qrDataUrl={qrDataUrl} />,
  );
  return Buffer.from(out);
}
