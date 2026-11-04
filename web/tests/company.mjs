import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, copyFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { safeTestEnvironment, reserveTestPort } from '../../tools/agents/workspace.mjs'
import { repositoryRoot as root } from './test-environment.mjs'
import { createLocalTransport } from './local-transport.mjs'

const children = new Set()
function run(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  let log = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      log += data
    })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      children.delete(child)
      resolve(code)
    })
  })
  return {
    child,
    done,
    log: () => log,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await done
    },
  }
}
async function command(program, args, env, file) {
  const task = run(program, args, env)
  const code = await task.done
  if (file) await writeFile(file, task.log())
  if (code !== 0)
    throw new Error(
      `${program} ${args.join(' ')} (${code})\n${file ? `Full output: ${file}\n${task.log().slice(-3500)}` : task.log()}`,
    )
  if (!file) console.log(task.log())
  return task.log()
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const child of children) child.kill('SIGTERM')
  })

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
    const binary = join(scratch, 'odee')
    await command('go', ['build', '-o', binary, './cmd/odee'], env)
    await command('go', ['vet', './internal/accounting', './cmd/odee'], env)
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
      ],
      {
        ...env,
        ODEE_COMPANY_TEST_ORIGIN: origin,
        ODEE_COMPANY_TEST_TOKEN: token,
      },
      join(scratch, 'browser.log'),
    )
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
      ],
      {
        ...env,
        ODEE_COMPANY_TEST_ORIGIN: origin,
        ODEE_COMPANY_TEST_TOKEN: token,
      },
      join(scratch, 'readonly-browser.log'),
    )
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
        },
        null,
        2,
      ),
    )
  } finally {
    if (api) await api.dispose()
    if (client) await client.close()
    if (app) await app.stop()
    if (transport) await transport.close()
    await mongo.stop()
  }
}

if (process.argv.includes('--isolated')) {
  await isolated()
} else {
  const scratch = join(root, '.local-data', 'odee007', randomUUID())
  const env = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
  const cache = join(scratch, 'mongodb-binaries')
  await mkdir(cache)
  const existing = join(homedir(), '.cache', 'mongodb-binaries')
  for (const name of await readdir(existing).catch(() => []))
    if (/^mongod-[a-zA-Z0-9._-]+-8\.0\.16$/.test(name))
      await copyFile(join(existing, name), join(cache, name))
  console.log(`ODEE-007 evidence: ${scratch}`)
  await command(process.execPath, ['web/tests/company.mjs', '--isolated'], {
    ...env,
    MONGOMS_DOWNLOAD_DIR: cache,
    MONGOMS_MAX_RETRIES: '1',
    PLAYWRIGHT_BROWSERS_PATH: join(homedir(), '.cache', 'ms-playwright'),
  })
}
