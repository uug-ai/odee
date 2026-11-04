import { defineConfig } from '@playwright/test'
import { join } from 'node:path'

export default defineConfig({
  testDir: '.',
  testMatch: ['**/company.fixture.ts', '**/local-transport.spec.ts'],
  workers: 1,
  timeout: 90000,
  outputDir: process.env.ODEE_TEST_SCRATCH_DIR
    ? join(process.env.ODEE_TEST_SCRATCH_DIR, 'company-browser-artifacts')
    : undefined,
  use: { trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 10000 },
})
