import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['**/company.spec.ts', '**/local-transport.spec.ts'],
  workers: 1,
  timeout: 90000,
  use: { trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 10000 },
})
