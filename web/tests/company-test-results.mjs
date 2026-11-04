import assert from 'node:assert/strict'

export const mongoSelector = '^(TestMongo|TestSnapshot|TestCompanyProfile|TestReview)'
export const requiredMongoDiskCases = [
  'TestMongoDiskPersistence',
  'TestMongoDocumentVolumeDiskPersistence',
]
export const mongoDiskSelector = `^(${requiredMongoDiskCases.join('|')})$`
export const requiredMongoCases = [
  'TestMongoFinancialAuditAtomicity',
  'TestMongoAuthorizationCanonicalAndLegacyEverySurface',
  'TestMongoContactsPersistenceIsolationAndSources',
  'TestMongoGridFSOriginalsAndOwnership',
  'TestMongoVolumeCopiesAndSharedGridFS',
  'TestMongoPersistenceIsolationAndAtomicity',
  'TestSnapshotLifecycleMongo',
  'TestSnapshotCanonicalAndLegacyScope/true',
  'TestSnapshotReadVersionNotCrossDocumentLock/true',
  'TestCompanyProfileLegacyScopeAndConflicts/true',
  ...[
    'missing',
    'null',
    'zero',
    'organisation-only',
    'project-only',
    'foreign-organisation',
    'foreign-project',
  ].map((variant) => `TestCompanyProfileLegacyScopeAndConflicts/true/${variant}`),
  'TestReviewDraftCapturesCompanyAndPartner/true',
  'TestReviewRetryRejectsForeignCanonicalDocument/true',
]

export function requireMongoResults(events, phase = '') {
  const passed = events.filter((event) => event.Test && event.Action === 'pass')
  const skipped = events.filter((event) => event.Test && event.Action === 'skip')
  assert.equal(
    events.some((event) => event.Action === 'fail'),
    false,
    'Go test failure',
  )
  const required = phase ? requiredMongoDiskCases : requiredMongoCases
  for (const name of required)
    assert.ok(
      passed.some((event) => event.Test === name),
      `Required Mongo case did not pass: ${name}`,
    )
  assert.deepEqual(
    skipped.map((event) => event.Test).sort(),
    phase ? [] : [...requiredMongoDiskCases].sort(),
    'Unexpected Mongo fixture skip',
  )
  return {
    phase: phase || 'matrix',
    topLevelPassed: passed.filter((event) => !event.Test.includes('/')).map((event) => event.Test),
    subcasesPassed: passed.filter((event) => event.Test.includes('/')).length,
    requiredPassed: required,
    skipped: skipped.map((event) => event.Test),
  }
}

export function requireCompanyResults(report, readOnly = false) {
  const specs = []
  function collect(suites) {
    for (const suite of suites ?? []) {
      specs.push(...(suite.specs ?? []))
      collect(suite.suites)
    }
  }
  collect(report.suites)
  const count = readOnly ? 1 : 12
  assert.equal(report.stats.expected, count, 'Required browser children did not all execute')
  for (const key of ['skipped', 'unexpected', 'flaky'])
    assert.equal(report.stats[key], 0, `Browser ${key}`)
  assert.equal(specs.length, count, 'Unexpected child selection')
  for (const spec of specs) {
    assert.equal(spec.tests.length, 1)
    assert.equal(spec.tests[0].results.length, 1)
    assert.equal(spec.tests[0].results[0].status, 'passed', `Child did not pass: ${spec.title}`)
  }
  const company = specs.filter((spec) => spec.file.endsWith('company.fixture.ts'))
  assert.equal(company.length, readOnly ? 1 : 2)
  if (readOnly) assert.match(company[0].title, /read-only/)
  else
    for (const locale of ['en', 'nl'])
      assert.ok(
        company.some(
          (spec) =>
            spec.title ===
            `protected ${locale}: complete saved-contact and legal-company snapshot lifecycle`,
        ),
        `Missing ${locale} lifecycle`,
      )
  return specs.map((spec) => spec.title)
}
