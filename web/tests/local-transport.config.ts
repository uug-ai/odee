import { defineConfig } from '@playwright/test'

// These tests own every listener; do not start an application readiness probe.
export default defineConfig({
  testDir: '.',
  testMatch: '**/local-transport.spec.ts',
  workers: 1,
  use: { trace: 'off', screenshot: 'off', video: 'off' },
})
