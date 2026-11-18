// Prints the expected Bangla attestation probe string per service (JSON),
// evaluated exactly as template v7 evaluates it (functions get the demo
// payload). Used by the proof-pack QA checklist.
import { ATTESTATIONS_BN } from "./apps/api/src/certificate-template-v7.ts";
import { demoPayloads } from "@astra/shared-schemas";

const out: Record<number, string> = {};
for (let n = 1; n <= 47; n++) {
  const a = (ATTESTATIONS_BN as any)[n];
  let s = typeof a === "function" ? a(demoPayloads[n]) : (a ?? "");
  if (n === 47) s = String((demoPayloads[47] as any).certificate_details_bn ?? s);
  out[n] = String(s).slice(0, 30);
}
console.log(JSON.stringify(out, null, 1));
