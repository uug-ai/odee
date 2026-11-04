import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { safeTestEnvironment, reserveTestPort } from '../../tools/agents/workspace.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const script = fileURLToPath(import.meta.url)
const children = new Set()
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true
    for (const owner of children) owner.child.kill('SIGTERM')
  })
}

function run(command, args, env, echo = false) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => {
      logs += data.toString()
      if (echo) process.stdout.write(data)
    })
  }
  const owner = {
    child,
    logs: () => logs,
    done: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        children.delete(owner)
        resolve(code)
      })
    }),
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      let timeout
      try {
        return await Promise.race([
          owner.done,
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              child.kill('SIGKILL')
              reject(new Error('owned fixture shutdown timed out'))
            }, 12000)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
  }
  children.add(owner)
  return owner
}

async function command(command, args, env, echo = true) {
  const owner = run(command, args, env, echo)
  const code = await owner.done
  if (code !== 0 || interrupted) throw new Error(`${command} failed (${code})\n${owner.logs()}`)
  return owner.logs()
}

async function launch() {
  const scratch = join(root, '.local-data', 'capabilities', randomUUID())
  const env = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
  try {
    const cache = join(scratch, 'mongodb-binaries')
    await mkdir(cache)
    const existing = join(homedir(), '.cache', 'mongodb-binaries')
    for (const name of await readdir(existing).catch(() => [])) {
      if (new RegExp(`^mongod-${process.arch}-[a-zA-Z0-9._-]+-8\\.0\\.16$`).test(name)) {
        await copyFile(join(existing, name), join(cache, name))
      }
    }
    await command(process.execPath, [script, '--isolated'], {
      ...env,
      MONGOMS_DOWNLOAD_DIR: cache,
      MONGOMS_MAX_RETRIES: '1',
      PLAYWRIGHT_BROWSERS_PATH: join(homedir(), '.cache', 'ms-playwright'),
    })
  } finally {
    for (const owner of children) await owner.stop()
    // Only the fresh UUID-owned scratch is removed, after its children exit.
    const directories = [scratch]
    while (directories.length) {
      const directory = directories.pop()
      await chmod(directory, 0o700)
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) directories.push(join(directory, entry.name))
      }
    }
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
  }
}

async function isolated() {
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  const { chromium, expect } = await import('@playwright/test')
  const { test } = await import('node:test')
  const env = process.env
  const scratch = env.ODEE_TEST_SCRATCH_DIR
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
  let browser
  try {
    const uri = mongo.getUri()
    if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('nonlocal fixture URI')
    console.log('Owned standalone MongoDB port', new URL(uri).port)
    const goResults = await command(
      'go',
      ['test', '-race', '-json', '-count=1', './internal/accounting', './cmd/odee'],
      {
        ...env,
        ODEE_TEST_MONGODB_URI: uri,
      },
      false,
    )
    const events = goResults
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
    for (const action of ['pass', 'skip', 'fail']) {
      const results = events.filter((event) => event.Test && event.Action === action)
      console.log(
        `Go ${action}: ${results.length} test/subcases${action === 'skip' ? ` (${results.map((event) => event.Test).join(', ')})` : ''}`,
      )
    }
    const binary = join(scratch, 'capabilities-fixture')
    await command('go', ['test', '-c', '-o', binary, './internal/accounting'], env)
    browser = await chromium.launch({ headless: true })
    const company = '000000000000000000000001'
    const token = 'synthetic-browser-token-'.repeat(2)
    async function fixture(
      mode,
      capabilities,
      check,
      { policyMode = 'enforced', foreign = false } = {},
    ) {
      if (interrupted) throw new Error('validation stopped')
      const reservation = await reserveTestPort()
      const origin = `http://127.0.0.1:${reservation.port}`
      const principal = {
        github: 'github:42',
        token: 'token:company',
        development: 'development:local',
      }[mode]
      const grants =
        capabilities === null
          ? []
          : [
              {
                principal,
                companyId: foreign ? '000000000000000000000099' : company,
                capabilities,
              },
            ]
      const database = `odee_test_browser_${randomUUID().replaceAll('-', '')}`
      await reservation.release()
      const owner = run(binary, ['-test.v', '-test.run=^TestCapabilitiesBrowserFixture$'], {
        ...env,
        ODEE_TEST_MONGODB_URI: uri,
        MONGODB_DATABASE_ODEE: database,
        ODEE_TEST_BROWSER_ADDR: `127.0.0.1:${reservation.port}`,
        ODEE_TEST_BROWSER_AUTH_MODE: mode,
        ODEE_COMPANY_ID: company,
        ODEE_WEB_DIR: join(root, 'web', 'dist'),
        ODEE_AUTHZ_MODE: policyMode,
        ODEE_CAPABILITY_GRANTS: JSON.stringify(grants),
      })
      const context = await browser.newContext({ serviceWorkers: 'block' })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      const blockedOrigins = []
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) {
          if (
            url.origin === 'https://fonts.googleapis.com' &&
            route.request().resourceType() === 'stylesheet'
          ) {
            await route.fulfill({
              contentType: 'text/css',
              body: '/* offline system-font fixture */',
            })
            return
          }
          blockedOrigins.push(url.origin)
          await route.abort('blockedbyclient')
          return
        }
        if (mode === 'github' && url.pathname === '/auth/github') {
          // Redirect targets are not re-routed by Playwright. Stop the login
          // redirect locally and retain its state cookie without visiting GitHub.
          const response = await route.fetch({ maxRedirects: 0 })
          expect(response.status()).toBe(302)
          const destination = new URL(response.headers().location)
          expect(destination.origin).toBe('https://github.com')
          expect(destination.pathname).toBe('/login/oauth/authorize')
          const state = destination.searchParams.get('state')
          expect(state).toMatch(/^[a-zA-Z0-9_-]+$/)
          await route.fulfill({
            status: 200,
            headers: {
              'Content-Type': 'text/html',
              'Set-Cookie': response.headers()['set-cookie'],
            },
            body: `<a href="/auth/github/callback?code=synthetic&amp;state=${state}">Continue local mock sign-in</a>`,
          })
          return
        }
        await route.continue()
      })
      try {
        let ready = false
        for (let attempt = 0; attempt < 150; attempt++) {
          if (owner.child.exitCode !== null) throw new Error(owner.logs())
          try {
            const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) })
            if (response.ok && (await response.text()) === 'ok') {
              ready = true
              break
            }
          } catch {
            /* bounded loopback startup probe */
          }
          await sleep(100)
        }
        if (!ready) throw new Error(`fixture not ready: ${owner.logs()}`)
        console.log(
          `Owned capability fixture ${mode} port=${reservation.port} database=${database}`,
        )
        const provider = owner.logs().match(/local OAuth mock (\S+)/)
        if (provider) console.log('Owned local OAuth mock', provider[1])
        await page.goto(origin)
        if (mode === 'github') {
          await page.getByRole('link', { name: /Sign in with GitHub/ }).click()
          await page.getByRole('link', { name: 'Continue local mock sign-in' }).click()
        }
        if (mode === 'token') {
          await page.getByLabel('Company access token').fill(token)
          await page.getByRole('button', { name: 'Open workspace' }).click()
        }
        const headers = mode === 'token' ? { Authorization: `Bearer ${token}` } : {}
        const api = async (path, body, method = 'POST') =>
          context.request.fetch(`${origin}/api/${path}`, {
            method: body === undefined ? 'GET' : method,
            headers: {
              ...headers,
              Origin: origin,
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { data: body }),
          })
        await check({ page, context, origin, api, headers, expect, company })
        expect(blockedOrigins).toEqual([])
      } catch (error) {
        throw new Error(
          `${error.message}\nFixture output:\n${owner.logs()}\nSynthetic page:\n${await page.locator('body').innerText()}`,
          { cause: error },
        )
      } finally {
        await context.close()
        const code = await owner.stop()
        if (code !== 0) throw new Error(`fixture cleanup failed (${code}): ${owner.logs()}`)
        await reservation.release()
      }
    }

    await test('reader controls and direct requests cannot mutate or inspect audit', async () => {
      await fixture('development', ['read'], async ({ page, api, context, origin }) => {
        await page.getByRole('button', { name: /Open accounting/ }).click()
        await expect(page.getByRole('button', { name: 'New invoice', exact: true })).toBeDisabled()
        await page.getByRole('button', { name: /^Invoices/ }).click()
        await page.getByText('Synthetic permission draft', { exact: true }).click()
        await expect(page.getByRole('button', { name: 'Edit draft' })).toBeDisabled()
        await expect(page.getByRole('button', { name: 'Post document' })).toBeDisabled()
        const state = await (await api('state')).json()
        const draft = state.documents.find((doc) => doc.status === 'draft')
        for (const [path, body, method] of [
          [`documents/${draft.id}/post`, { version: draft.version }],
          [`documents/${draft.id}/payments`, { version: draft.version }],
          [`documents/${draft.id}`, { version: draft.version }, 'PUT'],
          ['contacts', {}],
          ['contacts/import', {}],
          ['imports/not-an-id/scan', {}],
          ['imports/not-an-id/draft', {}],
        ])
          expect((await api(path, body, method)).status()).toBe(403)
        expect((await api(`documents/${draft.id}/audit`)).status()).toBe(403)
        const upload = await context.request.post(`${origin}/api/imports`, {
          headers: { Origin: origin },
          multipart: {
            file: {
              name: 'synthetic.pdf',
              mimeType: 'application/pdf',
              buffer: Buffer.from('%PDF-synthetic'),
            },
          },
        })
        expect(upload.status()).toBe(403)
        await page.getByRole('button', { name: 'Contacts', exact: true }).click()
        await expect(page.getByRole('button', { name: 'New contact' })).toBeDisabled()
        await expect(page.getByRole('button', { name: 'Import Odoo JSON' })).toBeDisabled()
        await page
          .getByRole('button', { name: /Open contact/ })
          .first()
          .click()
        await expect(page.getByRole('button', { name: 'Edit contact' })).toBeDisabled()
        await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
        await page.getByRole('button', { name: 'Odee app launcher' }).click()
        await page.getByRole('button', { name: /Open accounting/ }).click()
        await page.getByRole('button', { name: 'Bills', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Choose bills' })).toBeDisabled()
        await expect(page.getByLabel('Upload bills')).toBeDisabled()
      })
    })
    await test('editor may create but cannot post or pay', async () => {
      await fixture('development', ['read', 'write'], async ({ page, api }) => {
        await page.getByRole('button', { name: /Open accounting/ }).click()
        await expect(page.getByRole('button', { name: 'New invoice', exact: true })).toBeEnabled()
        await page.getByRole('button', { name: 'New invoice', exact: true }).click()
        await page.getByRole('dialog').getByLabel('Customer name').fill('Synthetic editor-created')
        await page.getByRole('dialog').getByLabel('Line 1 description').fill('Synthetic service')
        await page.getByRole('dialog').getByLabel('Line 1 unit price').fill('1.00')
        await page.getByRole('dialog').getByRole('button', { name: 'Save draft' }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Post document' })).toBeDisabled()
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        const state = await (await api('state')).json()
        const doc = state.documents[0]
        expect((await api(`documents/${doc.id}/post`, { version: doc.version })).status()).toBe(403)
        expect((await api(`documents/${doc.id}/payments`, { version: doc.version })).status()).toBe(
          403,
        )
        await page.getByRole('button', { name: /^Invoices/ }).click()
        await page.getByText('Synthetic permission draft', { exact: true }).click()
        await expect(page.getByRole('button', { name: 'Edit draft' })).toBeEnabled()
        await expect(page.getByRole('button', { name: 'Post document' })).toBeDisabled()
      })
    })
    await test('poster may post and pay without draft-edit rights', async () => {
      await fixture('development', ['read', 'post'], async ({ page, api }) => {
        await page.getByRole('button', { name: /Open accounting/ }).click()
        await page.getByRole('button', { name: /^Invoices/ }).click()
        await page.getByText('Synthetic permission draft', { exact: true }).click()
        await expect(page.getByRole('button', { name: 'Edit draft' })).toBeDisabled()
        await page.getByRole('button', { name: 'Post document' }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Confirm posting' }).click()
        await expect(page.getByRole('button', { name: 'Record payment' })).toBeEnabled()
        await page.getByRole('button', { name: 'Record payment', exact: true }).click()
        await page.getByRole('dialog').getByLabel('Amount (EUR)').fill('0.01')
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Record payment', exact: true })
          .click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        const state = await (await api('state')).json()
        const doc = state.documents.find((item) => item.partner === 'Synthetic permission draft')
        expect(doc.paid).toBe(1)
        expect(doc.version).toBe(3)
        expect((await api(`documents/${doc.id}/audit`)).status()).toBe(403)
        expect(JSON.stringify(await (await api('state')).json())).not.toContain('financialEvents')
      })
    })
    await test('audit administrator can inspect attribution but cannot post or edit', async () => {
      await fixture('development', ['read', 'admin'], async ({ page, api }) => {
        await page.getByRole('button', { name: /Open accounting/ }).click()
        await page.getByRole('button', { name: /^Invoices/ }).click()
        await page.getByText('Synthetic permission draft', { exact: true }).click()
        await page.getByRole('button', { name: 'Financial audit', exact: true }).click()
        await expect(page.getByRole('dialog')).toContainText('No attributed financial actions.')
        const state = await (await api('state')).json()
        const doc = state.documents[0]
        expect((await api(`documents/${doc.id}/post`, { version: doc.version })).status()).toBe(403)
        expect((await api('documents/000000000000000000000099/audit')).status()).toBe(404)
      })
    })
    for (const [title, capabilities, options] of [
      ['unmapped', null, {}],
      [
        'foreign-company',
        ['read', 'write', 'post', 'admin'],
        { foreign: true, policyMode: 'compatibility' },
      ],
      ['admin-without-read', ['admin'], {}],
    ])
      await test(`${title} remains authenticated with an actionable forbidden page`, async () => {
        await fixture(
          'development',
          capabilities,
          async ({ page, api }) => {
            await expect(
              page.getByRole('heading', { name: 'Access forbidden / Toegang geweigerd' }),
            ).toBeVisible()
            await expect(page.getByLabel('Company access token')).toHaveCount(0)
            const session = await (await api('session')).json()
            expect(session.authenticated).toBe(true)
            expect((await api('state')).status()).toBe(403)
          },
          options,
        )
      })
    await test('token 401 and authenticated 403 are distinct', async () => {
      await fixture('token', ['read'], async ({ page, api, context, origin }) => {
        await expect(page.getByRole('button', { name: /Open accounting/ })).toBeVisible()
        expect((await context.request.get(`${origin}/api/state`)).status()).toBe(401)
        expect((await api('documents', {})).status()).toBe(403)
        expect((await (await api('session')).json()).access.principal).toBe('token:company')
        await expect(page.getByLabel('Company access token')).toHaveCount(0)
      })
    })
    await test('mocked GitHub stable principal, CSRF, expiry and logout use real middleware', async () => {
      await fixture('github', ['read'], async ({ page, api, context, origin }) => {
        await expect(page.getByLabel('Signed in as renamable-login')).toBeVisible()
        const session = await (await api('session')).json()
        expect(session.access.principal).toBe('github:42')
        expect((await api('documents', {})).status()).toBe(403)
        await page.getByRole('button', { name: 'Sign out', exact: true }).click()
        await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toBeVisible()
        expect((await api('state')).status()).toBe(401)
        await context.request.get(`${origin}/fixture/expired`)
        expect((await api('state')).status()).toBe(401)
      })
    })
    await test('mocked GitHub unmapped 403 retains logout and never becomes token login', async () => {
      await fixture('github', null, async ({ page, api }) => {
        await expect(
          page.getByRole('heading', { name: 'Access forbidden / Toegang geweigerd' }),
        ).toBeVisible()
        await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
        await expect(page.getByLabel('Company access token')).toHaveCount(0)
        expect((await (await api('session')).json()).authenticated).toBe(true)
        await page.getByRole('button', { name: 'Sign out', exact: true }).click()
        await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toBeVisible()
      })
    })
  } finally {
    if (browser) await browser.close()
    for (const owner of children) await owner.stop()
    await mongo.stop({ doCleanup: false })
  }
}

try {
  if (process.argv[2] === '--isolated') await isolated()
  else if (process.argv.length === 2) await launch()
  else throw new Error('Usage: NODE_ENV=test node web/tests/capabilities.mjs')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
