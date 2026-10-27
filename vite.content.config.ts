import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The content script must be a single classic script (MV3 content scripts do not
// support ES module imports), so it is built in IIFE format with no code splitting.
export default defineConfig({
  root: resolve(__dirname, 'extension'),
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: process.env.ECHO_BUILD_DIR ?? resolve(__dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome120',
    minify: 'esbuild',
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'extension/src/content/content-script.ts'),
      formats: ['iife'],
      name: 'EchoContent',
      fileName: () => 'content.js',
    },
  },
});
