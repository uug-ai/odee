import { billFixtures } from './fixtures.mjs'
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const directory = await billFixtures()
try {
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      'go',
      [
        'test',
        '-race',
        '-count=1',
        '-run',
        'TestLocalScanner|TestExtractBill|TestBillUpload|TestUploadFailure',
        './internal/accounting',
      ],
      {
        cwd: '..',
        stdio: 'inherit',
        env: { ...process.env, GOWORK: 'off', ODEE_TEST_FIXTURES: directory },
      },
    )
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
} finally {
  await rm(directory, { recursive: true })
}
