import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import test from 'node:test'
import { browserEnvironment, isolatedCommand, testPort } from './test-environment.mjs'

test('test ports are canonical, unprivileged, and never shared app 8098', () => {
  for (const value of ['8099', '1024', '65535', '31234']) {
    assert.equal(testPort(value), Number(value))
  }
  for (const value of [
    '',
    '0',
    '80',
    '8098',
    '65536',
    '08099',
    '8099 ',
    ' 8099',
    '8099; echo injected',
    '$(echo 8099)',
    '127.0.0.1:8099',
    'NaN',
    'Infinity',
    '-1',
    '1.2',
  ]) {
    assert.throws(() => testPort(value), /ODEE_TEST_PORT/)
  }
})

test('browser environment never inherits live database, auth, provider, or tool injection values', async () => {
  const keys = [
    'MONGODB_URI',
    'ODEE_API_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_CLIENT_SECRET',
    'NODE_OPTIONS',
    'MONGOMS_SYSTEM_BINARY',
    'ODEE_DEMO',
    'ODEE_DEV_MODE',
    'ODEE_ADDR',
  ]
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  let environment
  try {
    for (const key of keys) process.env[key] = 'synthetic-inherited-poison'
    environment = browserEnvironment(31001)
    assert.equal(environment.ODEE_ADDR, '127.0.0.1:31001')
    assert.equal(environment.ODEE_ORIGIN, 'http://127.0.0.1:31001')
    assert.equal(environment.ODEE_DEMO, 'true')
    assert.equal(environment.ODEE_DEV_MODE, 'true')
    assert.equal(environment.ODEE_AUTH_MODE, 'token')
    assert.equal(environment.GOWORK, 'off')
    for (const key of keys.slice(0, 6)) assert.equal(environment[key], undefined)
    assert.ok(Object.isFrozen(environment))
    assert.ok(environment.HOME.startsWith(`${environment.ODEE_TEST_SCRATCH_DIR}/`))
    assert.ok(environment.TMPDIR.startsWith(`${environment.ODEE_TEST_SCRATCH_DIR}/`))
    assert.match(environment.MONGODB_DATABASE_ODEE, /^odee_test_/)
    assert.doesNotMatch(JSON.stringify(environment), /synthetic-inherited-poison/)
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
    if (environment) await rm(environment.ODEE_TEST_SCRATCH_DIR, { recursive: true })
  }
})

test('webServer command clears inherited env and treats shell metacharacters literally', () => {
  const literal = 'literal\' $(printf unexpected); "quoted"'
  const command = isolatedCommand({ SAFE_LITERAL: literal }, [
    process.execPath,
    '-e',
    'process.stdout.write(JSON.stringify({literal:process.env.SAFE_LITERAL,poison:process.env.ODEE_API_TOKEN}))',
  ])
  const output = execFileSync('/bin/sh', ['-c', command], {
    env: { ODEE_API_TOKEN: 'synthetic-poison-not-a-token' },
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.deepEqual(JSON.parse(output), { literal })
})
