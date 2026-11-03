import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Always provision a disposable local instance, never read a live database URI.
const binary = {
  version: '8.0.16',
  ...(process.platform === 'linux' && process.arch === 'arm64'
    ? { os: { os: 'linux', dist: 'ubuntu', release: '22.04' } }
    : {}),
}
const server = await MongoMemoryServer.create({ binary })
const documentsDirectory = join(server.instanceInfo.dbPath, 'document-originals')
async function verify(selector, phase = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'go',
      ['test', '-race', '-count=1', '-run', selector, './internal/accounting'],
      {
        cwd: '..',
        stdio: 'inherit',
        env: {
          ...process.env,
          GOWORK: 'off',
          ODEE_TEST_MONGODB_URI: server.getUri(),
          ODEE_TEST_RESTART_PHASE: phase,
          ODEE_TEST_DOCUMENTS_DIR: documentsDirectory,
        },
      },
    )
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}
try {
  await mkdir(documentsDirectory)
  process.exitCode = await verify('TestMongo')
  if (!process.exitCode) {
    process.exitCode = await verify('TestMongo.*DiskPersistence', 'write')
    if (!process.exitCode) {
      await server.stop({ doCleanup: false })
      await server.start()
      process.exitCode = await verify('TestMongo.*DiskPersistence', 'read')
    }
  }
} finally {
  await server.stop()
}
