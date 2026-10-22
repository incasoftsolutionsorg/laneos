import { defineConfig } from 'vitest/config';

// Integration tests against the linked Supabase project. Reads apps/web/.env.local.
process.loadEnvFile('apps/web/.env.local');

export default defineConfig({
  test: {
    include: ['scripts/db-tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
