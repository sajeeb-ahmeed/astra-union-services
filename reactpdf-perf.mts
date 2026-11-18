// REACTPDF-MIGRATION-01 — perf probe: N sequential renders of two fixture
// certificates (services 12 + 45) under the react-pdf engine, in-process.
// Run under the spike's measure.py wrapper for wall time + peak RSS:
//   python3 measure.py npx tsx reactpdf-perf.mts 1
//   python3 measure.py npx tsx reactpdf-perf.mts 5
import path from "node:path";
import { demoPayloads, getServiceSchema } from "@astra/shared-schemas";

process.env.ISSUANCE_MODE = "official";
process.env.CERTIFICATE_OFFICE_ASSETS_DIR = path.join(
  process.cwd(),
  "apps/api/assets/offices/belabo-up",
);
process.env.PDF_ENGINE = "react-pdf";

const { generatePdf } = await import("./apps/api/src/pdf.ts");
type PdfInput = import("./apps/api/src/certificate-template.ts").PdfInput;

const belabo = {
  verificationUrl: "https://belabo.astra.test/verify/abc123",
  tenant: { id: "belabo-tenant", name_bn: "বেলাবো ইউনিয়ন পরিষদ", name_en: "Belabo Union Parishad" },
  citizen: {
    full_name_bn: "আফসানা আক্তার মীম", full_name_en: "Afsana Akter Mim",
    address_bn: "বেলাব গাংকুল পাড়া", address_en: "Belab Gangkul Para",
    father_name_bn: "মোঃ আসাদুজ্জামান", father_name_en: "Md Asaduzzaman",
    mother_name_bn: "মুক্তি বেগম", mother_name_en: "Mukti Begum",
  },
  issuer: { nameBn: "মোঃ হাবিবুর রহমান", nameEn: "MD HABIBUR RAHMAN", accountType: "up_panel_chairman" },
  issuedAt: "2026-10-12T09:25:00+06:00",
  identity: { nid: "2405134038" },
  citizenGeography: {
    permanent: {
      division: { bn: "ঢাকা", en: "Dhaka" }, district: { bn: "নরসিংদী", en: "Narsingdi" },
      upazila: { bn: "বেলাবো", en: "Belabo" }, union: { bn: "বেলাবো", en: "Belabo" }, wardNo: 3,
    },
  },
  officeGeography: {
    upazila: { bn: "বেলাবো", en: "Belabo" }, district: { bn: "নরসিংদী", en: "Narsingdi" },
  },
} as unknown as PdfInput;

const rounds = Number(process.argv[2] ?? "1");
let total = 0;
for (let i = 0; i < rounds; i++) {
  for (const no of [12, 45]) {
    const t0 = Date.now();
    const pdf = await generatePdf({
      ...belabo,
      number: `2026-PERF${no}-AB12`,
      service: { service_no: no, name_bn: `সেবা ${no}`, name_en: `Service ${no}` },
      payload: { ...demoPayloads[no] },
      schema: getServiceSchema(no),
    } as PdfInput);
    total += pdf.length;
    console.log(`render ${i + 1} svc${no}: ${Date.now() - t0}ms (${pdf.length} bytes)`);
  }
}
console.log(`total bytes: ${total}`);
process.exit(0);
