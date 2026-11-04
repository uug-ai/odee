import { chromium, test as base, expect, type Browser } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLocalTransport, type LocalTransport } from './local-transport.mjs'
import { repositoryRoot } from './test-environment.mjs'

const test = base.extend<
  {},
  { startup: { origin: string; transport: LocalTransport; browser: Browser } }
>({
  startup: [
    async ({}, use) => {
      const server = createServer(async (request, response) => {
        if (request.url === '/healthz') {
          response.end('ok')
          return
        }
        if (request.url === '/api/session') {
          response.setHeader('content-type', 'application/json')
          response.end(
            JSON.stringify({
              authMode: 'github',
              authenticated: false,
              organisation: 'synthetic',
              team: 'fixture',
            }),
          )
          return
        }
        if (request.url?.startsWith('/api/')) {
          response.writeHead(401)
          response.end('{}')
          return
        }
        const asset = /^\/assets\/[a-zA-Z0-9._-]+$/.test(request.url ?? '')
          ? request.url!
          : '/index.html'
        try {
          const content = await readFile(join(repositoryRoot, 'web/dist', asset))
          response.setHeader(
            'content-type',
            asset.endsWith('.js')
              ? 'text/javascript'
              : asset.endsWith('.css')
                ? 'text/css'
                : 'text/html',
          )
          response.end(content)
        } catch {
          response.writeHead(404)
          response.end()
        }
      })
      let transport: LocalTransport | undefined
      let browser: Browser | undefined
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', resolve)
        })
        const address = server.address()
        if (!address || typeof address === 'string')
          throw new Error('Missing owned startup listener')
        expect(address.port).not.toBe(8098)
        const origin = `http://127.0.0.1:${address.port}`
        transport = await createLocalTransport([origin])
        expect((await transport.health(`${origin}/healthz`)).ok).toBe(true)
        browser = await transport.launch(chromium)
        await use({ origin, transport, browser })
        expect(transport.denied).toEqual([])
      } finally {
        if (browser) await browser.close()
        if (transport) await transport.close()
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
    },
    { scope: 'worker' },
  ],
})

const supported = [
  { saved: 'nl', languages: ['en-GB'], expected: 'nl' },
  { saved: 'en', languages: ['nl-BE'], expected: 'en' },
  { saved: null, languages: ['fr-FR', 'nl-BE', 'en-GB'], expected: 'nl' },
  { saved: null, languages: ['fr-FR', 'en-GB', 'nl-BE'], expected: 'en' },
  { saved: 'de', languages: ['nl-BE'], expected: 'nl' },
  { saved: 'NL', languages: ['en-GB'], expected: 'en' },
  { saved: 'null', languages: ['de-DE'], expected: 'en' },
  { saved: '{"locale":"nl"}', languages: ['nl-BE'], expected: 'nl' },
  { saved: '', languages: ['de-DE'], expected: 'en' },
  { saved: null, languages: [], expected: 'en' },
  { saved: null, languages: ['NL-be'], expected: 'nl' },
  { saved: null, languages: ['de-DE', 'es-ES'], expected: 'en' },
]
const unavailable = [
  { mode: 'undefined', languages: undefined, expected: 'en', saved: null },
  { mode: 'null', languages: null, expected: 'en', saved: null },
  { mode: 'string', languages: 'nl-BE', expected: 'en', saved: null },
  { mode: 'number', languages: 42, expected: 'en', saved: null },
  { mode: 'object', languages: { 0: 'nl', length: 1 }, expected: 'en', saved: null },
  { mode: 'malformed entries', languages: [null, 42, {}, 'nl-BE'], expected: 'nl', saved: null },
  { mode: 'throwing', expected: 'en', saved: null },
  { mode: 'throwing', expected: 'nl', saved: 'nl' },
  { mode: 'throwing', expected: 'en', saved: 'en' },
]

for (const [index, row] of [...supported, ...unavailable].entries()) {
  test(`startup ${index + 1}: saved=${JSON.stringify(row.saved)} preferences=${'mode' in row ? row.mode : JSON.stringify(row.languages)} -> ${row.expected}`, async ({
    startup,
  }) => {
    const context = await startup.browser.newContext({
      proxy: startup.transport.proxy,
      serviceWorkers: 'block',
      locale: 'en-GB',
    })
    const errors: string[] = []
    try {
      await context.addInitScript((row) => {
        if (row.saved !== null) localStorage.setItem('odee.locale', row.saved)
        Object.defineProperty(navigator, 'languages', {
          get() {
            if ('mode' in row && row.mode === 'throwing')
              throw new Error('Synthetic preferences unavailable')
            return row.languages
          },
        })
      }, row)
      await context.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({ contentType: 'text/css', body: '' }),
      )
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(startup.origin)
      await expect(page.locator('html')).toHaveAttribute('lang', row.expected)
      await expect(
        page.getByLabel(row.expected === 'nl' ? 'Taal' : 'Language', { exact: true }),
      ).toHaveValue(row.expected)
      await expect(
        page.getByRole('heading', {
          name: row.expected === 'nl' ? 'Je werkruimte, beveiligd.' : 'Your workspace, protected.',
          exact: true,
        }),
      ).toBeVisible()
      await expect(
        page.getByText(
          row.expected === 'nl'
            ? 'Meld je aan met GitHub. Toegang is beperkt tot actieve leden van synthetic/fixture.'
            : 'Sign in with GitHub. Access is limited to active members of synthetic/fixture.',
          { exact: true },
        ),
      ).toBeVisible()
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
}

for (const denied of ['get-only', 'all']) {
  test(`startup storage unavailable (${denied}): switch works without a false persistence promise`, async ({
    startup,
  }) => {
    const context = await startup.browser.newContext({
      proxy: startup.transport.proxy,
      serviceWorkers: 'block',
      locale: 'nl-BE',
    })
    const errors: string[] = []
    try {
      await context.addInitScript((denied) => {
        Object.defineProperty(Storage.prototype, 'getItem', {
          value() {
            throw new DOMException('unavailable', 'SecurityError')
          },
        })
        if (denied === 'all')
          Object.defineProperty(Storage.prototype, 'setItem', {
            value() {
              throw new DOMException('unavailable', 'SecurityError')
            },
          })
      }, denied)
      await context.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({ contentType: 'text/css', body: '' }),
      )
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(startup.origin)
      await expect(page.locator('html')).toHaveAttribute('lang', 'nl')
      await page.getByLabel('Taal', { exact: true }).selectOption('en')
      await expect(
        page.getByRole('heading', { name: 'Your workspace, protected.', exact: true }),
      ).toBeVisible()
      expect(await page.locator('body').innerText()).not.toMatch(
        /saved permanently|opgeslagen.*voorkeur|will remember/i,
      )
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('lang', 'nl')
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
}
