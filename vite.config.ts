import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { prepareAssets } from './scripts/prepare-assets.mjs';

const root = resolve(__dirname, 'extension');

export default defineConfig({
  root,
  base: './',
  plugins: [
    react(),
    {
      name: 'echo-copy-static',
      closeBundle() {
        const out = process.env.ECHO_BUILD_DIR ?? resolve(__dirname, 'dist');
        mkdirSync(out, { recursive: true });
        copyFileSync(resolve(root, 'manifest.json'), resolve(out, 'manifest.json'));
        prepareAssets(out);
      },
    },
  ],
  build: {
    outDir: process.env.ECHO_BUILD_DIR ?? resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'sidepanel.html'),
        background: resolve(root, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
