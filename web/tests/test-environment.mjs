import { randomUUID } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeTestEnvironment } from '../../tools/agents/workspace.mjs'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function testPort(value = process.env.ODEE_TEST_PORT ?? '8099') {
  if (!/^[1-9][0-9]{0,4}$/.test(value)) {
    throw new Error('ODEE_TEST_PORT must be a decimal TCP port')
  }
  const port = Number(value)
  if (port < 1024 || port > 65535 || port === 8098) {
    throw new Error('ODEE_TEST_PORT must be 1024–65535 and must not be the shared app port 8098')
  }
  return port
}

export function browserEnvironment(port, scratchDir) {
  testPort(String(port))
  const scratchRoot = resolve(repositoryRoot, '.local-data', 'browser-tests')
  scratchDir ??= resolve(scratchRoot, randomUUID())
  if (dirname(scratchDir) !== scratchRoot) {
    throw new Error('Browser scratch must be a dedicated child of .local-data/browser-tests')
  }
  return safeTestEnvironment({
    ODEE_ADDR: `127.0.0.1:${port}`,
    ODEE_ORIGIN: `http://127.0.0.1:${port}`,
    ODEE_WEB_DIR: resolve(repositoryRoot, 'web/dist'),
    ODEE_TEST_SCRATCH_DIR: scratchDir,
  })
}

// Playwright merges webServer.env into process.env. env -i is the actual
// inheritance boundary; shell-quote every allowlisted value, not just the port.
export function isolatedCommand(environment, args) {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
  return [
    'env',
    '-i',
    ...Object.entries(environment).map(([key, value]) => quote(`${key}=${value}`)),
    ...args.map(quote),
  ].join(' ')
}
