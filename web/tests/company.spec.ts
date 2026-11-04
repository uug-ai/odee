import { test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { command } from './owned-fixture.mjs'
import { repositoryRoot, safeTestEnvironment } from './test-environment.mjs'

test('protected EN/NL company snapshots and read-only permissions on owned MongoDB', async () => {
  test.setTimeout(360000)
  const scratch = join(repositoryRoot, '.local-data', 'company-spec', randomUUID())
  const environment = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
  let completed = false
  try {
    const output = await command(
      process.execPath,
      ['web/tests/company.mjs', '--browser-only'],
      {
        ...environment,
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright'),
        MONGOMS_DOWNLOAD_DIR:
          process.env.MONGOMS_DOWNLOAD_DIR || join(homedir(), '.cache', 'mongodb-binaries'),
      },
      join(scratch, 'adapter.log'),
      330000,
    )
    console.log(output)
    completed = true
  } finally {
    if (completed) await rm(scratch, { recursive: true, force: true })
  }
})
