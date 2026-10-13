import fs from "node:fs";
import {
  generatePdf,
  closePdfBrowser,
  DEMO_TEMPLATE_VERSION,
} from "../src/pdf.js";
import {
  serviceCatalog,
  getServiceSchema,
  getDemoPayload,
} from "@astra/shared-schemas";
const results = [];
for (const no of [2, 42]) {
  const service = serviceCatalog.find((s) => s.service_no === no)!;
  const pdf = await generatePdf({
    number: `DEMO-LAYOUT-${no}`,
    verificationUrl: `http://127.0.0.1:5173/verify/${"0".repeat(64)}`,
    tenant: { name_bn: "ডেমো আলফা ইউনিয়ন", name_en: "Demo Alpha Union" },
    service: {
      service_no: no,
      name_bn: service.name_bn,
      name_en: service.name_en,
    },
    citizen: {
      full_name_bn: "ডেমো নাগরিক",
      full_name_en: "Demo Citizen",
      address_bn: "ডেমো গ্রাম, ডেমো ইউনিয়ন",
      address_en: "Demo village, demo union",
    },
    payload: getDemoPayload(no),
    schema: getServiceSchema(no),
  });
  const path = `execution/template-v${DEMO_TEMPLATE_VERSION}-layout-${no}.pdf`;
  fs.writeFileSync(path, pdf);
  results.push({
    serviceNo: no,
    templateVersion: DEMO_TEMPLATE_VERSION,
    path,
    bytes: pdf.length,
    scope:
      "Standalone layout QA; no certificate or ledger mutation; sample QR intentionally unregistered.",
  });
}
await closePdfBrowser();
console.log(JSON.stringify(results, null, 2));
