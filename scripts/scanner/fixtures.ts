import { antivirusTestBytes } from "./clamd.js";
/** Synthetic PDF with a real EmbeddedFile stream, constructed in memory. Never
 * save or render the antivirus fixture. It is a harmless scanner test only. */
export function antivirusPdfFixture() {
  const test = antivirusTestBytes();
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(antivirus-test.txt) 4 0 R] >> >> >>'),
    Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'),
    Buffer.from('<< /Type /Filespec /F (antivirus-test.txt) /EF << /F 5 0 R >> >>'),
    Buffer.concat([Buffer.from(`<< /Type /EmbeddedFile /Length ${test.length} >>\nstream\n`), test, Buffer.from('\nendstream')]),
  ];
  let result = Buffer.from('%PDF-1.4\n'); const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(result.length); result = Buffer.concat([result, Buffer.from(`${i+1} 0 obj\n`), objects[i], Buffer.from('\nendobj\n')]); }
  const xref = result.length;
  result = Buffer.concat([result, Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
  test.fill(0); return result;
}
