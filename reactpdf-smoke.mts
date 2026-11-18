// REACTPDF-MIGRATION-01 smoke driver (temporary QA script, not shipped code).
// Renders the template-v7 test fixture (Belabo office, official mode) for a
// set of services through BOTH engines into /tmp/reactpdf-smoke/.
import fs from "node:fs";
import path from "node:path";
import { demoPayloads, getServiceSchema, getService } from "@astra/shared-schemas";

process.env.ISSUANCE_MODE = "official";
process.env.CERTIFICATE_OFFICE_ASSETS_DIR = path.join(
  process.cwd(),
  "apps/api/assets/offices/belabo-up",
);

const { generatePdf } = await import("./apps/api/src/pdf.ts");
type PdfInput = import("./apps/api/src/certificate-template.ts").PdfInput;

const belabo = {
  verificationUrl: "https://belabo.astra.test/verify/abc123",
  tenant: {
    id: "belabo-tenant",
    name_bn: "বেলাবো ইউনিয়ন পরিষদ",
    name_en: "Belabo Union Parishad",
  },
  citizen: {
    full_name_bn: "আফসানা আক্তার মীম",
    full_name_en: "Afsana Akter Mim",
    address_bn: "বেলাব গাংকুল পাড়া",
    address_en: "Belab Gangkul Para",
    father_name_bn: "মোঃ আসাদুজ্জামান",
    father_name_en: "Md Asaduzzaman",
    mother_name_bn: "মুক্তি বেগম",
    mother_name_en: "Mukti Begum",
  },
  issuer: {
    nameBn: "মোঃ হাবিবুর রহমান",
    nameEn: "MD HABIBUR RAHMAN",
    accountType: "up_panel_chairman",
  },
  issuedAt: "2026-10-12T09:25:00+06:00",
  identity: { nid: "2405134038" },
  citizenGeography: {
    permanent: {
      division: { bn: "ঢাকা", en: "Dhaka" },
      district: { bn: "নরসিংদী", en: "Narsingdi" },
      upazila: { bn: "বেলাবো", en: "Belabo" },
      union: { bn: "বেলাবো", en: "Belabo" },
      wardNo: 3,
    },
  },
  officeGeography: {
    upazila: { bn: "বেলাবো", en: "Belabo" },
    district: { bn: "নরসিংদী", en: "Narsingdi" },
  },
} as unknown as PdfInput;

const services = (process.env.SMOKE_SERVICES ?? "12,42,2,3,45,47,1,37")
  .split(",")
  .map(Number);
const outDir = "/tmp/reactpdf-smoke";
fs.mkdirSync(outDir, { recursive: true });

for (const engine of ["react-pdf", "chromium"] as const) {
  process.env.PDF_ENGINE = engine;
  for (const no of services) {
    const svc = getService(no) as any;
    const input = {
      ...belabo,
      number: `2026-SMOKE${no}-AB12`,
      service: {
        service_no: no,
        name_bn: svc?.name_bn ?? svc?.nameBn ?? `সেবা ${no}`,
        name_en: svc?.name_en ?? svc?.nameEn ?? `Service ${no}`,
      },
      payload: { ...demoPayloads[no] },
      schema: getServiceSchema(no),
      order: no === 42 ? { totalMinor: 75000 } : undefined,
    } as PdfInput;
    const t0 = Date.now();
    try {
      const pdf = await generatePdf(input);
      const file = path.join(outDir, `${engine}-svc${no}.pdf`);
      fs.writeFileSync(file, pdf);
      console.log(`${engine} svc${no}: OK ${pdf.length} bytes ${Date.now() - t0}ms`);
    } catch (error) {
      console.log(`${engine} svc${no}: FAIL ${(error as Error).message}`);
    }
  }
}
const { closePdfBrowser } = await import("./apps/api/src/pdf.ts");
await closePdfBrowser();
process.exit(0);
