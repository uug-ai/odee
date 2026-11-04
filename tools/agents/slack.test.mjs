import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { acquireLock, runCommand } from './loop.mjs';
import { safeTestEnvironment } from './workspace.mjs';
import { formatEvent, validateEvent, sendEvent, receiptStatus } from './slack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const scratch = path.join(root, '.local-data/slack-reporter/tests');
const safeEnv = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: path.join(scratch, 'environment') });
// Explicit fake config only; never copy process.env into fixtures or children.
const config = Object.freeze({ ODEE_SLACK_BOT_TOKEN: 'xoxb-synthetic-test-not-a-credential', ODEE_SLACK_CHANNEL_ID: 'C000TEST001' });
const receiptPath = '.odee/slack/receipts.json';
const candidate = {
  repo: 'synthetic/fixture', ticket: 'ODEESLACK-002', revision: 1, sha: 'a'.repeat(40),
  pr: 12, event: 'candidate', outcome: 'ready-for-qa',
  qa: { passed: 0, required: 2, status: 'pending' }, ci: 'pending',
};
let serial = 0;
function fixture(t) {
  fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(scratch, `case-${++serial}-`));
  const controlRoot = path.join(directory, 'control');
  const receiptRoot = path.join(directory, 'owned');
  fs.mkdirSync(controlRoot);
  fs.mkdirSync(receiptRoot);
  fs.writeFileSync(path.join(controlRoot, 'backlog.json'), JSON.stringify({ version: 1, tickets: [] }));
  runCommand({ root: controlRoot, backlog: 'backlog.json' }, 'init');
  const children = [];
  t.after(async () => {
    for (const processChild of children) {
      if (processChild.exitCode === null && processChild.signalCode === null) {
        processChild.kill('SIGKILL');
        await once(processChild, 'exit');
      }
    }
    fs.rmSync(directory, { recursive: true });
  });
  return {
    directory, children, root: receiptRoot, controlRoot, env: config, event: structuredClone(candidate),
    ledger: path.join(controlRoot, '.odee/loop.json'),
    receiptFile: path.join(receiptRoot, receiptPath),
    setMode(mode) {
      const state = JSON.parse(fs.readFileSync(this.ledger, 'utf8'));
      state.mode = mode;
      fs.writeFileSync(this.ledger, JSON.stringify(state));
    },
    status() { return receiptStatus(this); },
  };
}
function mock(deliver = {}) {
  const calls = [];
  const transport = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    const response = {
      ok: true, channel: body.channel, ts: `1700000000.${String(calls.length).padStart(6, '0')}`,
      ...(body.thread_ts ? { message: { thread_ts: body.thread_ts } } : {}), ...deliver,
    };
    return Response.json(response);
  };
  return { calls, transport };
}
function response(status, body = {}, headers = {}) {
  return async () => Response.json(body, { status, headers });
}
const codes = code => error => error.code === code;
function child(f, source) {
  const processChild = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: root, env: safeEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  f.children.push(processChild);
  return processChild;
}

test('concise structured formatting includes exact provenance and intermediate rationale', () => {
  const event = {
    ...candidate, event: 'progress', outcome: 'in-progress',
    findings: 'One independent role is still pending.',
    decision: 'Keep the gate pending until the exact head is tested.',
    currentAction: 'Assigning the remaining role.',
    nextSteps: 'On PASS inspect CI; on FAIL repair and retest.',
    limitations: 'Feature author tests are not independent acceptance.',
    qa: { passed: 1, required: 2, status: 'partial' }, ci: 'pass',
  };
  const text = formatEvent(event);
  for (const fragment of ['ODEESLACK-002 r1', candidate.sha, 'https://github.com/synthetic/fixture/pull/12',
    '1/2 roles PASS; overall partial', 'CI: pass', 'Observed:', 'Decision:', 'Current action:', 'Next steps:', 'Limitations:']) {
    assert.ok(text.includes(fragment), fragment);
  }
  assert.ok(!text.includes('merged'));
  assert.equal(formatEvent({ ...candidate, event: 'integration', outcome: 'local-integration' }).includes('Merge SHA:'), false);
  assert.ok(formatEvent({ ...candidate, event: 'merge', outcome: 'merged' }).includes(`Merge SHA: ${candidate.sha}`));
  assert.ok(formatEvent({ ...candidate, pr: undefined }).includes('PR: not assigned'));
});

test('rejects unknown fields, invalid statuses and inconsistent QA/merge claims', () => {
  for (const patch of [
    { source: 'not an allowed field' }, { repo: '../escape' }, { repo: 'synthetic/fixture\nbad' },
    { ticket: '@everyone' }, { revision: 0 }, { revision: '1' }, { sha: 'aaaa' },
    { repo: 'synthetic/ghp_synthetic' }, { role: 'xoxb-synthetic-token' },
    { sha: 'A'.repeat(40) }, { pr: -1 }, { pr: '12' }, { role: '<@U00000000>' }, { role: null },
    { event: 'mystery' }, { outcome: 'accepted' }, { ci: 'local-pass' },
    { qa: { passed: 3, required: 2, status: 'pass' } },
    { qa: { passed: 1, required: 2, status: 'pass' } },
    { qa: { passed: 0, required: 0, status: 'pass' } },
    { qa: { passed: 0, required: 2, status: 'partial' } },
    { qa: { passed: 1, required: 2, status: 'pending' } },
    { qa: { passed: 0, required: 2, status: 'pending', private: 'data' } },
    { event: 'merge' }, { outcome: 'merged' }, { event: 'integration' },
    { outcome: 'local-integration' }, { outcome: 'pass' }, { event: 'qa' },
  ]) assert.throws(() => validateEvent({ ...candidate, ...patch }), codes('INVALID_EVENT'));
  assert.throws(() => validateEvent({ ...candidate, event: 'qa', role: 'expert', outcome: 'pass' }), codes('INVALID_EVENT'));
  assert.doesNotThrow(() => validateEvent({
    ...candidate, sha: 'b'.repeat(64), event: 'qa', role: 'expert', outcome: 'pass',
    qa: { passed: 1, required: 2, status: 'partial' },
  }));
});

test('updateId accepts bounded stable identifiers and rejects unsafe values without echoing them', () => {
  for (const updateId of ['ci-pending', 'ci-pass', 'a', `a${'b'.repeat(47)}`]) {
    assert.doesNotThrow(() => validateEvent({ ...candidate, updateId }));
    assert.ok(formatEvent({ ...candidate, updateId }).includes(`Update: ${updateId}`));
  }
  for (const updateId of [
    '', null, 1, {}, [], 'a'.repeat(49), 'CI-PASS', ' space', 'space ', 'two words',
    '../escape', 'a/b', 'a\\b', '@everyone', '<!channel>', 'line\nbreak', 'unicode-\u202e',
    'https://example.invalid', 'xoxb-synthetic-token', 'ghp_synthetic', '__proto__',
  ]) {
    assert.throws(() => validateEvent({ ...candidate, updateId }), codes('INVALID_EVENT'));
  }
});

test('QA fail or blocked cannot claim overall PASS or all required roles passed', () => {
  for (const outcome of ['fail', 'blocked']) {
    for (const status of ['pass', 'fail', 'blocked']) {
      const event = {
        ...candidate, event: 'qa', role: 'api', outcome,
        qa: { passed: 2, required: 2, status },
      };
      assert.throws(() => validateEvent(event), codes('INVALID_EVENT'));
      assert.throws(() => formatEvent(event), codes('INVALID_EVENT'));
    }
    assert.doesNotThrow(() => validateEvent({
      ...candidate, event: 'qa', role: 'api', outcome,
      qa: { passed: 1, required: 2, status: 'fail' },
    }));
  }
  for (const status of ['fail', 'blocked']) {
    const text = formatEvent({
      ...candidate, event: 'qa', role: 'api', outcome: 'pass',
      qa: { passed: 1, required: 2, status },
    });
    assert.ok(text.includes(`overall ${status}; role api: pass`));
  }
});

test('rejects rather than echoes secrets, mentions, links, multiline dumps and injection', () => {
  for (const value of [
    'xoxb-synthetic-token-value', 'github_pat_synthetic', 'ghp_synthetic',
    'token: synthetic', 'Password=synthetic', 'api key: synthetic', 'authorization: synthetic',
    '<@U00000000>', '@everyone', '<!channel>', 'https://example.invalid/private', 'www.example.invalid',
    'email@example.invalid', 'line one\nline two', 'tab\tvalue', 'code `dump`',
    'a'.repeat(221), '0123456789', 'a'.repeat(64), ' Unicode \u202e', 'JSON {"record":"dump"}',
  ]) for (const field of ['findings', 'decision', 'currentAction', 'nextSteps', 'limitations']) {
    assert.throws(() => validateEvent({ ...candidate, [field]: value }), error =>
      error.code === 'UNSAFE_SUMMARY' && !error.message.includes(value));
  }
});

test('normal send persists only nonsecret receipts, durable dedupe and payload mismatch', async t => {
  const f = fixture(t);
  const m = mock();
  const ledger = fs.readFileSync(f.ledger, 'utf8');
  const result = await sendEvent({ ...f, ...m });
  assert.equal(result.status, 'delivered');
  assert.equal(result.parent, true);
  assert.equal(m.calls.length, 1);
  const { url, options, body } = m.calls[0];
  assert.equal(url, 'https://slack.com/api/chat.postMessage');
  assert.equal(options.redirect, 'error');
  assert.equal(options.method, 'POST');
  assert.equal(body.mrkdwn, false);
  assert.equal(body.blocks[0].text.type, 'plain_text');
  assert.equal(body.unfurl_links, false);
  assert.equal(body.link_names, false);
  assert.equal(body.thread_ts, undefined);
  assert.equal(fs.readFileSync(f.ledger, 'utf8'), ledger);
  const receipt = fs.readFileSync(f.receiptFile, 'utf8');
  assert.equal(receipt.includes(config.ODEE_SLACK_BOT_TOKEN), false);
  assert.equal(receipt.includes('Authorization'), false);
  assert.equal(receipt.includes('ready-for-qa'), false);
  assert.equal(fs.statSync(f.receiptFile).mode & 0o777, 0o600);
  const duplicate = await sendEvent({ ...f, ...m });
  assert.equal(duplicate.duplicate, true);
  assert.equal(m.calls.length, 1);
  await assert.rejects(sendEvent({ ...f, ...m, event: { ...candidate, nextSteps: 'A changed plan.' } }), codes('PAYLOAD_MISMATCH'));
  await assert.rejects(sendEvent({ ...f, ...m, env: { ...config, ODEE_SLACK_CHANNEL_ID: 'C000TEST002' } }), codes('PAYLOAD_MISMATCH'));
  assert.equal(m.calls.length, 1);
  const restarted = spawnSync(process.execPath, [path.join(here, 'slack.mjs'), 'status',
    '--root', f.root, '--control-root', f.controlRoot], { cwd: root, env: safeEnv, encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.equal(JSON.parse(restarted.stdout).events[result.id].status, 'delivered');
});

test('same-head progress updates track CI transition in one PR thread with durable per-update dedupe', async t => {
  const f = fixture(t);
  const m = mock();
  const pending = {
    ...candidate, event: 'progress', role: 'coordinator', outcome: 'in-progress', updateId: 'ci-pending',
    findings: 'CI is pending and independent QA has not completed.',
    decision: 'Keep the gate pending.',
    currentAction: 'Awaiting CI and independent QA.',
    nextSteps: 'Inspect CI and retain the independent QA requirement.',
  };
  const green = {
    ...pending, updateId: 'ci-pass', ci: 'pass',
    findings: 'CI passed but independent QA remains pending.',
    decision: 'Do not equate green CI with independent acceptance.',
    currentAction: 'Awaiting independent QA.',
    nextSteps: 'Review the exact-head independent verdicts before integration.',
  };
  const first = await sendEvent({ ...f, ...m, event: pending });
  const second = await sendEvent({ ...f, ...m, event: green });
  assert.equal(first.status, 'delivered');
  assert.equal(second.status, 'delivered');
  assert.notEqual(first.id, second.id);
  assert.equal(second.identity.sha, first.identity.sha);
  assert.equal(second.identity.revision, first.identity.revision);
  assert.equal(second.identity.role, first.identity.role);
  assert.equal(second.parent, false);
  assert.equal(m.calls[1].body.thread_ts, first.ts);
  assert.ok(m.calls[1].body.text.includes('CI: pass'));
  assert.ok(m.calls[1].body.text.includes('0/2 roles PASS; overall pending'));
  for (const event of [pending, green]) {
    const replay = await sendEvent({ ...f, ...m, event });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.status, 'delivered');
  }
  await assert.rejects(sendEvent({
    ...f, ...m, event: { ...pending, ci: 'pass' },
  }), codes('PAYLOAD_MISMATCH'));
  await assert.rejects(sendEvent({
    ...f, ...m, event: { ...green, nextSteps: 'A different plan under the same identifier.' },
  }), codes('PAYLOAD_MISMATCH'));
  assert.equal(m.calls.length, 2);
  const receipts = f.status().events;
  assert.equal(receipts[first.id].identity.updateId, 'ci-pending');
  assert.equal(receipts[second.id].identity.updateId, 'ci-pass');
});

test('absent updateId preserves original identity hashes and delivered receipts without rewriting', async t => {
  const f = fixture(t);
  const m = mock();
  const oldIdentity = {
    repo: candidate.repo, subject: `pr:${candidate.pr}`, revision: candidate.revision,
    sha: candidate.sha, event: candidate.event, role: null,
  };
  const oldId = createHash('sha256').update(JSON.stringify(
    Object.fromEntries(Object.entries(oldIdentity).sort(([a], [b]) => a.localeCompare(b))),
  )).digest('hex');
  const original = await sendEvent({ ...f, ...m });
  assert.equal(original.id, oldId);
  assert.deepEqual(original.identity, oldIdentity);
  const before = fs.readFileSync(f.receiptFile, 'utf8');
  const replay = await sendEvent({ ...f, ...m, event: { ...candidate, updateId: undefined } });
  assert.equal(replay.id, oldId);
  assert.equal(replay.duplicate, true);
  assert.equal(fs.readFileSync(f.receiptFile, 'utf8'), before);
  const identified = await sendEvent({ ...f, ...m, event: { ...candidate, updateId: 'candidate-followup' } });
  assert.notEqual(identified.id, oldId);
  assert.equal(identified.threadTs, original.ts);
  assert.deepEqual({ id: oldId, ...f.status().events[oldId] }, original,
    'old receipt must retain its exact identity and delivery');
  assert.equal(m.calls.length, 2);
});

test('one parent per repository PR with exact head, revision and role event identities', async t => {
  const f = fixture(t);
  const m = mock();
  const parent = await sendEvent({ ...f, ...m });
  const events = [
    { ...candidate, event: 'qa', role: 'api', outcome: 'pass', qa: { passed: 1, required: 2, status: 'partial' } },
    { ...candidate, event: 'qa', role: 'finance', outcome: 'blocked' },
    { ...candidate, sha: 'b'.repeat(40) },
    { ...candidate, revision: 2 },
    { ...candidate, ticket: 'ODEESLACK-003', event: 'repair', outcome: 'in-progress' },
  ];
  const ids = new Set([parent.id]);
  for (const event of events) {
    const result = await sendEvent({ ...f, ...m, event });
    ids.add(result.id);
    assert.equal(result.parent, false);
    assert.equal(m.calls.at(-1).body.thread_ts, parent.ts);
  }
  assert.equal(ids.size, 6);
  for (const event of [
    { ...candidate, pr: 13 }, { ...candidate, repo: 'another/fixture' },
    { ...candidate, pr: undefined }, { ...candidate, pr: undefined, ticket: 'ODEESLACK-003' },
  ]) {
    assert.equal((await sendEvent({ ...f, ...m, event })).parent, true);
    assert.equal(m.calls.at(-1).body.thread_ts, undefined);
  }
  await assert.rejects(sendEvent({
    ...f, ...m, event: { ...candidate, sha: 'c'.repeat(40) }, env: { ...config, ODEE_SLACK_CHANNEL_ID: 'C000TEST002' },
  }), codes('DESTINATION_MISMATCH'));
});

test('paused/stopped and missing or corrupt control fail closed without network or receipt creation', async t => {
  const f = fixture(t);
  const m = mock();
  for (const mode of ['paused', 'stopped']) {
    f.setMode(mode);
    const result = await sendEvent({ ...f, ...m, env: {} });
    assert.equal(result.status, 'suppressed');
    assert.equal(result.code, 'CONTROL_DISABLED');
    assert.equal(fs.existsSync(f.receiptFile), false);
  }
  f.setMode('invalid');
  await assert.rejects(sendEvent({ ...f, ...m }), codes('CORRUPT_STATE'));
  fs.unlinkSync(f.ledger);
  await assert.rejects(sendEvent({ ...f, ...m }), codes('NOT_INITIALIZED'));
  assert.equal(m.calls.length, 0);
});

test('final control check sees a pause after durable intent without holding scheduler lock', async t => {
  const f = fixture(t);
  const originalOpen = fs.openSync;
  const m = mock();
  let intercepted = false;
  fs.openSync = function (filename, ...args) {
    if (!intercepted && String(filename).startsWith(`${f.receiptFile}.write-`)) {
      intercepted = true;
      f.setMode('paused');
    }
    return originalOpen.call(this, filename, ...args);
  };
  try {
    const result = await sendEvent({ ...f, ...m });
    assert.equal(result.status, 'cancelled');
    assert.equal(f.status().events[result.id].status, 'cancelled');
  } finally { fs.openSync = originalOpen; }
  assert.equal(m.calls.length, 0);
});

test('missing and invalid config and options fail explicitly without sends or receipts', async t => {
  const f = fixture(t);
  const m = mock();
  for (const env of [{}, { ODEE_SLACK_BOT_TOKEN: config.ODEE_SLACK_BOT_TOKEN }, { ODEE_SLACK_CHANNEL_ID: config.ODEE_SLACK_CHANNEL_ID }]) {
    await assert.rejects(sendEvent({ ...f, ...m, env }), codes('MISSING_CONFIG'));
  }
  for (const env of [
    { ...config, ODEE_SLACK_BOT_TOKEN: 'Bearer unsafe' }, { ...config, ODEE_SLACK_BOT_TOKEN: 'xoxp-synthetic-user' },
    { ...config, ODEE_SLACK_BOT_TOKEN: `${config.ODEE_SLACK_BOT_TOKEN}\n` },
    { ...config, ODEE_SLACK_CHANNEL_ID: '#synthetic' }, { ...config, ODEE_SLACK_CHANNEL_ID: 'https://example.invalid' },
  ]) await assert.rejects(sendEvent({ ...f, ...m, env }), codes('INVALID_CONFIG'));
  for (const patch of [{ timeoutMs: 0 }, { timeoutMs: 30001 }, { retry: 'true' }, { transport: null }]) {
    await assert.rejects(sendEvent({ ...f, ...m, ...patch }), codes('INVALID_OPTIONS'));
  }
  assert.equal(m.calls.length, 0);
  assert.equal(fs.existsSync(f.receiptFile), false);
});

test('HTTP 200 ok:false is a sanitized failure, requires explicit known-safe retry', async t => {
  for (const [error, code] of [
    ['invalid_auth', 'SLACK_AUTH'], ['token_revoked', 'SLACK_AUTH'], ['missing_scope', 'SLACK_PERMISSION'],
    ['not_in_channel', 'SLACK_PERMISSION'], ['unexpected-private-server-message', 'SLACK_API_ERROR'],
  ]) {
    const f = fixture(t);
    const m = mock({ ok: false, error, secret: 'private-response-never-persist' });
    const result = await sendEvent({ ...f, ...m });
    assert.equal(result.status, 'failed');
    assert.equal(result.code, code);
    await sendEvent({ ...f, ...m });
    assert.equal(m.calls.length, 1);
    const good = mock();
    const retried = await sendEvent({ ...f, ...good, retry: true });
    assert.equal(retried.status, 'delivered');
    assert.equal(retried.history.length, 1);
    assert.equal(retried.history[0].status, 'failed');
    assert.equal(retried.history[0].code, code);
    const persisted = fs.readFileSync(f.receiptFile, 'utf8');
    assert.equal(persisted.includes(error), false);
    assert.equal(persisted.includes('private-response'), false);
  }
});

test('unexpected/malformed acknowledgement remains uncertain; no blind retry or new parent', async t => {
  const responses = [
    { ok: true, channel: 'C000OTHER01' }, { ok: true, ts: 'bad' }, { ok: true, ts: 123 },
    { ok: 'true' }, { ok: true, channel: null }, { ok: true, ts: null },
  ];
  for (const extra of responses) {
    const f = fixture(t);
    const m = mock(extra);
    const result = await sendEvent({ ...f, ...m });
    assert.equal(result.status, 'uncertain');
    assert.equal((await sendEvent({ ...f, ...m, retry: true })).duplicate, true);
    await assert.rejects(sendEvent({ ...f, ...m, event: { ...candidate, sha: 'b'.repeat(40) } }), codes('PARENT_UNCERTAIN'));
    assert.equal(m.calls.length, 1);
    assert.equal(f.status().events[result.id].status, 'uncertain');
  }
  const f = fixture(t);
  const m = mock();
  await sendEvent({ ...f, ...m });
  const wrongThread = mock({ message: { thread_ts: '1700000000.999999' } });
  const result = await sendEvent({ ...f, ...wrongThread, event: { ...candidate, event: 'progress', outcome: 'in-progress' } });
  assert.equal(result.status, 'uncertain');
});

test('HTTP status handling and bounded 429 honor retry-after without sleeping/retrying', async t => {
  for (const [status, expected] of [[400, 'failed'], [401, 'failed'], [403, 'failed'], [408, 'uncertain'],
    [500, 'uncertain'], [503, 'uncertain'], [201, 'uncertain'], [302, 'uncertain']]) {
    const f = fixture(t);
    const result = await sendEvent({ ...f, transport: response(status, { private: 'never persist' }) });
    assert.equal(result.status, expected);
    if (status === 401) assert.equal(result.code, 'HTTP_AUTH');
    if (status === 403) assert.equal(result.code, 'HTTP_PERMISSION');
    assert.equal(fs.readFileSync(f.receiptFile, 'utf8').includes('never persist'), false);
  }
  for (const retryAfter of ['120', 'bogus', '0']) {
    const f = fixture(t);
    let calls = 0;
    const transport = async () => { calls++; return Response.json({ ok: false }, { status: 429, headers: { 'Retry-After': retryAfter } }); };
    const before = Date.now();
    const result = await sendEvent({ ...f, transport });
    assert.equal(result.status, 'rate-limited');
    assert.equal(result.code, 'RATE_LIMITED');
    assert.ok(Date.parse(result.retryAt) > before);
    await sendEvent({ ...f, transport, retry: true });
    assert.equal(calls, 1);
    const state = JSON.parse(fs.readFileSync(f.receiptFile));
    state.events[result.id].retryAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(f.receiptFile, JSON.stringify(state));
    const m = mock();
    assert.equal((await sendEvent({ ...f, ...m, retry: true })).status, 'delivered');
    assert.equal(m.calls.length, 1);
  }
});

test('network loss, timeout, invalid/oversized/stalled response remain durable uncertain', async t => {
  for (const transport of [
    async () => { throw new Error('network error with private credentials'); },
    async () => new Promise(() => {}),
    async () => new Response('not json'),
    async () => new Response('x'.repeat(20000)),
    async () => new Response(new ReadableStream({ start() {} })),
  ]) {
    const f = fixture(t);
    const result = await sendEvent({ ...f, transport, timeoutMs: 20 });
    assert.equal(result.status, 'uncertain');
    assert.equal(f.status().events[result.id].status, 'uncertain');
    const m = mock();
    await sendEvent({ ...f, ...m, retry: true });
    assert.equal(m.calls.length, 0);
    assert.equal(fs.readFileSync(f.receiptFile, 'utf8').includes('private credentials'), false);
  }
});

test('delayed response after timeout cannot replace uncertain receipt or send again', async t => {
  const f = fixture(t);
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const result = await sendEvent({ ...f, timeoutMs: 10, transport: () => pending });
  assert.equal(result.status, 'uncertain');
  resolve(Response.json({ ok: true, channel: config.ODEE_SLACK_CHANNEL_ID, ts: '1700000000.000001' }));
  await new Promise(done => setImmediate(done));
  assert.equal(f.status().events[result.id].status, 'uncertain');
});

test('lost receipt commit after acknowledgement leaves durable intention and suppresses resend', async t => {
  const f = fixture(t);
  const m = mock();
  const rename = fs.renameSync;
  let commits = 0;
  fs.renameSync = function (from, to) {
    if (to === f.receiptFile && ++commits === 2) throw new Error('simulated receipt commit interruption');
    return rename.call(this, from, to);
  };
  try { await assert.rejects(sendEvent({ ...f, ...m }), /simulated receipt commit interruption/); }
  finally { fs.renameSync = rename; }
  assert.equal(m.calls.length, 1);
  assert.equal(Object.values(f.status().events)[0].status, 'intended');
  const result = await sendEvent({ ...f, ...m, retry: true });
  assert.equal(result.duplicate, true);
  assert.equal(result.status, 'intended');
  assert.equal(m.calls.length, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(f.receiptFile)), ['receipts.json']);
});

test('exclusive reporter lock spans network while scheduler controls remain available', async t => {
  const f = fixture(t);
  const m = mock();
  let release;
  const first = sendEvent({ ...f, timeoutMs: 1000, transport: (...args) => new Promise(resolve => {
    release = () => resolve(m.transport(...args));
  }) });
  assert.ok(release);
  const pending = Object.values(f.status().events)[0];
  assert.equal(pending.status, 'intended');
  assert.equal(f.status().locked, true);
  const schedulerLock = acquireLock(f.ledger);
  schedulerLock.release();
  await assert.rejects(sendEvent({ ...f, ...m }), codes('LOCKED'));
  await assert.rejects(sendEvent({ ...f, ...m, event: { ...candidate, sha: 'b'.repeat(40) } }), codes('LOCKED'));
  release();
  assert.equal((await first).status, 'delivered');
  assert.equal(f.status().locked, false);
  assert.equal(m.calls.length, 1);
});

test('process crash leaves an inspectable intention and exclusive owner; restart never blindly resends', async t => {
  const f = fixture(t);
  const source = `
    import { sendEvent } from ${JSON.stringify(path.join(here, 'slack.mjs'))};
    await sendEvent({ root: ${JSON.stringify(f.root)}, controlRoot: ${JSON.stringify(f.controlRoot)},
      env: ${JSON.stringify(config)}, event: ${JSON.stringify(candidate)}, timeoutMs: 30000,
      transport: async () => { process.send('intended'); return new Promise(() => {}); } });
  `;
  const processChild = child(f, source);
  await once(processChild, 'message');
  const intention = Object.values(f.status().events)[0];
  assert.equal(intention.status, 'intended');
  const m = mock();
  await assert.rejects(sendEvent({ ...f, ...m }), codes('LOCKED'));
  processChild.kill('SIGKILL');
  await once(processChild, 'exit');
  assert.equal(f.status().locked, true);
  await assert.rejects(sendEvent({ ...f, ...m }), codes('LOCKED'));
  // Exact owned synthetic stale lock only, after the child has exited.
  fs.unlinkSync(`${f.receiptFile}.lock`);
  const result = await sendEvent({ ...f, ...m, retry: true });
  assert.equal(result.status, 'intended');
  assert.equal(result.duplicate, true);
  assert.equal(m.calls.length, 0);
  await assert.rejects(sendEvent({ ...f, ...m, event: { ...candidate, revision: 2 } }), codes('PARENT_UNCERTAIN'));
});

test('path confinement rejects symlink roots/parents/files, hardlinks and unsafe event paths', async t => {
  const f = fixture(t);
  const m = mock();
  const outside = path.join(f.directory, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(f.root, path.join(f.directory, 'alias'));
  await assert.rejects(sendEvent({ ...f, ...m, root: path.join(f.directory, 'alias') }), codes('UNSAFE_PATH'));
  fs.symlinkSync(outside, path.join(f.root, '.odee'));
  await assert.rejects(sendEvent({ ...f, ...m }), codes('UNSAFE_PATH'));
  fs.unlinkSync(path.join(f.root, '.odee'));
  fs.mkdirSync(path.join(f.root, '.odee/slack'), { recursive: true });
  const target = path.join(outside, 'do-not-overwrite');
  fs.writeFileSync(target, 'preserved');
  for (const filename of [f.receiptFile, `${f.receiptFile}.lock`]) {
    fs.symlinkSync(target, filename);
    await assert.rejects(sendEvent({ ...f, ...m }), codes('UNSAFE_PATH'));
    assert.throws(() => f.status(), codes('UNSAFE_PATH'));
    fs.unlinkSync(filename);
    fs.linkSync(target, filename);
    await assert.rejects(sendEvent({ ...f, ...m }), codes('UNSAFE_PATH'));
    fs.unlinkSync(filename);
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserved');
  assert.equal(m.calls.length, 0);
  for (const eventPath of ['../outside/do-not-overwrite', '/etc/passwd', '.git/config', 'a\\b', 'a//b', './event.json']) {
    const result = spawnSync(process.execPath, [path.join(here, 'slack.mjs'), 'send',
      '--root', f.root, '--control-root', f.controlRoot, '--event', eventPath],
    { cwd: root, env: safeEnv, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'slack: UNSAFE_PATH');
    assert.equal(result.stdout, '');
  }
  fs.symlinkSync(target, path.join(f.root, 'event.json'));
  const result = spawnSync(process.execPath, [path.join(here, 'slack.mjs'), 'send',
    '--root', f.root, '--control-root', f.controlRoot, '--event', 'event.json'],
  { cwd: root, env: safeEnv, encoding: 'utf8' });
  assert.equal(result.stderr.trim(), 'slack: UNSAFE_PATH');
});

test('receipt path replaced by a symlink during request never overwrites its target', async t => {
  const f = fixture(t);
  const outside = path.join(f.directory, 'do-not-overwrite');
  fs.writeFileSync(outside, 'preserved');
  const m = mock();
  await assert.rejects(sendEvent({
    ...f,
    transport: async (...args) => {
      fs.renameSync(f.receiptFile, `${f.receiptFile}.retained-intention`);
      fs.symlinkSync(outside, f.receiptFile);
      return m.transport(...args);
    },
  }), codes('UNSAFE_PATH'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'preserved');
  const retained = JSON.parse(fs.readFileSync(`${f.receiptFile}.retained-intention`));
  assert.equal(Object.values(retained.events)[0].status, 'intended');
  assert.equal(m.calls.length, 1);
});

test('corrupt receipts and foreign control roots fail closed without leaking contents', async t => {
  const f = fixture(t);
  const m = mock();
  const sent = await sendEvent({ ...f, ...m });
  const original = JSON.parse(fs.readFileSync(f.receiptFile));
  for (const mutate of [
    value => { value.controlRoot = '/foreign'; },
    value => { value.events[sent.id].status = 'invented'; },
    value => { value.events[sent.id].digest = 'bad'; },
    value => { value.events[sent.id].ts = 'bad'; },
    value => { value.events[sent.id].ts = 1700000000.000001; },
    value => { value.events[sent.id].channel = [config.ODEE_SLACK_CHANNEL_ID]; },
    value => { value.events[sent.id].at = 'Jan 1 2020'; },
    value => { value.events[sent.id].identity.sha = 'bad'; },
    value => { value.events[sent.id].identity.updateId = '../unsafe'; },
    value => { value.events[sent.id].identity.updateId = null; },
    value => { value.events[sent.id].identity.updateId = 'changed-without-rekeying'; },
    value => { value.events[sent.id].code = 'private response'; },
    value => { value.private = 'private response'; },
  ]) {
    const value = structuredClone(original);
    mutate(value);
    fs.writeFileSync(f.receiptFile, JSON.stringify(value));
    await assert.rejects(sendEvent({ ...f, ...m }), codes('CORRUPT_RECEIPTS'));
    assert.throws(() => f.status(), codes('CORRUPT_RECEIPTS'));
  }
  fs.writeFileSync(f.receiptFile, '{private corrupt body');
  await assert.rejects(sendEvent({ ...f, ...m }), codes('INVALID_JSON'));
  assert.equal(m.calls.length, 1);
});

test('CLI validates arguments and reports missing config without inheriting Slack secrets', t => {
  const f = fixture(t);
  assert.equal(safeEnv.ODEE_SLACK_BOT_TOKEN, undefined);
  assert.equal(safeEnv.ODEE_SLACK_CHANNEL_ID, undefined);
  fs.writeFileSync(path.join(f.root, 'event.json'), JSON.stringify(candidate));
  const invoke = args => spawnSync(process.execPath, [path.join(here, 'slack.mjs'), ...args],
    { cwd: root, env: safeEnv, encoding: 'utf8' });
  const base = ['send', '--root', f.root, '--control-root', f.controlRoot, '--event', 'event.json'];
  assert.equal(invoke(['--help']).status, 0);
  for (const args of [[], ['other'], [...base, '--retry', '--retry'], [...base, '--token', 'secret'],
    [...base, '--root', f.root], ['status', '--root'], ['status', '--event', 'event.json']]) {
    const result = invoke(args);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes('secret'));
  }
  const missing = invoke(base);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim(), 'slack: MISSING_CONFIG');
  f.setMode('stopped');
  const stopped = invoke(base);
  assert.equal(stopped.status, 2);
  assert.equal(JSON.parse(stopped.stdout).status, 'suppressed');
  assert.equal(fs.existsSync(f.receiptFile), false);
});
