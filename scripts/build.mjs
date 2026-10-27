import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateBuild } from './validate-build.mjs';

const stamp = Date.now();
const next = resolve(`.artifacts/build-${stamp}`);
mkdirSync(next, { recursive: true });
for (const config of ['vite.config.ts', 'vite.content.config.ts']) {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', config], { stdio: 'inherit', env: { ...process.env, ECHO_BUILD_DIR: next } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
validateBuild(next);
if (existsSync('dist')) renameSync('dist', resolve(`.artifacts/previous-dist-${stamp}`));
renameSync(next, resolve('dist'));
console.log('Extension ready in ' + resolve('dist') + '; previous build preserved in .artifacts.');
