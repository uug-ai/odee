import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { reserveTestPort } from '../../tools/agents/workspace.mjs'
import { browserEnvironment, repositoryRoot, testPort } from './test-environment.mjs'

const script = fileURLToPath(import.meta.url)
const web = resolve(dirname(script), '..')
const children = new Set()
let interrupted = false
let secret = ''

function redact(value) {
  return secret ? value.replaceAll(secret, '[ephemeral token redacted]') : value
}

function describeError(error) {
  const nested = error instanceof AggregateError ? error.errors.map(describeError).join('\n') : ''
  return `${error.stack ?? error.message}${nested ? `\n${nested}` : ''}`
}

async function bounded(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function managed(command, args, env, echo = false) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  let spawnError
  for (const stream of [child.stdout, child.stderr]) {
    let pending = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop()
      for (const line of lines) {
        const safe = redact(line)
        logs = `${logs}${safe}\n`.slice(-32768)
        if (echo) process.stdout.write(`${safe}\n`)
      }
    })
    stream.on('end', () => {
      if (pending) {
        logs = `${logs}${redact(pending)}`.slice(-32768)
        if (echo) process.stdout.write(redact(pending))
      }
    })
  }
  const done = new Promise((resolve) => {
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      children.delete(owner)
      resolve({ code, signal, error: spawnError })
    })
  })
  const owner = {
    child,
    done,
    logs: () => logs,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return done
      child.kill('SIGTERM')
      try {
        return await bounded(done, 12000, 'owned process graceful shutdown')
      } catch (error) {
        child.kill('SIGKILL')
        await bounded(done, 3000, 'owned process forced shutdown')
        throw error
      }
    },
  }
  children.add(owner)
  return owner
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true
    for (const owner of children) {
      void owner.stop().catch((error) => process.stderr.write(`${redact(error.message)}\n`))
    }
  })
}

function active() {
  if (interrupted) throw new Error('Isolated validation interrupted')
}

async function command(command, args, env, timeout, label, echo = false) {
  active()
  const owner = managed(command, args, env, echo)
  try {
    const result = await bounded(owner.done, timeout, label)
    if (result.error || result.code !== 0 || interrupted) {
      throw new Error(
        `${label} failed (${result.code ?? result.signal}): ${result.error?.message ?? ''}\n${owner.logs()}`,
      )
    }
  } finally {
    await owner.stop()
  }
}

async function build(env) {
  const binary = join(env.ODEE_TEST_SCRATCH_DIR, 'odee-test')
  await command(
    'go',
    ['build', '-modcacherw', '-o', binary, './cmd/odee'],
    env,
    240000,
    'Go app build',
  )
  return binary
}

async function ready(owner, env) {
  const until = Date.now() + 30000
  while (Date.now() < until) {
    active()
    if (owner.child.exitCode !== null || owner.child.signalCode !== null || !owner.child.pid) {
      throw new Error(`Owned Go server exited during startup:\n${owner.logs()}`)
    }
    try {
      const health = await fetch(`${env.ODEE_ORIGIN}/healthz`, {
        signal: AbortSignal.timeout(1000),
      })
      if (health.ok && (await health.text()) === 'ok') {
        const response = await fetch(`${env.ODEE_ORIGIN}/api/state`, {
          headers: env.ODEE_API_TOKEN ? { Authorization: `Bearer ${env.ODEE_API_TOKEN}` } : {},
          signal: AbortSignal.timeout(1000),
        })
        if (response.ok) {
          const state = await response.json()
          if (
            state.company !== env.ODEE_COMPANY_NAME ||
            state.demo !== (env.ODEE_DEMO === 'true') ||
            state.development !== (env.ODEE_DEV_MODE === 'true')
          ) {
            throw new Error('Readiness reached a foreign server or an incorrect storage/auth mode')
          }
          active()
          if (owner.child.exitCode !== null || owner.child.signalCode !== null) {
            throw new Error('Owned server exited while readiness was being checked')
          }
          return
        }
      }
    } catch (error) {
      if (!['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)) throw error
    }
    await sleep(100)
  }
  throw new Error(`Owned Go server never became responsive:\n${owner.logs()}`)
}

async function stopServer(owner) {
  const result = await owner.stop()
  if (result.error || result.code !== 0) {
    throw new Error(`Owned Go server did not shut down cleanly:\n${owner.logs()}`)
  }
}

async function ownScratch(env) {
  const scratch = env.ODEE_TEST_SCRATCH_DIR
  const parent = resolve(repositoryRoot, '.local-data/browser-tests')
  if (dirname(scratch) !== parent) throw new Error('Refusing non-browser scratch ownership')
  const marker = join(scratch, '.synthetic-owner')
  await writeFile(marker, env.ODEE_TEST_RUN_ID, { flag: 'wx', mode: 0o600 })
  return async () => {
    if ((await readFile(marker, 'utf8')) !== env.ODEE_TEST_RUN_ID) {
      throw new Error('Refusing foreign scratch cleanup')
    }
    // Go toolchains may contain read-only directories even with -modcacherw.
    // Only traverse our marker-verified directory; never follow symlinks.
    const directories = [scratch]
    while (directories.length) {
      const directory = directories.pop()
      await chmod(directory, 0o700)
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) directories.push(join(directory, entry.name))
      }
    }
    await rm(scratch, { recursive: true })
  }
}

async function demoServer() {
  const port = testPort()
  const env = browserEnvironment(port, process.env.ODEE_TEST_SCRATCH_DIR)
  const cleanup = await ownScratch(env)
  let app
  try {
    const binary = await build(env)
    active()
    app = managed(binary, [], env)
    await ready(app, env)
    const result = await app.done
    if (!interrupted || result.code !== 0) {
      throw new Error(`Demo server stopped unexpectedly:\n${app.logs()}`)
    }
  } finally {
    try {
      if (app) await stopServer(app)
    } finally {
      await cleanup()
    }
  }
}

async function isolatedPersistence() {
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  const scratch = process.env.ODEE_TEST_SCRATCH_DIR
  if (!scratch) throw new Error('Missing isolated scratch directory')
  let reservation = await reserveTestPort()
  const port = testPort(String(reservation.port))
  const base = browserEnvironment(port, scratch)
  secret = randomBytes(32).toString('hex')
  const env = {
    ...base,
    ODEE_DEV_MODE: 'false',
    ODEE_DEMO: 'false',
    ODEE_AUTH_MODE: 'token',
    ODEE_API_TOKEN: secret,
    ODEE_COMPANY_NAME: `Synthetic persistence ${base.ODEE_TEST_RUN_ID}`,
    ODEE_TEST_PERSISTENCE_RUN: base.ODEE_TEST_RUN_ID,
    ODEE_TEST_PORT: String(port),
  }
  let mongo
  let app
  let failure
  try {
    const binary = await build(base)
    active()
    const dbPath = join(scratch, 'mongo-data')
    await mkdir(dbPath, { mode: 0o700 })
    mongo = new MongoMemoryServer({
      binary: {
        version: '8.0.16',
        downloadDir: join(scratch, 'mongodb-binaries'),
        ...(process.platform === 'linux' && process.arch === 'arm64'
          ? { os: { os: 'linux', dist: 'ubuntu', release: '22.04' } }
          : {}),
      },
      instance: {
        ip: '127.0.0.1',
        dbPath,
        dbName: env.MONGODB_DATABASE_ODEE,
        launchTimeout: 30000,
      },
      spawn: { env: base },
    })
    await bounded(mongo.start(), 90000, 'Disposable MongoDB startup')
    const appEnv = { ...env, MONGODB_URI: mongo.getUri(env.MONGODB_DATABASE_ODEE) }
    const uri = new URL(appEnv.MONGODB_URI)
    if (uri.hostname !== '127.0.0.1' || uri.protocol !== 'mongodb:') {
      throw new Error('Disposable MongoDB did not produce a loopback URI')
    }
    for (let attempt = 0; ; attempt++) {
      await reservation.release()
      active()
      app = managed(binary, [], appEnv)
      try {
        await ready(app, appEnv)
        break
      } catch (error) {
        await Promise.race([app.done, sleep(150)])
        await app.stop()
        // Retry only a proven lost port handoff, never build, Mongo, auth, or
        // other startup errors. This Go listener cannot inherit the lease.
        if (!app.logs().includes('bind: address already in use') || attempt >= 2) throw error
        reservation = await reserveTestPort()
        const retryPort = testPort(String(reservation.port))
        for (const target of [env, appEnv]) {
          target.ODEE_ADDR = `127.0.0.1:${retryPort}`
          target.ODEE_ORIGIN = `http://${target.ODEE_ADDR}`
          target.ODEE_TEST_PORT = String(retryPort)
        }
        console.log('Reserved a new isolated port after a lost listener handoff.')
      }
    }
    console.log(
      'Owned MongoDB and token-authenticated Go app are responsive (demo/development off).',
    )
    const playwright = join(web, 'node_modules/@playwright/test/cli.js')
    for (const phase of ['write', 'read']) {
      await command(
        process.execPath,
        [playwright, 'test', '--config', join(web, 'playwright.persistence.config.ts')],
        {
          ...env,
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
          ODEE_TEST_PERSISTENCE_PHASE: phase,
        },
        100000,
        `Persistence browser ${phase} phase`,
        true,
      )
      await stopServer(app)
      app = undefined
      if (phase === 'write') {
        // Same binary, database, company, token, and loopback port; a new PID.
        active()
        app = managed(binary, [], appEnv)
        await ready(app, appEnv)
        console.log('Owned Go app restarted cleanly against the same disposable database.')
      }
    }
    console.log(
      'Persistence validation passed: browser write + post-restart browser read (2 tests).',
    )
  } catch (error) {
    failure = error
    throw error
  } finally {
    const cleanupErrors = []
    if (app) {
      try {
        await stopServer(app)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (mongo) {
      try {
        await bounded(mongo.stop({ doCleanup: false }), 20000, 'Disposable MongoDB shutdown')
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    await reservation.release()
    if (cleanupErrors.length) {
      throw new AggregateError(
        [...(failure ? [failure] : []), ...cleanupErrors],
        'Owned service cleanup failed',
      )
    }
  }
}

async function launchIsolated() {
  const env = browserEnvironment(8099)
  const cleanup = await ownScratch(env)
  try {
    const cache = join(env.ODEE_TEST_SCRATCH_DIR, 'mongodb-binaries')
    await mkdir(cache, { mode: 0o700 })
    const originalCache = join(homedir(), '.cache/mongodb-binaries')
    let names = []
    try {
      names = await readdir(originalCache)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    for (const name of names) {
      if (
        /^mongod-(arm64|x64)-[a-zA-Z0-9._-]+-8\.0\.16$/.test(name) &&
        name.startsWith(`mongod-${process.arch}-`)
      ) {
        await copyFile(join(originalCache, name), join(cache, name))
      }
    }
    const browsers =
      process.platform === 'darwin'
        ? join(homedir(), 'Library/Caches/ms-playwright')
        : join(homedir(), '.cache/ms-playwright')
    await command(
      process.execPath,
      [script, '--isolated'],
      { ...env, PLAYWRIGHT_BROWSERS_PATH: browsers, MONGOMS_MAX_RETRIES: '1' },
      600000,
      'Isolated persistence runner',
      true,
    )
  } finally {
    await cleanup()
  }
}

try {
  if (process.argv.length === 2) await launchIsolated()
  else if (process.argv.length === 3 && process.argv[2] === '--isolated')
    await isolatedPersistence()
  else if (process.argv.length === 3 && process.argv[2] === '--demo-server') await demoServer()
  else throw new Error('Usage: node web/tests/persistence.mjs')
} catch (error) {
  process.stderr.write(`${redact(describeError(error))}\n`)
  process.exitCode = 1
}
