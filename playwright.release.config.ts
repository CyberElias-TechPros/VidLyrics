import { defineConfig } from '@playwright/test';

// Deliberately separate from the lightweight PR suite. Test the built worker,
// real model chunks, browser storage and codecs, not a simulated TTS response.
export default defineConfig({
  testDir: './release-tests',
  timeout: 180_000,
  workers: 1,
  use: {
    actionTimeout: 15000,
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH }
  },
  webServer: {
    command: 'npm run preview --workspace apps/web -- --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI
  }
});
