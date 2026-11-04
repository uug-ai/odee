import { createServer, request } from 'node:http'
import { connect } from 'node:net'

export async function createLocalTransport(origins = []) {
  const allowed = new Set()
  const sockets = new Set()
  const destinations = new Map()
  const denied = []
  const connections = []
  let closed = false
  let closing

  function allowOrigin(origin) {
    const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})$/.exec(origin)
    if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535 || match[1] === '8098')
      throw new Error('Only owned numeric-loopback HTTP origins are permitted')
    if (closed || allowed.has(origin)) throw new Error('Closed or duplicate transport origin')
    allowed.add(origin)
    return () => {
      allowed.delete(origin)
      for (const [socket, destination] of destinations) {
        if (destination === origin) socket.destroy()
      }
    }
  }
  for (const origin of origins) allowOrigin(origin)

  function assertAllowed(value) {
    if (closed) throw new Error('Local transport is closed')
    const url = new URL(value)
    if (!allowed.has(url.origin) || (value !== url.origin && !value.startsWith(`${url.origin}/`)))
      throw new Error('Request is not an allowed owned numeric-loopback origin')
    return url
  }

  function own(socket, origin) {
    sockets.add(socket)
    if (origin) destinations.set(socket, origin)
    socket.setTimeout(10000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      sockets.delete(socket)
      destinations.delete(socket)
    })
    return socket
  }

  // Even an accidental hostname reaching a future connection path cannot use DNS.
  function noDNS(_hostname, _options, callback) {
    callback(new Error('DNS is disabled in local test transport'))
  }

  const server = createServer((incoming, response) => {
    let target
    try {
      target = assertAllowed(incoming.url)
    } catch {
      denied.push({ method: incoming.method, target: incoming.url })
      response.writeHead(502, { Connection: 'close' })
      response.end('Test transport denied destination')
      return
    }
    const headers = { ...incoming.headers, host: target.host, connection: 'close' }
    delete headers['proxy-authorization']
    delete headers['proxy-connection']
    const outgoing = request(
      {
        hostname: '127.0.0.1',
        port: Number(target.port),
        path: target.pathname + target.search,
        method: incoming.method,
        headers,
        agent: false,
        lookup: noDNS,
      },
      (upstream) => {
        response.writeHead(upstream.statusCode, upstream.headers)
        upstream.pipe(response)
      },
    )
    outgoing.on('socket', (socket) => {
      own(socket, target.origin)
      socket.once('connect', () => connections.push(target.origin))
    })
    outgoing.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { Connection: 'close' })
      response.end()
    })
    incoming.on('aborted', () => outgoing.destroy())
    response.on('close', () => outgoing.destroy())
    incoming.pipe(outgoing)
  })
  server.on('connection', (socket) => own(socket))
  server.on('connect', (incoming, client, head) => {
    const origin = `http://${incoming.url}`
    // Playwright's API client also tunnels HTTP through CONNECT. Only the exact
    // authority of an explicitly owned HTTP origin can open a loopback socket.
    if (closed || !allowed.has(origin)) {
      denied.push({ method: 'CONNECT', target: incoming.url })
      client.end('HTTP/1.1 502 Test transport denied\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const target = new URL(origin)
    const upstream = own(
      connect({ host: '127.0.0.1', port: Number(target.port), lookup: noDNS }),
      origin,
    )
    upstream.once('connect', () => {
      connections.push(origin)
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    client.once('close', () => upstream.destroy())
    upstream.once('close', () => client.destroy())
  })
  server.headersTimeout = 10000
  server.requestTimeout = 10000
  server.keepAliveTimeout = 1000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const proxy = { server: `http://127.0.0.1:${server.address().port}`, bypass: '<-loopback>' }
  if (new URL(proxy.server).port === '8098') {
    await new Promise((resolve) => server.close(resolve))
    throw new Error('Refusing shared port 8098')
  }
  return {
    proxy,
    denied,
    connections,
    allowOrigin,
    assertAllowed,
    launch(chromium) {
      return chromium.launch({
        headless: true,
        proxy,
        args: ['--disable-quic', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
      })
    },
    fetch(context, url, options = {}) {
      assertAllowed(url)
      return context.fetch(url, {
        ...options,
        maxRedirects: 0,
        maxRetries: 0,
        timeout: 10000,
      })
    },
    health(url) {
      assertAllowed(url)
      return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(500) })
    },
    close() {
      if (closing) return closing
      closed = true
      allowed.clear()
      closing = new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
}
