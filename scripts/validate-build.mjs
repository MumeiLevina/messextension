import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateBuild(dir) {
  const m = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.type, 'module');
  assert.deepEqual(m.host_permissions, ['https://www.facebook.com/*']);
  assert(!m.permissions.includes('<all_urls>'));
  assert(m.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'"));
  for (const path of [m.background.service_worker, m.side_panel.default_path, ...Object.values(m.icons), ...m.content_scripts.flatMap(c => c.js), 'ocr/worker.min.js', 'ocr/core/tesseract-core-lstm.wasm.js', 'ocr/core/tesseract-core-lstm.wasm', 'ocr/tessdata/vie.traineddata.gz', 'ocr/tessdata/eng.traineddata.gz']) assert(existsSync(resolve(dir, path)), `Missing extension asset: ${path}`);
  const content = readFileSync(resolve(dir, 'content.js'), 'utf8');
  assert(!/^\s*import\s/m.test(content), 'Content script must be a classic script');
  const html = readFileSync(resolve(dir, m.side_panel.default_path), 'utf8');
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) assert(existsSync(resolve(dir, path)), `Missing panel asset: ${path}`);
  console.log(`MV3 build validated: ${dir}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) validateBuild(resolve(process.argv[2] ?? 'dist'));
