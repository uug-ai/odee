import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
export default defineConfig({
  testDir: '.',
  testMatch: ['**/configuration.fixture.ts', '**/local-transport.spec.ts'],
  workers: 1,
  timeout: 120000,
  outputDir: process.env.ODEE_TEST_SCRATCH_DIR
    ? join(process.env.ODEE_TEST_SCRATCH_DIR, 'configuration-browser-artifacts')
    : undefined,
  use: { trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 10000 },
})
