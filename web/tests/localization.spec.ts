import { test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { repositoryRoot, safeTestEnvironment } from './test-environment.mjs'

for (const locale of ['en', 'nl']) {
  test(`${locale}: protected Mongo/OAuth create/review/post/payment, invalid money provenance and permissions`, async () => {
    test.setTimeout(240000)
    const scratch = join(repositoryRoot, '.local-data', 'localization-spec', randomUUID())
    const environment = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
    const child = spawn(
      process.execPath,
      ['web/tests/localization.mjs', '--browser-only', `--locale=${locale}`],
      {
        cwd: repositoryRoot,
        env: {
          ...environment,
          PLAYWRIGHT_BROWSERS_PATH:
            process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright'),
          MONGOMS_DOWNLOAD_DIR:
            process.env.MONGOMS_DOWNLOAD_DIR || join(homedir(), '.cache', 'mongodb-binaries'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 210000)
    let output = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data) => {
        output += data
      })
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', resolve)
      })
      if (timedOut || code !== 0)
        throw new Error(`Protected ${locale} localization failed:\n${output}`)
      console.log(output)
    } finally {
      clearTimeout(timeout)
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((resolve) => child.once('close', () => resolve()))
      }
      await rm(scratch, { recursive: true, force: true })
    }
  })
}
