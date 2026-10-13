import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
const root = path.resolve('apps/web/dist/assets');
const assets = [];
for (const name of fs.readdirSync(root)) {
  if (!/\.(js|css|svg|woff2)$/.test(name)) continue;
  const bytes = fs.readFileSync(path.join(root, name));
  const gzip = gzipSync(bytes, { level: 9 });
  const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  fs.writeFileSync(path.join(root, name + '.gz'), gzip);
  fs.writeFileSync(path.join(root, name + '.br'), br);
  assets.push({ name, rawBytes: bytes.length, gzipBytes: gzip.length, brotliBytes: br.length });
}
fs.mkdirSync('execution', { recursive: true });
fs.writeFileSync('execution/asset-sizes.json', JSON.stringify({ measuredAt: new Date().toISOString(), assets }, null, 2));
console.log(JSON.stringify(assets));
