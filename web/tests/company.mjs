import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { safeTestEnvironment, reserveTestPort } from '../../tools/agents/workspace.mjs'
import { repositoryRoot as root } from './test-environment.mjs'
import { createLocalTransport } from './local-transport.mjs'
import { requireCompanyResults } from './company-test-results.mjs'
import {
  command,
  run,
  bounded,
  installFixtureSignals,
  provisionMongoBinary,
  cleanFixtureData,
} from './owned-fixture.mjs'

const browserOnly = process.argv.includes('--browser-only')
installFixtureSignals()

async function isolated() {
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  const { MongoClient } = await import('mongodb')
  const { request } = await import('@playwright/test')
  const scratch = process.env.ODEE_TEST_SCRATCH_DIR
  const env = process.env
  const dbPath = join(scratch, 'mongo')
  await mkdir(dbPath)
  const mongo = await MongoMemoryServer.create({
    binary: {
      version: '8.0.16',
      downloadDir: env.MONGOMS_DOWNLOAD_DIR,
      ...(process.platform === 'linux' && process.arch === 'arm64'
        ? { os: { os: 'linux', dist: 'ubuntu', release: '22.04' } }
        : {}),
    },
    instance: { ip: '127.0.0.1', dbPath },
    spawn: { env },
  })
  let app, transport, api, client
  try {
    const uri = mongo.getUri()
    if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Nonlocal MongoDB')
    if (!browserOnly) {
      const goLog = await command(
        'go',
        ['test', '-race', '-json', '-count=1', './internal/accounting', './cmd/odee'],
        { ...env, ODEE_TEST_MONGODB_URI: uri },
        join(scratch, 'go-results.jsonl'),
      )
      const events = goLog
        .split('\n')
        .filter((s) => s.startsWith('{'))
        .map((s) => JSON.parse(s))
      for (const action of ['pass', 'skip', 'fail']) {
        const top = events.filter((e) => e.Test && !e.Test.includes('/') && e.Action === action)
        const sub = events.filter((e) => e.Test?.includes('/') && e.Action === action)
        console.log(
          `Go ${action}: ${top.length} top-level, ${sub.length} subcases`,
          action === 'skip' ? top.map((e) => e.Test) : '',
        )
      }
      await command('go', ['vet', './internal/accounting', './cmd/odee'], env)
    }
    const binary = join(scratch, 'odee')
    await command('go', ['build', '-o', binary, './cmd/odee'], env)
    const reservation = await reserveTestPort()
    const origin = `http://127.0.0.1:${reservation.port}`
    transport = await createLocalTransport([origin])
    const token = 'synthetic-odee007-token-not-a-real-credential'
    const appEnv = {
      ...env,
      ODEE_DEV_MODE: 'false',
      ODEE_DEMO: 'false',
      ODEE_AUTH_MODE: 'token',
      ODEE_API_TOKEN: token,
      ODEE_ADDR: `127.0.0.1:${reservation.port}`,
      ODEE_ORIGIN: origin,
      MONGODB_URI: uri,
      ODEE_AUTHZ_MODE: 'enforced',
      ODEE_WEB_DIR: join(root, 'web/dist'),
      ODEE_CAPABILITY_GRANTS: JSON.stringify([
        {
          principal: 'token:company',
          companyId: env.ODEE_COMPANY_ID,
          capabilities: ['read', 'write', 'post', 'admin'],
        },
      ]),
    }
    await reservation.release()
    async function start() {
      app = run(binary, [], appEnv)
      for (let attempt = 0; attempt < 100; attempt++) {
        if (app.child.exitCode !== null) throw new Error(app.log())
        try {
          if ((await transport.health(`${origin}/healthz`)).ok) return
        } catch {
          /* bounded startup readiness only */
        }
        await sleep(100)
      }
      throw new Error(`Owned app not ready\n${app.log()}`)
    }
    await start()
    await command(
      'npm',
      [
        '--prefix',
        'web',
        'run',
        'test:e2e',
        '--',
        '--config',
        'tests/company.config.ts',
        '--grep-invert',
        'read-only',
        '--reporter=line,json',
      ],
      {
        ...env,
        ODEE_COMPANY_TEST_ORIGIN: origin,
        ODEE_COMPANY_TEST_TOKEN: token,
        PLAYWRIGHT_JSON_OUTPUT_NAME: join(scratch, 'browser-results.json'),
      },
      join(scratch, 'browser.log'),
    )
    const browserChildren = requireCompanyResults(
      JSON.parse(await readFile(join(scratch, 'browser-results.json'), 'utf8')),
    )
    console.log('Executed browser children:', browserChildren)
    console.log('Protected EN/NL browser journeys and 10 destination guard tests passed.')
    api = await request.newContext({ proxy: transport.proxy })
    const state = async () => {
      const response = await transport.fetch(api, `${origin}/api/state`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.status() !== 200) throw new Error(`State ${response.status()}`)
      return response.json()
    }
    const before = await state()
    client = new MongoClient(uri)
    await client.connect()
    const raw = await client
      .db(env.MONGODB_DATABASE_ODEE)
      .collection('accounting_documents')
      .find({})
      .toArray()
    if (
      raw.length < 6 ||
      !raw.some((d) => d.partnerSnapshot?.sourceVersion >= 1 && d.financialEvents?.length === 1)
    )
      throw new Error('Stored Mongo snapshots/audit missing')
    for (const doc of before.documents) {
      const persisted = raw.find((item) => item._id.toHexString() === doc.id)
      if (!persisted || persisted.version !== doc.version || persisted.total !== doc.total)
        throw new Error('Stored document version/amount mismatch')
      if (doc.partnerSnapshot) {
        const snapshot = persisted.partnerSnapshot
        if (
          !snapshot ||
          snapshot.sourceVersion !== doc.partnerSnapshot.sourceVersion ||
          snapshot.schemaVersion !== 1 ||
          snapshot.data.name !== doc.partnerSnapshot.data.name ||
          snapshot.data.bankAccount !== doc.partnerSnapshot.data.bankAccount ||
          (snapshot.contactId?.toHexString() ?? '000000000000000000000000') !==
            doc.partnerSnapshot.contactId
        )
          throw new Error('Stored partner capture differs from independently observed version')
      }
      if (doc.ownCompanySnapshot) {
        const own = persisted.ownCompanySnapshot
        if (
          !own ||
          own.sourceVersion !== doc.ownCompanySnapshot.sourceVersion ||
          own.role !== doc.ownCompanySnapshot.role ||
          own.data.name !== doc.ownCompanySnapshot.data.name
        )
          throw new Error('Stored own-company capture mismatch')
      }
    }
    await writeFile(join(scratch, 'stored-snapshots.json'), JSON.stringify(raw, null, 2))
    await app.stop()
    await start()
    const after = await state()
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('State changed after application restart')
    console.log(
      `MongoDB 8.0.16 standalone persisted ${raw.length} documents across actual application restart.`,
    )
    await app.stop()
    appEnv.ODEE_CAPABILITY_GRANTS = JSON.stringify([
      { principal: 'token:company', companyId: env.ODEE_COMPANY_ID, capabilities: ['read'] },
    ])
    await start()
    await command(
      'npm',
      [
        '--prefix',
        'web',
        'run',
        'test:e2e',
        '--',
        '--config',
        'tests/company.config.ts',
        '--grep',
        'read-only',
        '--reporter=line,json',
      ],
      {
        ...env,
        ODEE_COMPANY_TEST_ORIGIN: origin,
        ODEE_COMPANY_TEST_TOKEN: token,
        PLAYWRIGHT_JSON_OUTPUT_NAME: join(scratch, 'readonly-browser-results.json'),
      },
      join(scratch, 'readonly-browser.log'),
    )
    const readonlyChildren = requireCompanyResults(
      JSON.parse(await readFile(join(scratch, 'readonly-browser-results.json'), 'utf8')),
      true,
    )
    console.log('Executed read-only children:', readonlyChildren)
    if (JSON.stringify(await state()) !== JSON.stringify(before))
      throw new Error('Read-only requests changed persisted state')
    console.log('Read-only EN/NL settings and HTTP 403/session/no-write proof passed.')
    if (transport.denied.length) throw new Error('Unexpected denied transport')
    await writeFile(
      join(scratch, 'summary.json'),
      JSON.stringify(
        {
          database: env.MONGODB_DATABASE_ODEE,
          documents: raw.length,
          restart: true,
          guardTests: 10,
          browserJourneys: 2,
          readonlyBrowserTests: 1,
          origin,
          mongo: '8.0.16 standalone',
          browserChildren,
          readonlyChildren,
          browserOnly,
        },
        null,
        2,
      ),
    )
  } finally {
    const cleanup = await Promise.allSettled([
      api && bounded(api.dispose(), 10000, 'Company API shutdown'),
      client && bounded(client.close(), 10000, 'Company Mongo client shutdown'),
      app && app.stop(),
      transport && bounded(transport.close(), 10000, 'Company transport shutdown'),
      bounded(mongo.stop(), 20000, 'Company MongoDB shutdown'),
    ])
    const errors = cleanup.filter((result) => result.status === 'rejected')
    if (errors.length)
      throw new AggregateError(
        errors.map((result) => result.reason),
        'Owned company cleanup failed',
      )
  }
}

if (process.argv.includes('--isolated')) {
  await isolated()
} else {
  const scratch = join(root, '.local-data', 'odee007', randomUUID())
  const env = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
  try {
    const cache = await provisionMongoBinary(scratch)
    console.log(`ODEE-007 evidence: ${scratch}`)
    await command(
      process.execPath,
      ['web/tests/company.mjs', '--isolated', ...process.argv.slice(2)],
      {
        ...env,
        MONGOMS_DOWNLOAD_DIR: cache,
        MONGOMS_MAX_RETRIES: '1',
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright'),
      },
      undefined,
      browserOnly ? 300000 : 600000,
    )
  } finally {
    await cleanFixtureData(scratch)
  }
}
