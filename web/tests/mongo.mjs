import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repositoryRoot, safeTestEnvironment } from './test-environment.mjs'
import { mongoSelector, requireMongoResults } from './company-test-results.mjs'
import {
  bounded,
  command,
  installFixtureSignals,
  provisionMongoBinary,
  cleanFixtureData,
} from './owned-fixture.mjs'

installFixtureSignals()

async function isolated() {
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  const scratch = process.env.ODEE_TEST_SCRATCH_DIR
  const dbPath = join(scratch, 'mongo')
  await mkdir(dbPath)
  const mongoOptions = {
    binary: {
      version: '8.0.16',
      downloadDir: process.env.MONGOMS_DOWNLOAD_DIR,
      ...(process.platform === 'linux' && process.arch === 'arm64'
        ? { os: { os: 'linux', dist: 'ubuntu', release: '22.04' } }
        : {}),
    },
    instance: { ip: '127.0.0.1', dbPath },
    spawn: { env: process.env },
  }
  let server = await MongoMemoryServer.create(mongoOptions)
  async function verify(selector, phase = '') {
    const uri = server.getUri()
    if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Nonlocal MongoDB')
    const output = await command(
      'go',
      ['test', '-race', '-json', '-count=1', '-run', selector, './internal/accounting'],
      {
        ...process.env,
        ODEE_TEST_MONGODB_URI: uri,
        ODEE_TEST_RESTART_PHASE: phase,
      },
      join(scratch, `${phase || 'matrix'}-results.jsonl`),
    )
    const events = output
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
    const result = requireMongoResults(events, phase)
    console.log(JSON.stringify(result, null, 2))
    return result
  }
  try {
    const matrix = await verify(mongoSelector)
    const write = await verify('^TestMongoDiskPersistence$', 'write')
    const process = server.instanceInfo?.instance?.mongodProcess
    if (!process?.pid || process.pid < 1) throw new Error('Missing owned MongoDB PID')
    const exited = new Promise((resolve) => process.once('close', resolve))
    if (!process.kill('SIGKILL')) throw new Error(`Could not crash owned MongoDB ${process.pid}`)
    await bounded(exited, 20000, 'Owned MongoDB hard crash')
    await bounded(server.stop({ doCleanup: false }), 20000, 'MongoDB crash handle cleanup')
    // A crashed instance retains a dead child handle; reopen the same disk with a fresh owner.
    server = new MongoMemoryServer(mongoOptions)
    await bounded(server.start(), 20000, 'MongoDB disk restart start')
    const read = await verify('^TestMongoDiskPersistence$', 'read')
    await writeFile(
      join(scratch, 'summary.json'),
      JSON.stringify(
        { mongo: '8.0.16 standalone', diskRestart: true, hardCrash: true, matrix, write, read },
        null,
        2,
      ),
    )
  } finally {
    await bounded(server.stop({ doCleanup: false }), 20000, 'MongoDB shutdown')
  }
}

if (process.argv.includes('--isolated')) {
  await isolated()
} else {
  const scratch = join(repositoryRoot, '.local-data', 'mongo', randomUUID())
  const env = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
  try {
    const cache = await provisionMongoBinary(scratch)
    console.log(`Mongo regression evidence: ${scratch}`)
    await command(
      process.execPath,
      ['web/tests/mongo.mjs', '--isolated'],
      { ...env, MONGOMS_DOWNLOAD_DIR: cache, MONGOMS_MAX_RETRIES: '1' },
      undefined,
      600000,
    )
  } finally {
    await cleanFixtureData(scratch)
  }
}
