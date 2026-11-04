import { test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { command } from './owned-fixture.mjs'
import { repositoryRoot, safeTestEnvironment } from './test-environment.mjs'

test('protected EN/NL configuration, frozen payments and read-only permissions on owned MongoDB', async () => {
  test.setTimeout(420000)
  const scratch = join(repositoryRoot, '.local-data', 'configuration-spec', randomUUID())
  const env = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
  let completed = false
  try {
    console.log(
      await command(
        process.execPath,
        ['web/tests/configuration.mjs', '--browser-only'],
        {
          ...env,
          PLAYWRIGHT_BROWSERS_PATH:
            process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright'),
          MONGOMS_DOWNLOAD_DIR:
            process.env.MONGOMS_DOWNLOAD_DIR || join(homedir(), '.cache', 'mongodb-binaries'),
        },
        join(scratch, 'adapter.log'),
        390000,
      ),
    )
    completed = true
  } finally {
    if (completed) await rm(scratch, { recursive: true, force: true })
  }
})
