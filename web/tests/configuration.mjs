import assert from 'node:assert/strict'
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

installFixtureSignals()
async function isolated() {
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  const { request } = await import('@playwright/test')
  const env = process.env,
    scratch = env.ODEE_TEST_SCRATCH_DIR
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
  let app, transport, api
  try {
    const uri = mongo.getUri()
    assert.ok(uri.startsWith('mongodb://127.0.0.1:'))
    const binary = join(scratch, 'odee')
    await command('go', ['build', '-o', binary, './cmd/odee'], env)
    const reservation = await reserveTestPort()
    const origin = `http://127.0.0.1:${reservation.port}`
    transport = await createLocalTransport([origin])
    const token = 'synthetic-odee008-not-a-real-credential'
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
    }
    const grant = (capabilities) =>
      JSON.stringify([{ principal: 'token:company', companyId: env.ODEE_COMPANY_ID, capabilities }])
    appEnv.ODEE_CAPABILITY_GRANTS = grant(['read', 'write', 'post', 'admin'])
    await reservation.release()
    async function start() {
      app = run(binary, [], appEnv)
      for (let attempt = 0; attempt < 100; attempt++) {
        if (app.child.exitCode !== null) throw new Error(app.log())
        try {
          if ((await transport.health(`${origin}/healthz`)).ok) return
        } catch {}
        await sleep(100)
      }
      throw new Error(`Owned configuration app not ready\n${app.log()}`)
    }
    await start()
    async function browser(readOnly = false) {
      const file = join(scratch, readOnly ? 'read-only-results.json' : 'browser-results.json')
      await command(
        'npm',
        [
          '--prefix',
          'web',
          'run',
          'test:e2e',
          '--',
          '--config',
          'tests/configuration.config.ts',
          readOnly ? '--grep' : '--grep-invert',
          'read-only',
          '--reporter=line,json',
        ],
        {
          ...env,
          ODEE_CONFIGURATION_TEST_ORIGIN: origin,
          ODEE_CONFIGURATION_TEST_TOKEN: token,
          PLAYWRIGHT_JSON_OUTPUT_NAME: file,
        },
        join(scratch, readOnly ? 'read-only.log' : 'browser.log'),
        300000,
      )
      return requireCompanyResults(
        JSON.parse(await readFile(file, 'utf8')),
        readOnly,
        'configuration',
      )
    }
    const children = await browser()
    api = await request.newContext({ proxy: transport.proxy })
    async function state() {
      const response = await transport.fetch(api, `${origin}/api/state`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      assert.equal(response.status(), 200)
      return response.json()
    }
    const before = await state()
    assert.ok(before.documents.filter((d) => d.financialSnapshot && d.paid === 10000).length >= 4)
    const appPid = app.child.pid
    app.child.kill('SIGKILL')
    await bounded(app.done, 15000, 'Owned app hard crash')
    await start()
    assert.deepEqual(await state(), before, 'State changed after application hard restart')
    await app.stop()
    appEnv.ODEE_CAPABILITY_GRANTS = grant(['read'])
    await start()
    const readOnly = await browser(true)
    assert.deepEqual(await state(), before, 'Read-only tests changed business data')
    const summary = {
      mongo: '8.0.16 standalone',
      children,
      readOnly,
      hardAppCrash: true,
      crashedOwnedPid: appPid,
      documents: before.documents.length,
      skipped: 0,
    }
    await writeFile(join(scratch, 'summary.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await Promise.all([app?.stop(), api?.dispose(), transport?.close()])
    await bounded(mongo.stop(), 20000, 'Configuration MongoDB shutdown')
  }
}
if (process.argv.includes('--isolated')) await isolated()
else {
  const scratch = join(root, '.local-data', 'odee008', randomUUID())
  const env = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
  try {
    const cache = await provisionMongoBinary(scratch)
    console.log(`Configuration evidence: ${scratch}`)
    await command(
      process.execPath,
      ['web/tests/configuration.mjs', '--isolated'],
      {
        ...env,
        MONGOMS_DOWNLOAD_DIR: cache,
        MONGOMS_MAX_RETRIES: '1',
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright'),
      },
      undefined,
      420000,
    )
  } finally {
    await cleanFixtureData(scratch)
  }
}
