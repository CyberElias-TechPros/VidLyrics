import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/web/tests/**/*.test.ts', 'worker/tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['apps/web/src/core/**', 'worker/src/**'] },
    reporters: ['default']
  }
});
