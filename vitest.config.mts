import { defineConfig } from 'vitest/config';

// One run covers every package and the web app (pnpm test).
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    environment: 'node',
  },
});
