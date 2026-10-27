import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // jsdom fixture construction and CSS/layout benchmarks share CPU and memory.
    // Serialize files so their existing time limits measure the workload itself.
    fileParallelism: false,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/benchmarks/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    reporters: ['default'],
  },
});
