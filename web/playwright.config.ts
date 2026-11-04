import { defineConfig } from '@playwright/test'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  browserEnvironment,
  isolatedCommand,
  repositoryRoot,
  testPort,
} from './tests/test-environment.mjs'

const port = testPort()
const ownsScratch = !process.env.ODEE_TEST_BROWSER_SCRATCH
const environment = browserEnvironment(port, process.env.ODEE_TEST_BROWSER_SCRATCH)
const baseURL = environment.ODEE_ORIGIN

// Synthetic fixture/browser files must also stay inside this run's scratch.
process.env.ODEE_TEST_BROWSER_SCRATCH = environment.ODEE_TEST_SCRATCH_DIR
for (const key of ['TMPDIR', 'TMP', 'TEMP']) process.env[key] = environment[key]
if (ownsScratch) {
  process.once('exit', () => {
    const scratch = environment.ODEE_TEST_SCRATCH_DIR
    // --list or a refused occupied port never starts the owned server.
    if (!existsSync(resolve(scratch, '.synthetic-owner')))
      rmSync(scratch, { recursive: true, force: true })
  })
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/persistence.spec.ts',
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: isolatedCommand({ ...environment, ODEE_TEST_PORT: String(port) }, [
      process.execPath,
      'web/tests/persistence.mjs',
      '--demo-server',
    ]),
    cwd: repositoryRoot,
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 300000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 },
  },
})
