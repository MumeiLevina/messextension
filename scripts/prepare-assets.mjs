import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

// A small deterministic icon generator, with no native image dependency.
function png(size) {
  const crc = (b) => { let c = -1; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const n = Buffer.alloc(4); n.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, c]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + x * 4 + 1;
    const mark = x > size * .24 && x < size * .73 && ((y > size * .23 && y < size * .34) || (y > size * .45 && y < size * .55) || (y > size * .67 && y < size * .78) || x < size * .36);
    pixels.set(mark ? [255, 255, 255, 255] : [34, 88, 110, 255], i);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export function prepareAssets(out) {
  for (const dir of ['icons', 'ocr/core', 'ocr/tessdata']) mkdirSync(resolve(out, dir), { recursive: true });
  for (const size of [16, 48, 128]) writeFileSync(resolve(out, `icons/icon${size}.png`), png(size));
  copyFileSync('node_modules/tesseract.js/dist/worker.min.js', resolve(out, 'ocr/worker.min.js'));
  for (const name of ['tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm']) {
    copyFileSync(resolve('node_modules/tesseract.js-core', name), resolve(out, 'ocr/core', name));
  }
  for (const lang of ['vie', 'eng']) copyFileSync(resolve(`node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`), resolve(out, `ocr/tessdata/${lang}.traineddata.gz`));
}
