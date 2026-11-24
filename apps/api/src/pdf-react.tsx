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
  GOVT_LINE_BN,
  GOVT_LINE_EN,
  STATUS_SENTENCE_BN,
  STATUS_SENTENCE_EN,
  STATUS_SENTENCE_SERVICES,
  CORRECTION_FIELD_LABELS,
  orgTypeLabel,
  amountInWordsBn,
  amountInWordsEn,
  bnDigits,
  bnDate,
  bnDateIso,
  bnDateSlash,
  deathCauseEn,
  deathPlaceEn,
  enDate,
  enDateIso,
  enDateSlash,
  fiscalYear,
  money,
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
  type AttestContext,
  type DocContext,
} from "./certificate-template-v7.js";
import {
  certificateAssetsBundle,
  governmentEmblemDataUrl,
} from "./template-assets.js";
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
 * signature block, the QR + verification footer, the government-emblem
 * watermark and the double-rule frame. The Chromium renderer remains the
 * default engine (PDF_ENGINE in pdf.ts); this module renders only when
 * PDF_ENGINE=react-pdf.
 *
 * CERTNO-01: this twin carries the same redesign as the HTML template — the
 * 16-digit number in a one-digit-per-box strip, the emblem (not the office
 * seal) as the centre watermark, the citizen photo printed only when one is
 * on file, and the service 1 / 41 / 46 layouts (receipt, premises licence,
 * transport card) beside the shared attestation corpus updates.
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
  page: { color: "#000" },
  content: {},
  header: { alignItems: "center" },
  // CERT-REFINE-02 (R2-07): one header lockup — emblem 40 pt, office name
  // 21 pt bold, address 10.5 pt, hairline under the header (HeaderBlock).
  emblem: { width: 40, height: 40, objectFit: "contain", marginBottom: 3 },
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
  bodyPara: { textAlign: "justify", fontSize: 12.5, lineHeight: 1.68 },
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
  signLine: {
    borderTopWidth: 0.75,
    borderTopColor: "#000",
    borderTopStyle: "solid",
    marginTop: 4,
    marginBottom: 4,
  },
  // Secondary signatures (collector, guardian) keep the dotted rule.
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
  docFoot: { flexDirection: "row", alignItems: "flex-end", marginTop: 7 * MM },
  // CERT-REFINE-02 (R2-19): QR 46×46 in the anchored footer group.
  qr: { width: 46, height: 46 },
  verifyLine: { flex: 1, textAlign: "center", fontSize: px(11.5), marginLeft: 6 * MM },
  tableWrap: { marginTop: 4 * MM },
  tableRow: { flexDirection: "row" },
  // CERT-REFINE-02 (R2-11): one table style — 0.5 pt #666 rules, body
  // 10.5 pt with 4.5/7 padding, header #E8E8E8 10.5 pt bold with 5/7.
  tableCell: {
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#666",
    paddingVertical: 4.5,
    paddingHorizontal: 7,
    fontSize: 10.5,
    lineHeight: 1.5,
  },
  tableHeadCell: {
    fontWeight: 700,
    backgroundColor: "#E8E8E8",
    fontSize: 10.5,
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
});

/* ---------- shared blocks ---------- */

/**
 * CERTNO-01: the certificate number one digit per box (the HTML twin's
 * .numstrip). Applies when the number (after an optional DEMO- marker) is
 * exactly 16 digits; any other stored number prints as plain text.
 */
function NumberDisplay({
  number,
  bn,
  base,
  small = false,
}: {
  number: string;
  bn: boolean;
  base: CertFamily;
  small?: boolean;
}) {
  const match = /^(DEMO-)?(\d{16})$/.exec(number);
  if (!match)
    return (
      <Text>
        <Runs segs={[seg(bn ? bnDigits(number) : latinDigits(number))]} base={base} bold />
      </Text>
    );
  // CERT-REFINE-02 (R2-08): boxes 15×19 pt, gaps 2.5 pt, digits 11 pt.
  const boxW = small ? 3.6 * MM : 15;
  const boxH = small ? 4.6 * MM : 19;
  const fontSize = small ? px(9) : 11;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {match[1] ? (
        <Text style={{ fontWeight: 700, marginRight: 1.5 * MM }}>
          <Runs segs={[seg("DEMO-")]} base={base} bold />
        </Text>
      ) : null}
      <View style={{ flexDirection: "row" }}>
        {match[2]!.split("").map((d, i) => (
          <View
            key={i}
            style={{
              width: boxW,
              height: boxH,
              borderWidth: 0.5,
              borderColor: "#333",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: i === 0 ? 0 : small ? 1 * MM : 2.5,
            }}
          >
            <Text style={{ fontSize, fontWeight: 700, lineHeight: 1 }}>
              <Runs segs={[seg(bn ? bnDigits(d) : d)]} base={base} bold />
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** CERTNO-01: the citizen photo — rendered only when one is on file.
 * CERT-REFINE-02 (R2-09): the photo sits in a fixed frame — 80×100 pt
 * image, 3 pt white padding, 0.75 pt #8A8A8A border. Absent photo →
 * nothing renders (no placeholder, no reserved space). */
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
          width: 86,
          height: 106,
          borderWidth: 0.75,
          borderColor: "#8A8A8A",
          backgroundColor: "#fff",
          padding: 3,
        },
        style ?? {},
      ]}
    >
      <Image
        src={ctx.input.citizenPhoto}
        style={{ width: 80, height: 100, objectFit: "cover" }}
      />
    </View>
  );
}

function HeaderBlock({
  ctx,
  title,
  emblemUrl,
  base,
  hideEmblem = false,
}: {
  ctx: DocContext;
  title: string;
  emblemUrl: string | null;
  base: CertFamily;
  /** Trade licence only: the emblem sits in the header row's left column
   * (as in the Prottoyon reference — beside the name, not above it). */
  hideEmblem?: boolean;
}) {
  const { input, bn, official } = ctx;
  // CERT-REFINE-01: the office logo prints beside the office name when the
  // office has one configured (the asset bundle, as in the HTML twin).
  const bundle = certificateAssetsBundle(input.tenant.id, input.assets, input.issuer);
  const logo = official && bundle.logo ? bundle.logo : null;
  return (
    <View style={styles.header}>
      {emblemUrl && !hideEmblem ? <Image style={styles.emblem} src={emblemUrl} /> : null}
      {/* CERT-REFINE-01 (A1): emblem → government line → office name.
          CERT-REFINE-02 (R2-07): government line 11 pt bold; logo 34 pt
          tall with an 8 pt gap to the 21 pt office name. */}
      <Text style={{ fontWeight: 700, fontSize: 11, textAlign: "center", lineHeight: 1.3 }}>
        <Runs segs={[seg(bn ? GOVT_LINE_BN : GOVT_LINE_EN)]} base={base} bold />
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
        {logo ? (
          <Image
            src={logo}
            style={{ height: 34, width: 56, objectFit: "contain", marginRight: 8 }}
          />
        ) : null}
        <Text style={styles.officeName}>
          <Runs segs={[seg(ctx.officeName)]} base={base} bold />
        </Text>
      </View>
      <Text style={styles.officeAddress}>
        <Runs segs={[seg(ctx.officeAddressLine)]} base={base} />
      </Text>
      {/* CERT-REFINE-02 (R2-07): a 0.75 pt hairline closes the header. */}
      <View
        style={{
          borderBottomWidth: 0.75,
          borderBottomColor: "#1a1a1a",
          width: "100%",
          marginTop: 5,
        }}
      />
      <Text style={styles.docTitle}>
        <Runs segs={[seg(title)]} base={base} bold />
      </Text>
      {/* CERT-REFINE-02 (R2-20): the centred title accent rule. */}
      <View
        style={{ width: 64, height: 1.4, backgroundColor: "#000", marginTop: 5 }}
      />
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
  const { input, bn, official, issued } = ctx;
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
  // CERT-REFINE-02 (R2-13): one composition everywhere — name 12 pt bold →
  // signature image (max-height 30 pt) → SOLID 0.75 pt rule → chairman
  // title 10.5 pt → office name 12 pt bold → address 10 pt → date 10 pt,
  // 4 pt gaps, in the anchored 200 pt block.
  return (
    <View style={styles.signBlock}>
      {issuerName ? (
        <Text style={styles.signName}>
          <Runs segs={[seg(issuerName)]} base={base} bold />
        </Text>
      ) : null}
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
      <View style={styles.signLine} />
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
      <Text style={{ textAlign: "center", fontSize: 10 }}>
        <Runs
          segs={[seg(`${bn ? "তারিখ:" : "Date:"} ${bn ? bnDate(issued) : enDate(issued)}`)]}
          base={base}
        />
      </Text>
    </View>
  );
}

function DocFooter({
  ctx,
  qrDataUrl,
  base,
}: {
  ctx: DocContext;
  qrDataUrl: string;
  base: CertFamily;
}) {
  const { input, bn, origin } = ctx;
  // CERT-REFINE-01 (A6): Latin digits in both languages; the QR payload is
  // this same URL (pdf.ts).
  const verifyUrl = `${origin}/verify?searchText=${latinDigits(input.number)}`;
  // CERT-REFINE-02 (R2-19): the footer verify group — QR 46×46 bottom-left,
  // then "যাচাই করুন:"/"Verify:" bold + the URL at 8 pt on one line, and
  // the certificate number in Latin digits at 8 pt under it.
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <Image style={styles.qr} src={qrDataUrl} />
      <View style={{ marginLeft: 8, paddingTop: 3 }}>
        <Text style={{ fontSize: 8.5 }}>
          <Runs
            segs={[
              seg(bn ? "যাচাই করুন: " : "Verify: ", true),
              seg(verifyUrl),
            ]}
            base={base}
          />
        </Text>
        <Text style={{ fontSize: 8, marginTop: 3 }}>
          <Runs
            segs={[
              seg(
                bn
                  ? `সনদ নং (সংখ্যায়): ${latinDigits(input.number)}`
                  : `Certificate No: ${latinDigits(input.number)}`,
              ),
            ]}
            base={base}
          />
        </Text>
      </View>
    </View>
  );
}

function DataTable({
  headers,
  rows,
  flexes,
  base,
}: {
  headers: string[];
  rows: string[][];
  flexes: number[];
  base: CertFamily;
}) {
  if (!rows.length) return null;
  const cell = (isHead: boolean, flex: number) => ({
    ...styles.tableCell,
    ...(isHead ? styles.tableHeadCell : {}),
    flex,
    borderTopWidth: isHead ? 0.5 : 0,
    borderLeftWidth: 0,
  });
  return (
    <View style={styles.tableWrap}>
      <View style={[styles.tableRow, { borderLeftWidth: 0.5, borderColor: "#666" }]}>
        {headers.map((h, i) => (
          <Text key={i} style={cell(true, flexes[i] ?? 1)}>
            <Runs segs={[seg(h)]} base={base} bold />
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.tableRow, { borderLeftWidth: 0.5, borderColor: "#666" }]}>
          {row.map((c, i) => (
            <Text key={i} style={cell(false, flexes[i] ?? 1)}>
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
  } else {
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
  const intro: Seg[] = bn
    ? [seg("এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, "), ...identity, seg(`, ঠিকানাঃ ${address}।`)]
    : // CERT-REFINE-02 (R2-15): "of address: Village/House:" → "of Village/House:".
      [seg("This is to certify that "), ...identity, seg(`, of ${address}.`)];
  return (
    <>
      <Para segs={[...intro, seg(` ${sentences.join(" ")}`)]} base={base} style={styles.bodyPara} />
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
  const rows = members.map((m, i) => [
    bn ? bnDigits(i + 1) : String(i + 1),
    text(bn ? m.name_bn : m.name_en),
    bn ? bnDigits(m.warish_heir_nid) : text(m.warish_heir_nid),
    bn ? bnDateSlash(m.dob) : enDateSlash(m.dob),
    selectLabel(schema, "members", "relationship", m.relationship, bn),
  ]);
  const headers = bn
    ? ["ক্রমিক", "নাম", "আইডি/জন্মনিবন্ধন নং", "জন্ম তারিখ", "সম্পর্ক"]
    : ["Sl", "Name", "ID/Birth Reg No", "Date of birth", "Relationship"];
  const closing = bn
    ? "আমি উক্ত পরিবারের সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
    : "I wish the family every prosperity.";
  // The base same-family attestation is retained (cholito register).
  const familyLine = bn
    ? "এই সনদে উল্লিখিত ব্যক্তিগণ একই পরিবারের সদস্য বলে প্রত্যয়ন করা যাচ্ছে।"
    : "The persons listed in this certificate are members of the same family.";
  return (
    <>
      <Para segs={introSegs} base={base} style={styles.bodyPara} />
      {/* CERT-REFINE-02 (R2-11): the ID column flexes to ≈154 pt
          (1.85 of 5.45 — the table lives in the photo-narrowed body
          column, ≈453 pt) so the "আইডি/জন্মনিবন্ধন নং" header never
          wraps mid-phrase. */}
      <DataTable headers={headers} rows={rows} flexes={[0.42, 1.38, 1.85, 0.92, 0.88]} base={base} />
      <Para segs={[seg(familyLine)]} base={base} style={styles.bodyPara} />
      <Para segs={[seg(closing)]} base={base} style={styles.closing} />
    </>
  );
}

/** CERT-REFINE-01 §19: consent certificate body (mirror). */
function consentBody(ctx: DocContext, base: CertFamily) {
  const { input, bn } = ctx;
  const p = input.payload;
  const schema = input.schema ?? getServiceSchema(19);
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
const WELL_WISH_SERVICES = new Set([12, 15, 21, 22, 27, 45]);

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
    const closing = bn
      ? "আমি তাঁহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
      : "I wish the certificate holder every success and prosperity.";
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
  if (serviceNo === 33) {
    const corrections = Array.isArray(p.corrections)
      ? (p.corrections as Record<string, unknown>[])
      : [];
    const schema = input.schema ?? getServiceSchema(33);
    const rows = corrections.map((c, i) => {
      const fromSchema = selectLabel(schema, "corrections", "correction_category_id", c.correction_category_id, bn);
      const fieldLabel =
        fromSchema !== text(c.correction_category_id)
          ? fromSchema
          : (CORRECTION_FIELD_LABELS[text(c.correction_category_id)]?.[bn ? "bn" : "en"] ?? fromSchema);
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
  const closing = WELL_WISH_SERVICES.has(serviceNo)
    ? bn
      ? "আমি তাঁহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
      : "I wish the certificate holder every success and prosperity."
    : "";
  if (serviceNo === 37) {
    // CERT-REFINE-01 §37: the fields line under the recommendation clause.
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
 * under the strip). Label 11 pt bold + the digit strip (15×19 pt boxes),
 * date 11 pt bold on the same baseline at the right edge. The hyphens in
 * the old "নং:-" labels are deleted (R2-16).
 */
function NumLine({
  ctx,
  base,
  numberLabel,
  dateLabel,
  marginTop = 35,
}: {
  ctx: DocContext;
  base: CertFamily;
  numberLabel: string;
  /** null → no date on the row (the trade licence renders its own
   * issue-details row — TradeIssueRow — instead of this component). */
  dateLabel: string | null;
  marginTop?: number;
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
            segs={[seg(`${dateLabel} ${bn ? bnDate(issued) : enDate(issued)}`)]}
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
 * CERT-REFINE-02 (R2-05): service 46's strip row is replaced by a plain
 * field line — "লাইসেন্স নং / Licence No: TL-…" — the licence number
 * printed EXACTLY as stored (no digit conversion inside identifiers,
 * R2-16).
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
 * components from the application, validity + grant lines, and NO QR in the
 * header (it sits in the bottom-left footer — see DocFooter).
 */
/**
 * CERT-REFINE-02 (R2-04): the trade licence joins the certificate family.
 * The standard shell (header, strip row, framed photo, anchored signature
 * block and footer) is assembled in CertificateDocument; this function
 * renders ONLY the body: the statute band, the fields as a two-column
 * label-value table (label 190 pt, value 11 pt, 2.4 pt row padding) under
 * #F2F2F2 group bands, the itemised fee table (R2-11), and the validity +
 * grant lines. Gone from the CERT-REFINE-01 layout: the licence's own
 * header, the issue-details block (incl. the "Issue Time" clock line),
 * all (ক)/(খ) sub-numbering, and the in-flow footer that spilled onto a
 * footer-only page 2 (R2-01). The issue date — which cannot share the
 * strip row (label + strip + date measure 517 pt > 499 pt content width)
 * — prints as a field in the fiscal-year group. Empty-field rule:
 * optional rows are omitted; core identity rows print "—". TIN/BIN print
 * EXACTLY as stored (R2-16); the NID keeps Bengali digits on Bangla
 * documents (CERT-REFINE-01 §42, retained).
 */
/** CERT-REFINE-02 (owner order 19 Nov 09:51/09:56): the trade licence
 * follows the Prottoyon reference design zone-by-zone — header, licence
 * issue details, title + digit-box number, statute band, NUMBERED field
 * list ১–১৪ in the reference's order (with its (ক)–(ঙ) sub-rows), the
 * reference's two-column fee table, the reference's validity sentence,
 * the two-signature block (প্রশাসনিক কর্মকর্তা + প্যানেল চেয়ারম্যান),
 * then the verify footer. The earlier R2-04 two-column group layout,
 * the "থেকে" validity wording and the "no sub-numbering" rule are
 * SUPERSEDED for svc42 by that order. Owner-locked elements stay inside
 * the reference design: 16-digit number + digit-box strip, govt emblem
 * centre watermark, BN+EN under one number/QR, dynamic photo, signature
 * image, no separate seal print. */
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
      <Text style={{ width: 196, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
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
        <Text style={{ width: 134, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
          <Runs segs={[seg(leftLabel)]} base={base} bold />
        </Text>
        <Text style={{ width: 8, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>:</Text>
        <Text style={{ flex: 1, fontSize: 10, lineHeight: 1.08 }}>
          <Runs segs={[seg(leftValue)]} base={base} />
        </Text>
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <Text style={{ width: 134, fontSize: 10, fontWeight: 700, lineHeight: 1.08 }}>
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
  // Reference validity sentence (owner order): ordinal day + "ইং" +
  // "হইতে", with DigitalUnion's 1-year fiscal span (the reference's
  // 5-year span is an owner decision — see the samples report).
  const validity = bn
    ? `অত্র ট্রেড লাইসেন্স এর মেয়াদ ${bnOrdinal(1)} জুলাই ${bnDigits(fy.start)}ইং হইতে ${bnOrdinal(30)} জুন ${bnDigits(fy.end)}ইং তারিখ পর্যন্ত`
    : `The validity of this trade licence is from 1 July ${fy.start} to 30 June ${fy.end}.`;
  const grant = bn
    ? "উল্লিখিত ব্যবসা প্রতিষ্ঠানকে ব্যবসা পরিচালনার জন্য এই লাইসেন্স প্রদান করা হলো।"
    : "The licence is hereby granted to the above business to carry on its trade.";
  return (
    <View>
      <Text
        style={{
          borderWidth: 0.75,
          borderColor: "#1a1a1a",
          textAlign: "center",
          fontWeight: 700,
          padding: 2,
          fontSize: 11,
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
      <Para
        segs={[seg(grant)]}
        base={base}
        style={{ fontSize: 11, lineHeight: 1.5, textAlign: "justify", marginTop: 2 }}
      />
    </View>
  );
}

/** Bengali ordinal day for the reference validity sentence: ১লা, ২রা,
 * ৩রা, ৪ঠা, ৫ই…১৮ই, ১৯শে…৩১শে. */
function bnOrdinal(day: number): string {
  const table: Record<number, string> = {
    1: "১লা", 2: "২রা", 3: "৩রা", 4: "৪ঠা", 5: "৫ই", 6: "৬ই", 7: "৭ই", 8: "৮ই",
    9: "৯ই", 10: "১০ই", 11: "১১ই", 12: "১২ই", 13: "১৩ই", 14: "১৪ই", 15: "১৫ই",
    16: "১৬ই", 17: "১৭ই", 18: "১৮ই", 19: "১৯শে", 20: "২০শে", 21: "২১শে",
    22: "২২শে", 23: "২৩শে", 24: "২৪শে", 25: "২৫শে", 26: "২৬শে", 27: "২৭শে",
    28: "২৮শে", 29: "২৯শে", 30: "৩০শে", 31: "৩১শে",
  };
  return table[day] ?? bnDigits(day);
}

/** CERT-REFINE-02 (owner order 19 Nov): the trade licence's issue-details
 * row — "লাইসেন্স ইস্যুর বিবরণ" (date + time) on the left, the locked
 * digit-box strip on the right. The strip's width (label + 16 boxes ≈
 * 362 pt) means the issue date cannot sit under the title as in the
 * reference; it shares this row instead. */
function TradeIssueRow({ ctx, base }: { ctx: DocContext; base: CertFamily }) {
  const { bn, issued } = ctx;
  const time24 = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(issued);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 6 }}>
      <View style={{ width: 130 }}>
        <Text style={{ fontSize: 9.5, fontWeight: 700, lineHeight: 1.2 }}>
          <Runs segs={[seg(bn ? "লাইসেন্স ইস্যুর বিবরণ" : "Licence Issue Details")]} base={base} bold />
        </Text>
        <Text style={{ fontSize: 9.5, lineHeight: 1.2 }}>
          <Runs segs={[seg(bn ? `ইস্যুর তারিখ: ${bnDate(issued)}` : `Date of Issue: ${enDate(issued)}`)]} base={base} />
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
 * block, in flow after the grant — প্রশাসনিক কর্মকর্তা (title only, as in
 * the reference; no admin-officer signatory exists in the certificate
 * data) on the left, the named chairman (image + rule + title + office)
 * on the right. */
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
    <View style={{ flexDirection: "row", marginTop: 6 }}>
      <View style={{ width: 200 }}>
        <View style={{ height: 22 }} />
        <View style={styles.signLine} />
        <Text style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, marginTop: 4 }}>
          <Runs segs={[seg(bn ? "প্রশাসনিক কর্মকর্তা" : "Administrative Officer")]} base={base} bold />
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ width: 200 }}>
        {issuerName ? (
          <Text style={styles.signName}>
            <Runs segs={[seg(issuerName)]} base={base} bold />
          </Text>
        ) : null}
        {signature ? (
          <Image
            src={signature}
            style={{ height: 22, width: 150, objectFit: "contain", alignSelf: "center", marginTop: 4 }}
          />
        ) : (
          <View style={{ height: 22 }} />
        )}
        <View style={styles.signLine} />
        <Text style={styles.signTitle}>
          <Runs segs={[seg(chairmanTitle(input.issuer?.accountType, bn))]} base={base} />
        </Text>
        <Text style={styles.signOffice}>
          <Runs segs={[seg(ctx.officeName)]} base={base} bold />
        </Text>
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
  const serviceNo = input.service.service_no ?? 0;
  const format = certificatePageFormat(serviceNo);
  const isTrade = serviceNo === 42;
  const base: CertFamily = bn ? CERT_BENGALI_FAMILY : CERT_LATIN_FAMILY;
  const emblemUrl = ctx.official ? governmentEmblemDataUrl() : null;
  const title =
    serviceNo === 47
      ? text(bn ? input.payload.certificate_type_bn : input.payload.certificate_type_en) ||
        (bn ? input.service.name_bn : input.service.name_en)
      : serviceNo === 35
        ? // CERTNO-01 (owner decision D2): the combined title.
          bn
          ? "নাগরিকত্ব ও চারিত্রিক সনদপত্র"
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

  // CERTNO-01: the centre watermark is the Government of Bangladesh emblem,
  // large and faint — the office seal is not printed anywhere.
  // CERT-REFINE-02 (R2-14): 300 pt diameter, centred on (297 pt, 430 pt),
  // ≈8% opacity, on every certificate.
  let sealNode: React.ReactNode = null;
  if (emblemUrl) {
    const width = 300;
    const size = pngSize(emblemUrl);
    const height = size ? (width * size.h) / size.w : width;
    sealNode = (
      <Image
        fixed
        src={emblemUrl}
        style={{
          position: "absolute",
          left: (pageW - width) / 2,
          top: 430 - height / 2,
          width,
          height,
          opacity: 0.08,
        }}
      />
    );
  }

  // CERT-REFINE-02: ONE shell for the whole family — header, number row,
  // then the body beside the framed photo (R2-09: the photo's top sits
  // 8 pt below the number row; absent photo → no reserved space).
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
      numberLabel={bn ? "সনদ নং:" : "Certificate No:"}
      dateLabel={bn ? "ইস্যুর তারিখ:" : "Date of Issue:"}
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
      {/* CERT-REFINE-02 (owner order 19 Nov): on the trade licence the
          framed photo sits in the header row (balanced by a left spacer)
          so the numbered field table runs the FULL content width, as in
          the Prottoyon reference (photo top-right). The header lockup
          itself is the standard one. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ width: 94, alignItems: "center" }}>
          {emblemUrl ? (
            <Image src={emblemUrl} style={{ width: 44, height: 44, marginTop: 26 }} />
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <HeaderBlock ctx={ctx} title={title} emblemUrl={emblemUrl} base={base} hideEmblem />
        </View>
        {input.citizenPhoto ? (
          <CitizenPhoto ctx={ctx} style={{ marginLeft: 8 }} />
        ) : (
          <View style={{ width: 94 }} />
        )}
      </View>
      {metaLine}
      <View style={{ marginTop: 4 }}>{bodyContent}</View>
    </>
  ) : (
    <>
      <HeaderBlock ctx={ctx} title={title} emblemUrl={emblemUrl} base={base} />
      {metaLine}
      <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 8 }}>
        <View style={{ flex: 1 }}>{bodyContent}</View>
        <CitizenPhoto ctx={ctx} style={{ marginLeft: 8 }} />
      </View>
    </>
  );

  // CERT-REFINE-02 (R2-01/R2-02): the signature block and the footer group
  // are ANCHORED to fixed page positions on every certificate — the
  // signature block's bottom edge at Y=762 pt (bottom offset 80 pt), the
  // footer group's bottom edge 22 pt above the inner frame's bottom edge
  // (bottom offset 53 pt) — so a short body can no longer leave them
  // floating mid-page and a long one can no longer push the footer onto
  // its own page. Exempt: the family and warish documents (2/3/4 — their
  // tables set the length; signature + footer follow the body in flow)
  // and the trade licence (42 — the Prottoyon reference design has the
  // two-signature block and the verify footer in flow after the grant).
  const anchored = ![2, 3, 4, 42].includes(serviceNo);
  // CERT-REFINE-02 (R2-17 fit): the two marriage formats carry the
  // tallest anchored body (intro + two banded party boxes + closing);
  // at the family reserve of 218 their content height alone pushes a
  // furniture-only second page. Their reserve is 170 — the anchored
  // furniture itself (signature row, footer) does not move; only the
  // body budget grows, and the closing paragraph sits in the left
  // column, clear of the signature block.
  const bodyReserve = serviceNo === 25 || serviceNo === 26 ? 170 : 218;

  // CERT-REFINE-02 (R2-02/R2-13): the secondary signatures (svc01
  // collector, svc19 guardian) anchor to the SAME baseline as the
  // chairman block, on the left side of the anchored row. They keep the
  // dotted rule (170 pt wide) so the chairman's solid rule keeps
  // precedence. The paddingBottom compensates the different below-rule
  // heights so the two RULES share one Y (chairman below-rule ≈ 68 pt:
  // rule margin 4 + title 15.75 + office 18 + address 15 + date 15;
  // collector below-rule ≈ 20 pt, guardian ≈ 35 pt) — verified by
  // measurement on the proof renders.
  const guardianName = text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en);
  const secondarySign =
    serviceNo === 1
      ? { label: bn ? "আদায়কারীর স্বাক্ষর" : "Collector's signature", name: "", pad: 48 }
      : serviceNo === 19
        ? {
            label: bn ? "অভিভাবকের স্বাক্ষর" : "Guardian's signature",
            name: bn ? `নামঃ ${guardianName}` : `Name: ${guardianName}`,
            pad: 34,
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
        <View
          fixed
          style={{
            position: "absolute",
            top: margin,
            left: margin,
            right: margin,
            bottom: margin,
            borderWidth: px(1.1),
            borderColor: "#1a1a1a",
          }}
        />
        {sealNode}
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
          {body}
          {anchored ? null : (
            <>
              {isTrade ? (
                <TradeSignRow ctx={ctx} base={base} />
              ) : (
                <View style={{ marginTop: 24, marginLeft: "auto", width: 200 }}>
                  <SignBlock ctx={ctx} base={base} />
                </View>
              )}
              <View style={{ marginTop: 4 }}>
                <DocFooter ctx={ctx} qrDataUrl={qrDataUrl} base={base} />
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
              ) : (
                <View />
              )}
              <SignBlock ctx={ctx} base={base} />
            </View>
            <View
              style={{
                position: "absolute",
                left: margin + 6 * MM,
                bottom: 53,
              }}
            >
              <DocFooter ctx={ctx} qrDataUrl={qrDataUrl} base={base} />
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
