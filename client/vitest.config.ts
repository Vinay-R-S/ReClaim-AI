import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Separate from `vite.config.ts` on purpose.
 *
 * The build config loads its env from the repo root and splits vendor chunks;
 * neither means anything to a test run, and inheriting them made a test file
 * fail on a missing `.env` rather than on its own assertions.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    /**
     * One process, one jsdom at a time.
     *
     * The default pool spawns a worker per core and each one carries its own
     * jsdom; on a machine with enough cores that is enough resident memory to
     * crash a V8 worker outright, which fails the run for a reason that has
     * nothing to do with the tests.
     */
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
