import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
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
  bnDigits,
  bnDate,
  bnDateIso,
  enDate,
  enDateIso,
  issueTime,
  fiscalYear,
  money,
  latinDigits,
  present,
  text,
  chairmanTitle,
  certificatePageFormat,
  officeLine,
  permanentAddress,
  presentAddress,
  selectLabel,
  type DocContext,
} from "./certificate-template-v7.js";
import {
  governmentEmblemDataUrl,
  officeSealDataUrls,
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
 * signature block, the QR + verification footer, the office seal watermark and
 * the double-rule frame. The Chromium renderer remains the default engine
 * (PDF_ENGINE in pdf.ts); this module renders only when PDF_ENGINE=react-pdf.
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

/* ---------- text segments (the structured twin of the HTML <strong> runs) ---------- */
interface Seg {
  t: string;
  b?: boolean;
}
const seg = (t: string, b = false): Seg => ({ t, b });
const joinSegs = (parts: Seg[][]): Seg[] => {
  const out: Seg[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(seg(", "));
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
  page: { color: "#101418" },
  content: {},
  header: { alignItems: "center" },
  emblem: { width: 15 * MM, height: 15 * MM, objectFit: "contain", marginBottom: 1.5 * MM },
  officeName: { fontSize: px(21), lineHeight: 1.4, textAlign: "center", fontWeight: 700 },
  officeAddress: { fontSize: px(13.5), textAlign: "center" },
  docTitle: { fontSize: px(19), lineHeight: 1.4, textAlign: "center", fontWeight: 700, marginTop: 3.5 * MM },
  numline: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontWeight: 700,
    marginTop: 4.5 * MM,
    marginBottom: 2.5 * MM,
  },
  bodyPara: { textAlign: "justify" },
  closing: { marginTop: 5 * MM, textAlign: "justify" },
  freeFooter: { fontSize: px(12), marginTop: 4 * MM },
  signBlock: {
    marginTop: 11 * MM,
    marginLeft: "auto",
    width: 64 * MM,
    fontSize: px(13),
    lineHeight: 1.55,
  },
  signName: { fontWeight: 700, fontSize: px(14.5), textAlign: "center" },
  signLine: {
    borderTopWidth: px(1.6),
    borderTopColor: "#333",
    borderTopStyle: "dotted",
    marginTop: 1.6 * MM,
    marginBottom: 1.6 * MM,
    marginLeft: 5 * MM,
    marginRight: 5 * MM,
  },
  signTitle: { textAlign: "center" },
  signOffice: { fontWeight: 700, textAlign: "center" },
  signAddress: { textAlign: "center" },
  docFoot: { flexDirection: "row", alignItems: "flex-end", marginTop: 7 * MM },
  qr: { width: 21 * MM, height: 21 * MM },
  verifyLine: { flex: 1, textAlign: "center", fontSize: px(11.5), marginLeft: 6 * MM },
  tableWrap: { marginTop: 4 * MM },
  tableRow: { flexDirection: "row" },
  tableCell: {
    borderRightWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: "#5b6b60",
    paddingVertical: 1.1 * MM,
    paddingHorizontal: 2 * MM,
    fontSize: px(12.5),
    lineHeight: 1.5,
  },
  tableHeadCell: { fontWeight: 700 },
});

/* ---------- shared blocks ---------- */

function HeaderBlock({
  ctx,
  title,
  emblemUrl,
  base,
}: {
  ctx: DocContext;
  title: string;
  emblemUrl: string | null;
  base: CertFamily;
}) {
  return (
    <View style={styles.header}>
      {emblemUrl ? <Image style={styles.emblem} src={emblemUrl} /> : null}
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
  compact = false,
}: {
  ctx: DocContext;
  base: CertFamily;
  /** Trade licence: v7 shrinks the sign block (margin-top 2mm, 12px/1.5). */
  compact?: boolean;
}) {
  const { input, bn } = ctx;
  const issuerName = input.issuer
    ? bn
      ? text(input.issuer.nameBn) || text(input.issuer.nameEn)
      : text(input.issuer.nameEn) || text(input.issuer.nameBn)
    : "";
  return (
    <View
      style={
        compact
          ? [styles.signBlock, { marginTop: 2 * MM, fontSize: px(12), lineHeight: 1.5 }]
          : styles.signBlock
      }
    >
      {issuerName ? (
        <Text style={styles.signName}>
          <Runs segs={[seg(issuerName)]} base={base} bold />
        </Text>
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
    </View>
  );
}

function DocFooter({
  ctx,
  qrDataUrl,
  base,
  trade,
}: {
  ctx: DocContext;
  qrDataUrl: string;
  base: CertFamily;
  trade: boolean;
}) {
  const { bn, origin } = ctx;
  const verifyUrl = `${origin}/verify?searchText=${ctx.numberDisplay}`;
  const verifyLine =
    trade && !bn
      ? `Issued from: ${verifyUrl}`
      : bn
        ? `যাচাইকরণ: ${verifyUrl}`
        : `Verification: ${verifyUrl}`;
  return (
    <View style={[styles.docFoot, trade ? { marginTop: 5 * MM } : {}]}>
      {trade ? null : <Image style={styles.qr} src={qrDataUrl} />}
      <Text style={styles.verifyLine}>
        <Runs segs={[seg(verifyLine)]} base={base} />
      </Text>
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
    borderTopWidth: isHead ? 0.75 : 0,
    borderLeftWidth: 0,
  });
  return (
    <View style={styles.tableWrap}>
      <View style={[styles.tableRow, { borderLeftWidth: 0.75, borderColor: "#5b6b60" }]}>
        {headers.map((h, i) => (
          <Text key={i} style={cell(true, flexes[i] ?? 1)}>
            <Runs segs={[seg(h)]} base={base} bold />
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.tableRow, { borderLeftWidth: 0.75, borderColor: "#5b6b60" }]}>
          {row.map((c, i) => (
            <Text key={i} style={cell(false, flexes[i] ?? 1)}>
              <Runs segs={[seg(c)]} base={base} />
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ---------- identity + paragraph chassis (structured mirrors of v7) ---------- */

function identitySegs(ctx: DocContext): Seg[] {
  const { input, bn } = ctx;
  const c = input.citizen;
  const parts: Seg[][] = [];
  parts.push([seg(bn ? c.full_name_bn : c.full_name_en, true)]);
  const nid = input.identity?.nid;
  const birthReg = input.identity?.birthReg;
  if (bn) {
    if (present(nid)) parts.push([seg("জাতীয় পরিচয়পত্র নম্বরঃ "), seg(bnDigits(nid), true)]);
    else if (present(birthReg)) parts.push([seg("জন্ম নিবন্ধন নম্বরঃ "), seg(bnDigits(birthReg), true)]);
    if (present(c.spouse_name_bn))
      parts.push([seg(c.gender === "male" ? "স্ত্রীঃ " : "স্বামীঃ "), seg(text(c.spouse_name_bn), true)]);
    if (present(c.father_name_bn)) parts.push([seg("পিতাঃ "), seg(text(c.father_name_bn), true)]);
    if (present(c.mother_name_bn)) parts.push([seg("মাতাঃ "), seg(text(c.mother_name_bn), true)]);
  } else {
    if (present(nid)) parts.push([seg("National ID No: "), seg(text(nid), true)]);
    else if (present(birthReg)) parts.push([seg("Birth Registration No: "), seg(text(birthReg), true)]);
    if (present(c.spouse_name_en)) parts.push([seg("Spouse: "), seg(text(c.spouse_name_en), true)]);
    if (present(c.father_name_en)) parts.push([seg("Father: "), seg(text(c.father_name_en), true)]);
    if (present(c.mother_name_en)) parts.push([seg("Mother: "), seg(text(c.mother_name_en), true)]);
  }
  return joinSegs(parts);
}

const runAttestation = (
  a: string | ((p: Record<string, unknown>) => string) | undefined,
  payload: Record<string, unknown>,
) => (typeof a === "function" ? a(payload) : (a ?? ""));

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
  } else {
    if (present(father)) idParts.push([seg("Father: "), seg(text(father), true)]);
    if (present(mother)) idParts.push([seg("Mother: "), seg(text(mother), true)]);
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
        `তিনি ${present(dod) ? `${bnDateIso(dod)} তারিখে ` : ""}${present(place) ? `${text(place)} এ ` : ""}মৃত্যুবরণ করিয়াছেন।`,
      );
      if (present(reason)) sentences.push(`মৃত্যুর কারণঃ ${text(reason)}।`);
      if (serviceNo === 31) sentences.push("তিনি অবিবাহিত অবস্থায় মৃত্যুবরণ করিয়াছেন।");
      if (present(registerNo)) sentences.push(`মৃত্যু নিবন্ধন নংঃ ${bnDigits(registerNo)}।`);
    } else {
      sentences.push(
        `The person died${present(dod) ? ` on ${enDateIso(dod)}` : ""}${present(place) ? ` at ${text(place)}` : ""}.`,
      );
      if (present(reason)) sentences.push(`Cause of death: ${text(reason)}.`);
      if (serviceNo === 31) sentences.push("The person died unmarried.");
      if (present(registerNo)) sentences.push(`Death registration no: ${text(registerNo)}.`);
    }
  } else {
    if (bn) {
      sentences.push(
        `তিনি মৃত্যুবরণ করিয়াছেন${present(dod) ? ` (মৃত্যুর তারিখঃ ${bnDateIso(dod)})` : ""}। তাহার ওয়ারিশগণ নিম্নরূপ:`,
      );
      if (present(registerNo)) sentences.push(`নিবন্ধন নংঃ ${bnDigits(registerNo)}।`);
    } else {
      sentences.push(
        `The person has died${present(dod) ? ` (date of death: ${enDateIso(dod)})` : ""}. The legal heirs are as follows:`,
      );
      if (present(registerNo)) sentences.push(`Registration no: ${text(registerNo)}.`);
    }
  }
  let table: React.ReactNode = null;
  if (serviceNo === 3 || serviceNo === 4) {
    const heirs = Array.isArray(p.heirs) ? (p.heirs as Record<string, unknown>[]) : [];
    const rows = heirs.map((h, i) => [
      bn ? bnDigits(i + 1) : String(i + 1),
      text(bn ? h.warish_heir_name_bn : h.warish_heir_name),
      text(h.warish_heir_relation),
      bn ? bnDigits(h.warish_heir_dob) : text(h.warish_heir_dob),
      text(h.warish_heir_father_name),
    ]);
    table = (
      <DataTable
        headers={
          bn
            ? ["ক্রমিক", "ওয়ারিশের নাম", "সম্পর্ক", "জন্ম তারিখ", "পিতার নাম"]
            : ["Sl", "Heir's name", "Relation", "Date of birth", "Father's name"]
        }
        rows={rows}
        flexes={[0.5, 1.6, 1, 1, 1.2]}
        base={base}
      />
    );
    sentences.push(
      bn
        ? serviceNo === 4
          ? "উল্লিখিত ব্যক্তিগণই তাহার আইনগত উত্তরাধিকারী; তাহাদের ছাড়া আর কোনো ওয়ারিশ আছে বলিয়া জানা যায় না।"
          : "উল্লিখিত ব্যক্তিগণ ছাড়া তাহার আর কোনো ওয়ারিশ আছে বলিয়া জানা যায় না।"
        : serviceNo === 4
          ? "The persons listed are the legal successors; no other heir is known."
          : "No other heir is known besides the persons listed.",
    );
  }
  const intro: Seg[] = bn
    ? [seg("এই মর্মে প্রত্যয়ন করা যাইতেছে যে, "), ...identity, seg(`, ঠিকানাঃ- ${address}।`)]
    : [seg("This is to certify that "), ...identity, seg(`, of address: ${address}.`)];
  return (
    <>
      <Para segs={[...intro, seg(` ${sentences.join(" ")}`)]} base={base} style={styles.bodyPara} />
      {table}
    </>
  );
}

function paragraphBody(ctx: DocContext, serviceNo: number, base: CertFamily) {
  const { input, bn } = ctx;
  const p = input.payload;
  if (serviceNo === 3 || serviceNo === 4 || serviceNo === 7 || serviceNo === 31)
    return deceasedBody(ctx, serviceNo, base);
  if (serviceNo === 47) {
    const body = text(bn ? p.certificate_details_bn : p.certificate_details_en);
    const footer = text(bn ? p.certificate_footer_bn : p.certificate_footer_en);
    return (
      <>
        <Para segs={[seg(body)]} base={base} style={styles.bodyPara} />
        {footer ? <Para segs={[seg(footer)]} base={base} style={styles.freeFooter} /> : null}
      </>
    );
  }
  const attestation = runAttestation(bn ? ATTESTATIONS_BN[serviceNo] : ATTESTATIONS_EN[serviceNo], p);
  const paraSegs: Seg[] = bn
    ? [
        seg("এই মর্মে প্রত্যয়ন করা যাইতেছে যে, "),
        ...identitySegs(ctx),
        seg(", তাহার "),
        seg("স্থায়ী ঠিকানাঃ-", true),
        seg(` ${permanentAddress(ctx)}। `),
        seg("বর্তমান ঠিকানাঃ-", true),
        seg(` ${presentAddress(ctx)}।`),
        ...(attestation ? [seg(` ${attestation}`)] : []),
      ]
    : [
        seg("This is to certify that "),
        ...identitySegs(ctx),
        seg(", whose "),
        seg("permanent address is:", true),
        seg(` ${permanentAddress(ctx)}. `),
        seg("Present address:", true),
        seg(` ${presentAddress(ctx)}.`),
        ...(attestation ? [seg(` ${attestation}`)] : []),
      ];
  if (serviceNo === 33) {
    const corrections = Array.isArray(p.corrections)
      ? (p.corrections as Record<string, unknown>[])
      : [];
    const rows = corrections.map((c, i) => [
      bn ? bnDigits(i + 1) : String(i + 1),
      text(c.correction_category_id),
      text(c.incorrect_info),
      text(c.correct_info),
    ]);
    const intro = bn
      ? "তাহার জাতীয় পরিচয় তথ্যে নিম্নোক্ত সংশোধন প্রয়োজন বলিয়া প্রত্যয়ন করা যাইতেছে:"
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
  let table: React.ReactNode = null;
  if (serviceNo === 2) {
    const members = Array.isArray(p.members) ? (p.members as Record<string, unknown>[]) : [];
    const schema = input.schema ?? getServiceSchema(2);
    const rows = members.map((m, i) => [
      bn ? bnDigits(i + 1) : String(i + 1),
      text(bn ? m.name_bn : m.name_en),
      selectLabel(schema, "members", "relationship", m.relationship, bn),
      bn ? bnDigits(m.dob) : text(m.dob),
    ]);
    table = (
      <DataTable
        headers={
          bn
            ? ["ক্রমিক", "সদস্যের নাম", "সম্পর্ক", "জন্ম তারিখ"]
            : ["Sl", "Member name", "Relationship", "Date of birth"]
        }
        rows={rows}
        flexes={[0.5, 1.6, 1, 1]}
        base={base}
      />
    );
  }
  const closing = bn
    ? "আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
    : "I wish the person every success and prosperity.";
  return (
    <>
      <Para segs={paraSegs} base={base} style={styles.bodyPara} />
      {table}
      <Para segs={[seg(closing)]} base={base} style={styles.closing} />
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

/* ---------- trade licence (service 42) ---------- */

const tlStyles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "flex-start" },
  qrTl: { width: 19 * MM, height: 19 * MM },
  head: { flex: 1, alignItems: "center" },
  spacer: { width: 19 * MM },
  officeName: { fontSize: px(19), lineHeight: 1.4, textAlign: "center", fontWeight: 700 },
  officeAddress: { fontSize: px(13.5), textAlign: "center" },
  docTitle: { fontSize: px(17), lineHeight: 1.4, textAlign: "center", fontWeight: 700, marginTop: 2 * MM },
  tlNo: { fontWeight: 700, marginTop: 1.5 * MM, textAlign: "center" },
  issue: { fontSize: px(12), lineHeight: 1.35, marginTop: 0.5 * MM },
  statute: {
    borderWidth: px(1.6),
    borderColor: "#1a1a1a",
    textAlign: "center",
    fontWeight: 700,
    padding: 1 * MM,
    marginVertical: 1.6 * MM,
    fontSize: px(13.5),
  },
  // Font size is 11.6px in the v7 CSS. 10.9px is used here as wrap
  // headroom: react-pdf packs Bengali lines slightly looser than Chromium,
  // and this fixed one-page form must not spill when real-world values
  // (long business names/addresses) wrap further than the test fixture's.
  fields: { fontSize: px(10.9), lineHeight: 1.32 },
  row: { flexDirection: "row", paddingVertical: 0.15 * MM, paddingHorizontal: 1 * MM },
  fl: { width: 64 * MM, fontWeight: 700 },
  flSub: { fontWeight: 400, paddingLeft: 9 * MM },
  fv: { flex: 1 },
  subpair: { flexDirection: "row" },
  pair: { flex: 1 },
  addrHeads: { flexDirection: "row" },
  addrHead: { width: "49%", fontWeight: 700 },
  addrCols: { flexDirection: "row" },
  addrCol: { flex: 1 },
  // NOTE: no lineHeight here — in @react-pdf/renderer a lineHeight on a
  // flex-row View (or on a Text without its own fontSize) is applied twice
  // to the line box (bisected in REACTPDF-MIGRATION-01: row pitch 23.76pt
  // with it, 10.83pt without). Line heights belong on column containers or
  // on Texts that also set fontSize.
  addrRow: { flexDirection: "row" },
  addrLabel: { width: 30 * MM },
  fees: { flexDirection: "row" },
  feesCol: { flex: 1, paddingRight: 3 * MM },
  feeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: "#888",
    borderBottomStyle: "dotted",
    paddingVertical: 0.25 * MM,
  },
  feeTotal: { fontWeight: 700 },
});

function tradeLicenceBody(
  ctx: DocContext,
  qrDataUrl: string,
  emblemUrl: string | null,
  base: CertFamily,
) {
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
  const citizenParts = (which: "permanent" | "present") => {
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
    const rows: [string, string][] = bn
      ? [
          ["হোল্ডিং নম্বরঃ", ""],
          ["রোড নং", ""],
          ["গ্রাম/মহল্লা", text(free)],
          ["ডাকঘর", ""],
          ["পোস্ট কোড", ""],
          ["থানা", parts?.upazila?.bn ?? ""],
          ["উপজেলা", parts?.upazila?.bn ?? ""],
          ["জেলা", parts?.district?.bn ?? ""],
          ["বিভাগ", parts?.division?.bn ?? ""],
          ["দেশ", "বাংলাদেশ"],
        ]
      : [
          ["Holding No", ""],
          ["Road No", ""],
          ["Village/Area", text(free)],
          ["Post Office", ""],
          ["Post Code", ""],
          ["Police Station", parts?.upazila?.en ?? ""],
          ["Upazilla", parts?.upazila?.en ?? ""],
          ["District", parts?.district?.en ?? ""],
          ["Division", parts?.division?.en ?? ""],
          ["Country", "Bangladesh"],
        ];
    return rows.map(([label, value], i) => (
      <View key={i} style={tlStyles.addrRow}>
        <Text style={tlStyles.addrLabel}>
          <Runs segs={[seg(label)]} base={base} />
        </Text>
        <Text>
          <Runs segs={[seg(`: ${value}`)]} base={base} />
        </Text>
      </View>
    ));
  };
  const total = input.order ? money(input.order.totalMinor) : "";
  const totalDisplay = bn ? bnDigits(total) : total;
  const labels = bn
    ? {
        issueTitle: "লাইসেন্স ইস্যুর বিবরণ",
        issueDate: "ইস্যুর তারিখ",
        issueTime: "ইস্যুর সময়",
        statute: "ইউনিয়ন পরিষদ আদর্শ কর তফসিল ২০১৩ মোতাবেক",
        noLabel: "ট্রেড লাইসেন্স নং",
        fields: [
          "ব্যবসা প্রতিষ্ঠানের নাম", "মালিক/স্বত্বাধিকারীর নাম", "মাতার নাম", "পিতার নাম",
          "স্পাউজের নাম (প্রযোজ্য ক্ষেত্রে)", "ব্যবসার প্রকৃতি (একক/যৌথ/অন্যান্য)", "ব্যবসার ধরণ",
          "ব্যবসা প্রতিষ্ঠানের ঠিকানা",
        ],
        zone: "(ক) অঞ্চল (প্রযোজ্য ক্ষেত্রে)", ward: "(খ) ওয়ার্ড নং",
        idA: "(ক) জন্ম নিবন্ধন/এনআইডি/পাসপোর্ট নং", idB: "(খ) টিআইএন", idC: "(গ) বিআইএন",
        idD: "(ঘ) টেলিফোন/মোবাইল নম্বর", idE: "(ঙ) ই-মেইল",
        fyA: "(ক) অর্থ বছর", fyB: "(খ) ব্যবসা শুরুর তারিখ",
        presentHead: "মালিক/স্বত্বাধিকারীর বর্তমান ঠিকানা", permanentHead: "মালিক/স্বত্বাধিকারীর স্থায়ী ঠিকানা",
        serial: "আদর্শ কর তফসিল, ২০১৩ এর ক্রমিক নং",
        feeHead: "ট্রেড লাইসেন্স ফি (নতুন/নবায়ন)",
        feesL: ["নতুন", "নবায়ন", "বকেয়া", "সারচার্জ", "সংশোধন ফি"],
        feesR: ["সাইনবোর্ড (পরিচিতিমূলক)", "পেশা ব্যবসা ও বৃত্তির উপর কর", "ভ্যাট", "সর্বমোট"],
        nums: ["১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯", "১০", "১১", "১২", "১৩", "১৪"],
      }
    : {
        issueTitle: "License Issue Details",
        issueDate: "Date of Issue",
        issueTime: "Issue Time",
        statute: "According to Union Parishad Model Tax Schedule 2013",
        noLabel: "Trade License No",
        fields: [
          "Business Organization Name", "Owner's/Proprietor's Name", "Mother's Name", "Father's Name",
          "Spouse's Name (If applicable)", "Nature of Business (Individual/Joint/Others)", "Business Type",
          "Address of Business Organization",
        ],
        zone: "(a) Zone (If applicable)", ward: "(b) Ward No",
        idA: "(a) Birth Registration/NID/Passport", idB: "(b) TIN", idC: "(c) BIN",
        idD: "(d) Telephone/Mobile Number", idE: "(e) E-mail",
        fyA: "(a) Fiscal Year", fyB: "(b) Business Starting Date",
        presentHead: "Present Address of Owner/Proprietor", permanentHead: "Permanent Address of Owner/Proprietor",
        serial: "Serial No. of Model Taxation Schedule, 2013",
        feeHead: "Trade License Fee (New/Renewal)",
        feesL: ["New", "Renewal", "Arrear", "Surcharge", "Amendment Fee"],
        feesR: ["Signboard Fee", "Taxes on Profession & Trades", "VAT", "Total"],
        nums: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
      };
  const n = labels.nums;
  const businessType = selectLabel(input.schema ?? getServiceSchema(42), "business_type", undefined, p.business_type, bn);
  const field = (no: string, label: string, value: unknown, digits = false) => (
    <View style={tlStyles.row}>
      <Text style={tlStyles.fl}>
        <Runs segs={[seg(`${no}. ${label}`)]} base={base} bold />
      </Text>
      <Text style={tlStyles.fv}>
        <Runs segs={[seg(`: ${digits ? bnDigits(value) : text(value)}`)]} base={base} />
      </Text>
    </View>
  );
  const sub = (label: string, value: unknown, digits = false) => (
    <View style={tlStyles.row}>
      <Text style={[tlStyles.fl, tlStyles.flSub]}>
        <Runs segs={[seg(label)]} base={base} bold />
      </Text>
      <Text style={tlStyles.fv}>
        <Runs segs={[seg(`: ${digits ? bnDigits(value) : text(value)}`)]} base={base} />
      </Text>
    </View>
  );
  // v7 renders each pair as inline label+value spans inside one flex cell;
  // a single Text per pair reproduces that flow (separate label/value flex
  // children squeezed the value onto a second line and overflowed the page).
  const pairRow = (
    no: string,
    a: [string, string],
    b: [string, string],
  ) => (
    <View style={tlStyles.row}>
      <Text style={tlStyles.fl}>
        <Runs segs={[seg(no ? `${no}.` : "")]} base={base} bold />
      </Text>
      <View style={[tlStyles.fv, tlStyles.subpair]}>
        {[a, b].map(([label, value], i) => (
          <Text key={i} style={tlStyles.pair}>
            <Runs segs={[seg(`${label}: ${value}`)]} base={base} />
          </Text>
        ))}
      </View>
    </View>
  );
  return (
    <View>
      <View style={tlStyles.top}>
        <Image style={tlStyles.qrTl} src={qrDataUrl} />
        <View style={tlStyles.head}>
          <Text style={tlStyles.officeName}>
            <Runs segs={[seg(ctx.officeName)]} base={base} bold />
          </Text>
          <Text style={tlStyles.officeAddress}>
            <Runs segs={[seg(ctx.officeAddressLine)]} base={base} />
          </Text>
          {emblemUrl ? <Image style={styles.emblem} src={emblemUrl} /> : null}
          <Text style={tlStyles.docTitle}>
            <Runs segs={[seg(bn ? input.service.name_bn : input.service.name_en)]} base={base} bold />
          </Text>
          <Text style={tlStyles.tlNo}>
            <Runs segs={[seg(`${labels.noLabel}: ${ctx.numberDisplay}`)]} base={base} bold />
          </Text>
        </View>
        <View style={tlStyles.spacer} />
      </View>
      <View style={tlStyles.issue}>
        <Text style={{ fontWeight: 700 }}>
          <Runs segs={[seg(labels.issueTitle)]} base={base} bold />
        </Text>
        <Text>
          <Runs segs={[seg(`${labels.issueDate}: ${bn ? bnDate(issued) : enDate(issued)}`)]} base={base} />
        </Text>
        <Text>
          <Runs
            segs={[seg(`${labels.issueTime}: ${bn ? bnDigits(issueTime(issued)) : issueTime(issued)}`)]}
            base={base}
          />
        </Text>
      </View>
      <Text style={tlStyles.statute}>
        <Runs segs={[seg(labels.statute)]} base={base} bold />
      </Text>
      <View style={tlStyles.fields}>
        {field(n[0]!, labels.fields[0]!, bn ? p.business_name_bn : p.business_name_en)}
        {field(n[1]!, labels.fields[1]!, bn ? p.proprietor_name_bn : p.proprietor_name_en)}
        {field(n[2]!, labels.fields[2]!, bn ? p.proprietor_mother_name_bn : p.proprietor_mother_name)}
        {field(n[3]!, labels.fields[3]!, bn ? p.proprietor_father_name_bn : p.proprietor_father_name)}
        {field(n[4]!, labels.fields[4]!, bn ? p.proprietor_spouse_name_bn : p.proprietor_spouse_name)}
        {field(n[5]!, labels.fields[5]!, bn ? p.trade_license_org_type_bn : p.trade_license_org_type)}
        {field(n[6]!, labels.fields[6]!, businessType)}
        {field(n[7]!, labels.fields[7]!, businessAddress)}
        {pairRow(n[8]!, [labels.zone, bn ? bnDigits(text(p.trade_license_org_zone_bn) || text(p.trade_license_org_zone)) : text(p.trade_license_org_zone)], [labels.ward, bn ? bnDigits(wardNo) : text(wardNo)])}
        {pairRow(n[9]!, [labels.idA, bn ? bnDigits(identityNo) : text(identityNo)], [labels.idB, bn ? bnDigits(text(p.trade_license_tin_no)) : text(p.trade_license_tin_no)])}
        {pairRow("", [labels.idC, bn ? bnDigits(text(p.trade_license_bin_no)) : text(p.trade_license_bin_no)], [labels.idD, bn ? bnDigits(text(p.mobile)) : text(p.mobile)])}
        {sub(labels.idE, p.trade_license_email)}
        {pairRow(n[10]!, [labels.fyA, bn ? bnDigits(`${fy.start} - ${fy.end}`) : `${fy.start} - ${fy.end}`], [labels.fyB, bn ? bnDateIso(p.start_date) : enDateIso(p.start_date)])}
        <View style={tlStyles.row}>
          <Text style={tlStyles.fl}>
            <Runs segs={[seg(`${n[11]}.`)]} base={base} bold />
          </Text>
          <View style={[tlStyles.fv, tlStyles.addrHeads]}>
            <Text style={tlStyles.addrHead}>
              <Runs segs={[seg(labels.presentHead)]} base={base} bold />
            </Text>
            <Text style={tlStyles.addrHead}>
              <Runs segs={[seg(labels.permanentHead)]} base={base} bold />
            </Text>
          </View>
        </View>
        <View style={tlStyles.row}>
          <Text style={tlStyles.fl}>
            <Runs segs={[seg("")]} base={base} />
          </Text>
          <View style={[tlStyles.fv, tlStyles.addrCols]}>
            <View style={tlStyles.addrCol}>{citizenParts("present")}</View>
            <View style={tlStyles.addrCol}>{citizenParts("permanent")}</View>
          </View>
        </View>
        {field(n[12]!, labels.serial, "")}
        <View style={tlStyles.row}>
          <Text style={tlStyles.fl}>
            <Runs segs={[seg(`${n[13]}. ${labels.feeHead}`)]} base={base} bold />
          </Text>
          <Text style={tlStyles.fv}>
            <Runs segs={[seg("")]} base={base} />
          </Text>
        </View>
        <View style={tlStyles.fees}>
          <View style={tlStyles.feesCol}>
            {labels.feesL.map((label) => (
              <View key={label} style={tlStyles.feeRow}>
                <Text>
                  <Runs segs={[seg(label)]} base={base} />
                </Text>
                <Text>
                  <Runs segs={[seg("")]} base={base} />
                </Text>
              </View>
            ))}
          </View>
          <View style={tlStyles.feesCol}>
            {labels.feesR.map((label, i) => (
              <View key={label} style={[tlStyles.feeRow, i === 3 ? tlStyles.feeTotal : {}]}>
                <Text>
                  <Runs segs={[seg(label)]} base={base} bold={i === 3} />
                </Text>
                <Text>
                  <Runs segs={[seg(i === 3 ? totalDisplay : "")]} base={base} bold={i === 3} />
                </Text>
              </View>
            ))}
          </View>
        </View>
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
  const seal = ctx.official
    ? officeSealDataUrls(input.tenant.id)
    : { seal: null, watermark: null };
  const title =
    serviceNo === 47
      ? text(bn ? input.payload.certificate_type_bn : input.payload.certificate_type_en) ||
        (bn ? input.service.name_bn : input.service.name_en)
      : bn
        ? input.service.name_bn
        : input.service.name_en;

  const dims = PAGE_POINTS[format.size]!;
  const pageW = format.orientation === "landscape" ? dims.h : dims.w;
  const pageH = format.orientation === "landscape" ? dims.w : dims.h;
  const margin = (isTrade ? 8 : 11) * MM;

  let sealNode: React.ReactNode = null;
  if (seal.watermark) {
    const widthMm = format.orientation === "landscape" ? 92 : 80;
    const width = widthMm * MM;
    const size = pngSize(seal.watermark);
    const height = size ? (width * size.h) / size.w : width;
    sealNode = (
      <Image
        fixed
        src={seal.watermark}
        style={{
          position: "absolute",
          left: (pageW - width) / 2,
          top: pageH * 0.54 - height / 2,
          width,
          height,
        }}
      />
    );
  }

  const body = isTrade ? (
    tradeLicenceBody(ctx, qrDataUrl, emblemUrl, base)
  ) : FORM_SERVICES.has(serviceNo) ? (
    <>
      <HeaderBlock ctx={ctx} title={title} emblemUrl={emblemUrl} base={base} />
      {genericFormBody(ctx, base)}
    </>
  ) : (
    <>
      <HeaderBlock ctx={ctx} title={title} emblemUrl={emblemUrl} base={base} />
      <View style={styles.numline}>
        <Text>
          <Runs
            segs={[seg(`${bn ? "সনদ নং:-" : "Certificate No:"} ${ctx.numberDisplay}`)]}
            base={base}
            bold
          />
        </Text>
        <Text>
          <Runs
            segs={[
              seg(
                `${bn ? "ইস্যুর তারিখ:-" : "Date of Issue:"} ${bn ? bnDate(ctx.issued) : enDate(ctx.issued)}`,
              ),
            ]}
            base={base}
            bold
          />
        </Text>
      </View>
      {paragraphBody(ctx, serviceNo, base)}
    </>
  );

  return (
    <Document>
      <Page
        size={format.size === "A4" ? "A4" : "LETTER"}
        orientation={format.orientation}
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
            // Bottom reserve is the frame margin alone: Chromium's per-page
            // break geometry is the @page margin (the CSS main padding-bottom
            // applies only at the document end); a larger reserve here makes
            // react-pdf emit a blank trailing page when content ends near
            // the frame. The extra −3pt absorbs layout rounding so a full
            // page does not spawn an empty continuation page.
            paddingBottom: margin - 3,
            paddingLeft: margin + 6 * MM,
            paddingRight: margin + 6 * MM,
          }}
        >
          {body}
          <SignBlock ctx={ctx} base={base} compact={isTrade} />
          <DocFooter ctx={ctx} qrDataUrl={qrDataUrl} base={base} trade={isTrade} />
        </View>
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
