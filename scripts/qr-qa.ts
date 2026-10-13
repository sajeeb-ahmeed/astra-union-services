import fs from "node:fs";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { createRequire } from "node:module";
import type { QRCode } from "jsqr";
const jsQR = createRequire(import.meta.url)("jsqr") as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts: string },
) => QRCode | null;
const image = PNG.sync.read(
  fs.readFileSync("execution/browser-resident-demo.png"),
);
const qr = jsQR(new Uint8ClampedArray(image.data), image.width, image.height, {
  inversionAttempts: "dontInvert",
});
assert.ok(qr, "QR embedded in rendered certificate must decode");
const metadata = JSON.parse(
  fs.readFileSync("execution/browser-certificate.json", "utf8"),
);
assert.equal(qr.data, metadata.verificationUrl);
assert.match(new URL(qr.data).pathname, /^\/verify\/[a-f0-9]{64}$/);
const r = await fetch(qr.data.replace("/verify/", "/api/v1/verify/"));
assert.equal(r.status, 200);
const body = await r.json();
assert.equal(body.status, "ISSUED");
assert.deepEqual(
  Object.keys(body).sort(),
  [
    "status",
    "officeBn",
    "officeEn",
    "serviceNo",
    "serviceBn",
    "serviceEn",
    "issuedAt",
    "demo",
  ].sort(),
);
fs.writeFileSync(
  "execution/qr-qa.json",
  JSON.stringify(
    {
      decoded: true,
      matchedCertificateUrl: true,
      opaqueTokenBits: 256,
      httpStatus: r.status,
      publicFields: Object.keys(body),
      status: body.status,
    },
    null,
    2,
  ),
);
console.log(
  "PASS: rendered PDF QR decoded, URL matched, 256-bit opaque token and minimal public response verified.",
);
