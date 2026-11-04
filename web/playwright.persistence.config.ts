import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { testPort } from './tests/test-environment.mjs'

const port = testPort(process.env.ODEE_TEST_PORT ?? '')
const phase = process.env.ODEE_TEST_PERSISTENCE_PHASE
const scratch = process.env.ODEE_TEST_SCRATCH_DIR
if (
  !scratch ||
  !process.env.ODEE_TEST_PERSISTENCE_RUN ||
  !/^[a-f0-9]{64}$/.test(process.env.ODEE_API_TOKEN ?? '') ||
  (phase !== 'write' && phase !== 'read')
) {
  throw new Error('Run persistence validation with node web/tests/persistence.mjs')
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/persistence.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  globalTimeout: 90000,
  reporter: [['line']],
  outputDir: resolve(scratch, `playwright-${phase}`),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
  },
  // The runner starts and verifies its own exact-PID server. No webServer
  // discovery/reuse is allowed here, and auth material is never recorded.
})
