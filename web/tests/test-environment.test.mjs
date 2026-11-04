import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import test from 'node:test'
import { browserEnvironment, isolatedCommand, testPort } from './test-environment.mjs'
import {
  mongoSelector,
  requiredMongoCases,
  requireMongoResults,
  requireCompanyResults,
} from './company-test-results.mjs'
import { command } from './owned-fixture.mjs'

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

test('company child reports reject zero execution, fixture skips and child assertion failures', () => {
  const lifecycle = ['en', 'nl'].map((locale) => ({
    file: 'company.fixture.ts',
    title: `protected ${locale}: complete saved-contact and legal-company snapshot lifecycle`,
    tests: [{ results: [{ status: 'passed' }] }],
  }))
  const guards = Array.from({ length: 10 }, (_, index) => ({
    file: 'local-transport.spec.ts',
    title: `destination guard ${index}`,
    tests: [{ results: [{ status: 'passed' }] }],
  }))
  const report = {
    suites: [{ suites: [{ specs: [...lifecycle, ...guards] }] }],
    stats: { expected: 12, skipped: 0, unexpected: 0, flaky: 0 },
  }
  assert.equal(requireCompanyResults(report).length, 12)
  const readonly = {
    suites: [{ specs: [{ ...lifecycle[0], title: 'read-only: both locales' }] }],
    stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
  }
  assert.equal(requireCompanyResults(readonly, true).length, 1)
  for (const stats of [
    { expected: 0, skipped: 12, unexpected: 0, flaky: 0 },
    { expected: 11, skipped: 1, unexpected: 0, flaky: 0 },
    { expected: 11, skipped: 0, unexpected: 1, flaky: 0 },
  ])
    assert.throws(() => requireCompanyResults({ ...report, stats }))
  const failed = structuredClone(report)
  failed.suites[0].suites[0].specs[0].tests[0].results[0].status = 'failed'
  assert.throws(() => requireCompanyResults(failed), /Child did not pass/)
  const missingLocale = structuredClone(report)
  missingLocale.suites[0].suites[0].specs[0].title = 'wrong selection'
  assert.throws(() => requireCompanyResults(missingLocale), /Missing en lifecycle/)
})

test('normal Mongo result gate requires every persistent branch and the two real restart phases', () => {
  const events = requiredMongoCases.map((Test) => ({ Test, Action: 'pass' }))
  events.push({ Test: 'TestMongoDiskPersistence', Action: 'skip' })
  assert.equal(requireMongoResults(events).requiredPassed.length, requiredMongoCases.length)
  for (const name of requiredMongoCases) assert.match(name, new RegExp(mongoSelector))
  assert.throws(() => requireMongoResults(events.slice(1)), /Required Mongo case/)
  const skippedPersistent = structuredClone(events)
  skippedPersistent.find(
    (event) => event.Test === 'TestReviewDraftCapturesCompanyAndPartner/true',
  ).Action = 'skip'
  assert.throws(() => requireMongoResults(skippedPersistent), /Required Mongo case/)
  assert.throws(
    () =>
      requireMongoResults([
        ...events,
        { Test: 'TestCompanyProfileLegacyScopeAndConflicts/true/null', Action: 'skip' },
      ]),
    /Unexpected Mongo fixture skip/,
  )
  for (const phase of ['write', 'read']) {
    const phaseEvents = [
      { Test: 'TestMongoDiskPersistence', Action: 'pass' },
      { Test: 'TestMongoDiskPersistence/configuration', Action: 'pass' },
    ]
    assert.equal(requireMongoResults(phaseEvents, phase).phase, phase)
    assert.throws(() => requireMongoResults([], phase), /Required Mongo case/)
    assert.throws(
      () => requireMongoResults(phaseEvents.slice(0, 1), phase),
      /Required Mongo case did not pass: TestMongoDiskPersistence\/configuration/,
    )
    assert.throws(
      () => requireMongoResults([phaseEvents[0], { ...phaseEvents[1], Action: 'skip' }], phase),
      /Required Mongo case did not pass: TestMongoDiskPersistence\/configuration/,
    )
  }
})

test('a fixture child process failure propagates even when it emits success-shaped output', async () => {
  const environment = browserEnvironment(31002)
  try {
    await assert.rejects(
      command(
        process.execPath,
        ['-e', 'console.log("synthetic successful-looking output"); process.exitCode = 7'],
        environment,
      ),
      /\(7\).*synthetic successful-looking output/s,
    )
    await assert.rejects(
      command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], environment, undefined, 50),
      /timed out/,
    )
  } finally {
    await rm(environment.ODEE_TEST_SCRATCH_DIR, { recursive: true, force: true })
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
