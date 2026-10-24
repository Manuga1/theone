import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('./shared', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@shared': shared } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
