import { chromium, test as base, expect, type BrowserContext } from '@playwright/test'
import { createServer, request, type Server } from 'node:http'
import { connect } from 'node:net'
import { createLocalTransport, type LocalTransport } from './local-transport.mjs'

type LocalFixture = {
  transport: LocalTransport
  context: BrowserContext
  origin: string
  trap: string
  trapHits: { requests: number; connections: number }
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing owned loopback listener')
  expect(address.port).not.toBe(8098)
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

const test = base.extend<{ local: LocalFixture }>({
  local: async ({}, use) => {
    const trapHits = { requests: 0, connections: 0 }
    const trapServer = createServer((_request, response) => {
      trapHits.requests++
      response.end('disallowed trap')
    })
    trapServer.on('connection', () => trapHits.connections++)
    const trap = await listen(trapServer)
    let origin = ''
    const app = createServer((incoming, response) => {
      if (incoming.url === '/https-redirect') {
        response.writeHead(302, { Location: `${trap.replace('http:', 'https:')}/trap` })
        response.end()
      } else if (['/redirect', '/api/redirect', '/healthz'].includes(incoming.url ?? '')) {
        response.writeHead(302, { Location: `${trap}/trap` })
        response.end()
      } else if (incoming.url === '/chain') {
        response.writeHead(302, { Location: `${origin}/redirect` })
        response.end()
      } else if (incoming.url === '/same-origin') {
        response.writeHead(302, {
          Location: `${origin}/ok`,
          'Set-Cookie': 'synthetic=local; Path=/; HttpOnly; SameSite=Lax',
        })
        response.end()
      } else if (incoming.url === '/upload') {
        let body = ''
        incoming.on('data', (data) => (body += data))
        incoming.on('end', () => {
          response.setHeader('Content-Type', 'application/json')
          response.end(
            JSON.stringify({
              type: incoming.headers['content-type'],
              hasPayload: body.includes('synthetic native payload'),
              cookie: incoming.headers.cookie,
            }),
          )
        })
      } else if (incoming.url !== '/hung-health') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Owned fixture</title><body>Owned local fixture</body>')
      }
    })
    let transport: LocalTransport | undefined
    let browser
    try {
      origin = await listen(app)
      transport = await createLocalTransport([origin])
      browser = await transport.launch(chromium)
      const context = await browser.newContext({ serviceWorkers: 'block' })
      await use({ transport, context, origin, trap, trapHits })
      expect(trapHits).toEqual({ requests: 0, connections: 0 })
      expect(transport.connections.every((destination) => destination === origin)).toBe(true)
    } finally {
      const results = await Promise.allSettled([
        browser?.close(),
        transport?.close(),
        close(app),
        close(trapServer),
      ])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
  },
})

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('owned requests retain browser redirects, URL, cookies and native multipart', async ({
  local,
}) => {
  const { transport, context, origin } = local
  const page = await context.newPage()
  const response = await page.goto(`${origin}/same-origin`)
  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL(`${origin}/ok`)
  await expect(page.locator('body')).toHaveText('Owned local fixture')
  expect((await context.cookies())[0].value).toBe('local')
  await page.setContent(
    `<form action="${origin}/upload" method="post" enctype="multipart/form-data">
       <input type="file" name="file"><button>Upload</button></form>`,
  )
  await page.locator('input').setInputFiles({
    name: 'synthetic.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic native payload'),
  })
  await Promise.all([page.waitForURL(`${origin}/upload`), page.getByText('Upload').click()])
  const uploaded = JSON.parse((await page.locator('body').textContent()) ?? '')
  expect(uploaded.type).toMatch(/^multipart\/form-data; boundary=/)
  expect(uploaded.hasPayload).toBe(true)
  expect(uploaded.cookie).toBe('synthetic=local')
  const apiUpload = await transport.fetch(context.request, `${origin}/upload`, {
    method: 'POST',
    multipart: {
      file: {
        name: 'synthetic.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('synthetic native payload'),
      },
    },
  })
  expect((await apiUpload.json()).hasPayload).toBe(true)
  expect(transport.denied).toEqual([])
})

for (const path of ['/redirect', '/chain'])
  test(`browser ${path} is stopped at the proxy before disallowed B connects`, async ({
    local,
  }) => {
    const { transport, context, origin, trap } = local
    const page = await context.newPage()
    // No Playwright route is installed: the permanent transport must catch
    // redirect hops which context.route never sees.
    const response = await page.goto(`${origin}${path}`)
    expect(response?.status()).toBe(502)
    expect(transport.denied).toContainEqual({ method: 'GET', target: `${trap}/trap` })
  })

test('API and health helpers stop redirects even if unsafe options are supplied', async ({
  local,
}) => {
  const { transport, context, origin } = local
  const response = await transport.fetch(context.request, `${origin}/api/redirect`, {
    maxRedirects: 20,
    maxRetries: 2,
  })
  expect(response.status()).toBe(302)
  expect((await transport.health(`${origin}/healthz`)).status).toBe(302)
  expect(transport.denied).toEqual([])
})

test('the proxy also denies a raw API client redirect outside context.route', async ({ local }) => {
  const { transport, context, origin, trap } = local
  expect((await context.request.get(`${origin}/api/redirect`)).status()).toBe(502)
  expect(transport.denied).toContainEqual({
    method: 'CONNECT',
    target: new URL(trap).host,
  })
})

test('browser HTTPS redirects cannot open a disallowed CONNECT socket', async ({ local }) => {
  const { transport, context, origin, trap } = local
  const page = await context.newPage()
  await expect(page.goto(`${origin}/https-redirect`)).rejects.toThrow(
    /ERR_TUNNEL_CONNECTION_FAILED/,
  )
  expect(transport.denied).toContainEqual({
    method: 'CONNECT',
    target: new URL(trap).host,
  })
})

test('an unresponsive owned health endpoint has a bounded timeout', async ({ local }) => {
  await expect(local.transport.health(`${local.origin}/hung-health`)).rejects.toThrow(/timeout/i)
})

test('origin validation rejects DNS, aliases, credentials, schemes and revoked ownership', async ({
  local,
}) => {
  const { transport, context, origin, trap } = local
  const port = new URL(origin).port
  for (const invalid of [
    `http://localhost:${port}`,
    `http://127.1:${port}`,
    `http://2130706433:${port}`,
    `http://[::1]:${port}`,
    `http://user@127.0.0.1:${port}`,
    `https://127.0.0.1:${port}`,
    'http://127.0.0.1:8098',
    `${origin}/`,
  ])
    expect(() => transport.allowOrigin(invalid)).toThrow()
  for (const invalid of [
    `${trap}/trap`,
    `http://localhost:${port}/`,
    `http://127.1:${port}/`,
    `http://2130706433:${port}/`,
    `http://user@127.0.0.1:${port}/`,
    `https://127.0.0.1:${port}/`,
  ]) {
    expect(() => transport.fetch(context.request, invalid)).toThrow()
    expect(() => transport.health(invalid)).toThrow()
  }
  const revoke = transport.allowOrigin(trap)
  revoke()
  expect(() => transport.fetch(context.request, `${trap}/trap`)).toThrow()
  expect(transport.connections).toEqual([])
})

async function probeProxy(proxy: string, method: string, target: string) {
  return new Promise<number>((resolve, reject) => {
    const outgoing = request(proxy, { method, path: target, agent: false })
    outgoing.on('response', (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    outgoing.on('connect', (response, socket) => {
      socket.destroy()
      resolve(response.statusCode ?? 0)
    })
    outgoing.on('error', reject)
    outgoing.setTimeout(2000, () => outgoing.destroy(new Error('Owned proxy probe timed out')))
    outgoing.end()
  })
}

test('DNS names, disallowed authorities and CONNECT are denied before any target socket', async ({
  local,
}) => {
  const { transport, trap } = local
  for (const [method, target] of [
    ['GET', `${trap}/trap`],
    ['GET', `http://localhost:${new URL(trap).port}/trap`],
    ['GET', 'http://transport-denied.invalid/trap'],
    ['CONNECT', new URL(trap).host],
    ['CONNECT', `localhost:${new URL(trap).port}`],
    ['CONNECT', 'transport-denied.invalid:443'],
  ])
    expect(await probeProxy(transport.proxy.server, method, target)).toBe(502)
  expect(transport.denied).toHaveLength(6)
  expect(transport.connections).toEqual([])
})

test('shutdown closes active CONNECT sockets and releases the owned proxy listener', async ({
  local,
}) => {
  const { transport, origin } = local
  const proxy = new URL(transport.proxy.server)
  const socket = connect({ host: '127.0.0.1', port: Number(proxy.port) })
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.once('data', (data) => {
        expect(data.toString()).toContain('200 Connection Established')
        resolve()
      })
      socket.once('connect', () =>
        socket.write(
          `CONNECT ${new URL(origin).host} HTTP/1.1\r\nHost: ${new URL(origin).host}\r\n\r\n`,
        ),
      )
    })
    const disconnected = new Promise<void>((resolve) => socket.once('close', () => resolve()))
    await transport.close()
    await disconnected
    expect(() => transport.health(`${origin}/healthz`)).toThrow(/closed/)
    const replacement = createServer()
    await new Promise<void>((resolve, reject) => {
      replacement.once('error', reject)
      replacement.listen(Number(proxy.port), '127.0.0.1', resolve)
    })
    await close(replacement)
  } finally {
    socket.destroy()
  }
})
