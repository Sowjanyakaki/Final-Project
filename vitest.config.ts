import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    environmentMatchGlobs: [
      ['components/**', 'jsdom'],
      ['app/**', 'jsdom'],
    ],
  },
});
