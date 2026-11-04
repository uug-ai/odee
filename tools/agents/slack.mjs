#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { acquireLock, runCommand } from './loop.mjs';

const ENDPOINT = 'https://slack.com/api/chat.postMessage';
const CHANNEL = /^[CG][A-Z0-9]{8,31}$/;
const TS = /^[1-9][0-9]{0,15}\.[0-9]{6}$/;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const DIGEST = /^[a-f0-9]{64}$/;
const EVENTS = ['progress', 'candidate', 'qa', 'repair', 'integration', 'merge', 'checkpoint'];
const OUTCOMES = ['in-progress', 'ready-for-qa', 'pass', 'fail', 'blocked', 'local-integration', 'merged', 'paused', 'stopped'];
const CI = ['not-run', 'pending', 'pass', 'fail', 'blocked', 'unavailable'];
const STATES = ['intended', 'delivered', 'failed', 'rate-limited', 'uncertain', 'cancelled'];
const CODES = ['SLACK_AUTH', 'SLACK_PERMISSION', 'SLACK_API_ERROR', 'HTTP_AUTH', 'HTTP_PERMISSION', 'HTTP_REJECTED', 'RATE_LIMITED',
  'UNCERTAIN', 'CONTROL_DISABLED'];
const SUMMARY_FIELDS = ['findings', 'decision', 'currentAction', 'nextSteps', 'limitations'];
const LABELS = ['Observed', 'Decision', 'Current action', 'Next steps', 'Limitations'];
const SECRET = /xox[baprs]-|github_pat_|gh[pousr]_|AKIA[0-9A-Z]|-----BEGIN|(?:token|secret|password|api[-_ ]?key|authorization|cookie)\s*[:=]/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stamp = () => new Date().toISOString();
const stable = value => object(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  : JSON.stringify(value);
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const timestamp = value => typeof value === 'string' &&
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const slackTimestamp = value => typeof value === 'string' && TS.test(value);
function check(condition, code = 'INVALID_EVENT') {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}
function keys(value, allowed, code = 'INVALID_EVENT') {
  check(object(value) && Object.keys(value).every(key => allowed.includes(key)), code);
}
function identityFor(event) {
  return {
    repo: event.repo, subject: event.pr ? `pr:${event.pr}` : `ticket:${event.ticket}`,
    revision: event.revision, sha: event.sha, event: event.event, role: event.role ?? null,
  };
}
function validIdentity(value) {
  keys(value, ['repo', 'subject', 'revision', 'sha', 'event', 'role'], 'CORRUPT_RECEIPTS');
  check(typeof value.repo === 'string' && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9_.-]{0,99}$/.test(value.repo) &&
    typeof value.subject === 'string' && /^(?:pr:[1-9][0-9]{0,8}|ticket:[A-Z][A-Z0-9]{1,15}-[0-9]{1,8})$/.test(value.subject) &&
    Number.isSafeInteger(value.revision) && value.revision > 0 && typeof value.sha === 'string' && SHA.test(value.sha) &&
    EVENTS.includes(value.event) && (value.role === null ||
      (typeof value.role === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value.role))) &&
    !SECRET.test(value.repo) && !SECRET.test(value.subject) && !SECRET.test(value.role ?? ''), 'CORRUPT_RECEIPTS');
}
function summary(value) {
  check(typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 220 &&
    /^[A-Za-z0-9 .,;:!?()/'_-]+$/.test(value) &&
    !/https?:|www\.|[A-Za-z0-9_-]{33,}|[0-9]{7,}/i.test(value) && !SECRET.test(value),
  'UNSAFE_SUMMARY');
  return value;
}
export function validateEvent(input) {
  keys(input, ['repo', 'ticket', 'revision', 'sha', 'pr', 'event', 'role', 'outcome', 'qa', 'ci', ...SUMMARY_FIELDS]);
  check(typeof input.ticket === 'string' && /^[A-Z][A-Z0-9]{1,15}-[0-9]{1,8}$/.test(input.ticket));
  check(input.pr === undefined || (Number.isSafeInteger(input.pr) && input.pr > 0 && input.pr <= 999999999));
  check(input.role === undefined || typeof input.role === 'string');
  const event = { ...input, qa: { ...input.qa } };
  // Use one identity grammar for supplied events and receipts; never echo bad input.
  try { validIdentity(identityFor(event)); } catch { check(false); }
  check(OUTCOMES.includes(event.outcome) && CI.includes(event.ci));
  keys(input.qa, ['passed', 'required', 'status']);
  check(Number.isSafeInteger(event.qa.passed) && Number.isSafeInteger(event.qa.required) &&
    event.qa.required >= 0 && event.qa.required <= 100 && event.qa.passed >= 0 &&
    event.qa.passed <= event.qa.required && ['pending', 'partial', 'pass', 'fail', 'blocked'].includes(event.qa.status));
  check(event.qa.status !== 'pass' || (event.qa.required > 0 && event.qa.passed === event.qa.required));
  check(event.qa.status !== 'partial' || (event.qa.passed > 0 && event.qa.passed < event.qa.required));
  check(event.qa.status !== 'pending' || event.qa.passed === 0);
  check((event.event === 'merge') === (event.outcome === 'merged'));
  check((event.event === 'integration') === (event.outcome === 'local-integration'));
  check(event.outcome !== 'pass' || (event.event === 'qa' && event.role !== undefined && event.qa.passed > 0));
  check(event.event !== 'qa' || event.role !== undefined);
  for (const field of SUMMARY_FIELDS) if (input[field] !== undefined) event[field] = summary(input[field]);
  return event;
}
export function formatEvent(input) {
  const event = validateEvent(input);
  const lines = [
    `${event.repo} | ${event.ticket} r${event.revision} | ${event.event}: ${event.outcome}`,
    `${event.event === 'merge' ? 'Merge' : 'Candidate'} SHA: ${event.sha}`,
    event.pr ? `PR: https://github.com/${event.repo}/pull/${event.pr}` : 'PR: not assigned',
    `QA: ${event.qa.passed}/${event.qa.required} roles PASS; overall ${event.qa.status}` +
      (event.role ? `; role ${event.role}: ${event.outcome}` : ''),
    `CI: ${event.ci} (reported remote status; local tests are not CI)`,
  ];
  for (let i = 0; i < SUMMARY_FIELDS.length; i++) {
    if (event[SUMMARY_FIELDS[i]]) lines.push(`${LABELS[i]}: ${event[SUMMARY_FIELDS[i]]}`);
  }
  return lines.join('\n');
}

function directory(root) {
  check(typeof root === 'string' && path.isAbsolute(root) && path.normalize(root) === root, 'UNSAFE_PATH');
  check(fs.realpathSync(root) === root && fs.statSync(root).isDirectory(), 'UNSAFE_PATH');
  return root;
}
function confined(root, relative, mkdir = false) {
  check(typeof relative === 'string' && relative.length > 0 &&
    !relative.includes('\\') && !relative.includes(':') && !/[\x00-\x1f]/.test(relative) &&
    !path.isAbsolute(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..') &&
    relative.split('/')[0] !== '.git', 'UNSAFE_PATH');
  directory(root);
  let target = root;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    target = path.join(target, parts[i]);
    let stat;
    try { stat = fs.lstatSync(target); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (mkdir && i < parts.length - 1) {
        fs.mkdirSync(target, { mode: 0o700 });
        stat = fs.lstatSync(target);
      }
    }
    if (stat) check(!stat.isSymbolicLink() &&
      (i < parts.length - 1 ? stat.isDirectory() : stat.isFile() && stat.nlink === 1), 'UNSAFE_PATH');
  }
  return target;
}
function readJson(root, relative, max = 2 * 1024 * 1024) {
  const filename = confined(root, relative);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    check(stat.isFile() && stat.nlink === 1 && stat.size <= max, 'UNSAFE_PATH');
    try { return JSON.parse(fs.readFileSync(fd, 'utf8')); }
    catch (error) { if (error instanceof SyntaxError) check(false, 'INVALID_JSON'); throw error; }
  } finally { fs.closeSync(fd); }
}
const RECEIPTS = '.odee/slack/receipts.json';
function load(root, controlRoot) {
  let value;
  try { value = readJson(root, RECEIPTS, 16 * 1024 * 1024); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, controlRoot, events: {} };
  }
  keys(value, ['version', 'controlRoot', 'events'], 'CORRUPT_RECEIPTS');
  check(value.version === 1 && value.controlRoot === controlRoot && object(value.events) &&
    Object.keys(value.events).length <= 2000, 'CORRUPT_RECEIPTS');
  for (const [id, receipt] of Object.entries(value.events)) {
    keys(receipt, ['identity', 'digest', 'status', 'at', 'channel', 'parent', 'threadTs', 'ts', 'code', 'retryAt', 'history'], 'CORRUPT_RECEIPTS');
    validIdentity(receipt.identity);
    check(id === hash(receipt.identity) && typeof receipt.digest === 'string' && DIGEST.test(receipt.digest) &&
      STATES.includes(receipt.status) && timestamp(receipt.at) &&
      typeof receipt.channel === 'string' && CHANNEL.test(receipt.channel) &&
      typeof receipt.parent === 'boolean' && (receipt.parent ? receipt.threadTs === undefined : slackTimestamp(receipt.threadTs)) &&
      (receipt.ts === undefined || slackTimestamp(receipt.ts)) &&
      (receipt.code === undefined || CODES.includes(receipt.code)) &&
      (receipt.retryAt === undefined || timestamp(receipt.retryAt)) &&
      (receipt.status !== 'delivered' || slackTimestamp(receipt.ts)) &&
      (['intended', 'delivered'].includes(receipt.status) ? receipt.code === undefined : CODES.includes(receipt.code)) &&
      Array.isArray(receipt.history) && receipt.history.length <= 20, 'CORRUPT_RECEIPTS');
    for (const past of receipt.history) {
      keys(past, ['status', 'at', 'code', 'retryAt'], 'CORRUPT_RECEIPTS');
      check(['failed', 'rate-limited', 'cancelled'].includes(past.status) &&
        timestamp(past.at) && CODES.includes(past.code) &&
        (past.retryAt === undefined || timestamp(past.retryAt)), 'CORRUPT_RECEIPTS');
    }
  }
  return value;
}
function save(root, value, lock) {
  lock.assert();
  const filename = confined(root, RECEIPTS);
  const scratch = `${filename}.write-${randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(scratch, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    confined(root, RECEIPTS);
    fs.renameSync(scratch, filename);
    const dir = fs.openSync(path.dirname(filename), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(scratch)) fs.unlinkSync(scratch);
  }
}
function control(controlRoot) {
  directory(controlRoot);
  // Full ledger validation, read-only: never acquire/hold the scheduler state lock.
  return runCommand({ root: controlRoot }, 'status').mode;
}
function config(env) {
  const token = env.ODEE_SLACK_BOT_TOKEN;
  const channel = env.ODEE_SLACK_CHANNEL_ID;
  check(token && channel, 'MISSING_CONFIG');
  check(typeof token === 'string' && /^xoxb-[A-Za-z0-9-]{10,240}$/.test(token) &&
    typeof channel === 'string' && CHANNEL.test(channel), 'INVALID_CONFIG');
  return { token, channel };
}
function apiCode(error) {
  if (['not_authed', 'invalid_auth', 'token_revoked', 'account_inactive', 'token_expired'].includes(error)) return 'SLACK_AUTH';
  if (['missing_scope', 'no_permission', 'not_in_channel', 'channel_not_found', 'is_archived'].includes(error)) return 'SLACK_PERMISSION';
  return 'SLACK_API_ERROR';
}
async function responseJson(response) {
  check(response.body && typeof response.body.getReader === 'function', 'UNCERTAIN');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(size <= 16384, 'UNCERTAIN');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    // Do not await a potentially stalled remote cancellation.
    reader.cancel().catch(() => {});
  }
}
async function attempt(transport, token, payload, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await transport(ENDPOINT, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
        });
        if (response.status === 429) {
          const raw = response.headers.get('retry-after');
          const seconds = typeof raw === 'string' && /^[0-9]{1,6}$/.test(raw) ? Math.max(1, Number(raw)) : 60;
          return { status: 'rate-limited', code: 'RATE_LIMITED', retryAt: new Date(Date.now() + seconds * 1000).toISOString() };
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
          return { status: 'failed', code: response.status === 401 ? 'HTTP_AUTH' :
            response.status === 403 ? 'HTTP_PERMISSION' : 'HTTP_REJECTED' };
        }
        if (response.status !== 200) return { status: 'uncertain', code: 'UNCERTAIN' };
        const result = await responseJson(response);
        if (object(result) && result.ok === false) return { status: 'failed', code: apiCode(result.error) };
        if (!object(result) || result.ok !== true || result.channel !== payload.channel ||
            typeof result.ts !== 'string' || !TS.test(result.ts) ||
            (payload.thread_ts && result.message?.thread_ts !== payload.thread_ts)) {
          return { status: 'uncertain', code: 'UNCERTAIN' };
        }
        return { status: 'delivered', ts: result.ts };
      })(),
      new Promise(resolve => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: 'uncertain', code: 'UNCERTAIN' });
        }, timeoutMs);
      }),
    ]);
  } catch {
    return { status: 'uncertain', code: 'UNCERTAIN' };
  } finally { clearTimeout(timer); }
}

export function receiptStatus({ root, controlRoot }) {
  directory(root);
  directory(controlRoot);
  const filename = confined(root, RECEIPTS);
  confined(root, `${RECEIPTS}.lock`);
  return { ...load(root, controlRoot), locked: fs.existsSync(`${filename}.lock`) };
}

export async function sendEvent({
  root, controlRoot, event: input, env = process.env, transport = globalThis.fetch,
  timeoutMs = 10000, retry = false,
}) {
  directory(root);
  directory(controlRoot);
  check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30000 &&
    typeof retry === 'boolean' && typeof transport === 'function', 'INVALID_OPTIONS');
  const event = validateEvent(input);
  const identity = identityFor(event);
  const id = hash(identity);
  if (control(controlRoot) !== 'running') return { id, status: 'suppressed', code: 'CONTROL_DISABLED' };
  const { token, channel } = config(env);
  const digest = hash({ event, channel });
  const filename = confined(root, RECEIPTS, true);
  confined(root, `${RECEIPTS}.lock`);
  const lock = acquireLock(filename);
  try {
    const state = load(root, controlRoot);
    const previous = state.events[id];
    if (previous) {
      check(previous.digest === digest, 'PAYLOAD_MISMATCH');
      if (!retry || !['failed', 'rate-limited', 'cancelled'].includes(previous.status)) {
        return { id, ...previous, duplicate: true };
      }
      if (previous.retryAt && Date.now() < Date.parse(previous.retryAt)) {
        return { id, ...previous, duplicate: true };
      }
      check(previous.history.length < 20, 'RETRY_LIMIT');
    }
    const related = Object.values(state.events).filter(receipt =>
      receipt.identity.repo === identity.repo && receipt.identity.subject === identity.subject);
    check(related.every(receipt => receipt.channel === channel), 'DESTINATION_MISMATCH');
    check(!related.some(receipt => receipt.parent && ['intended', 'uncertain'].includes(receipt.status)), 'PARENT_UNCERTAIN');
    const parent = related.find(receipt => receipt.parent && receipt.status === 'delivered');
    check(previous || Object.keys(state.events).length < 2000, 'RECEIPTS_FULL');
    const receipt = {
      identity, digest, status: 'intended', at: stamp(), channel, parent: !parent,
      history: previous ? [...previous.history, {
        status: previous.status, at: previous.at, code: previous.code,
        ...(previous.retryAt ? { retryAt: previous.retryAt } : {}),
      }] : [],
      ...(parent ? { threadTs: parent.ts } : {}),
    };
    state.events[id] = receipt;
    save(root, state, lock);
    // Persist intent BEFORE the final cooperative control check and any network IO.
    // A crash from here is uncertain even if the request had not yet started.
    if (control(controlRoot) !== 'running') {
      Object.assign(receipt, { status: 'cancelled', code: 'CONTROL_DISABLED', at: stamp() });
      save(root, state, lock);
      return { id, ...receipt };
    }
    const text = formatEvent(event);
    const result = await attempt(transport, token, {
      channel, text, blocks: [{ type: 'section', text: { type: 'plain_text', text, emoji: false } }],
      mrkdwn: false, parse: 'none', link_names: false, unfurl_links: false, unfurl_media: false,
      ...(parent ? { thread_ts: parent.ts } : {}),
    }, timeoutMs);
    Object.assign(receipt, result, { at: stamp() });
    save(root, state, lock);
    return { id, ...receipt };
  } finally { lock.release(); }
}

export const HELP = `Bounded coordinator Slack reporter (Node 20+), no daemon.
node tools/agents/slack.mjs send --root ABS_RECEIPT_ROOT --control-root ABS_SHARED_ROOT --event RELATIVE_JSON [--retry]
node tools/agents/slack.mjs status --root ABS_RECEIPT_ROOT --control-root ABS_SHARED_ROOT
Environment ONLY: ODEE_SLACK_BOT_TOKEN (bot chat:write), ODEE_SLACK_CHANNEL_ID.
Event schema and safety/recovery limits: docs/agents.md, Slack progress reporting.
Receipts: ROOT/.odee/slack/receipts.json. No scheduler mutations or automatic retries.
--retry permits only known failed/rate-limited/cancelled events, after retryAt.
Intended/uncertain events are NEVER retried; inspect receipts and reconcile manually.
Exit 0: delivered/status/help; 1: failure/uncertain; 2: control suppressed/cancelled.
`;
export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return 0; }
    const [command, ...args] = argv;
    check(['send', 'status'].includes(command), 'INVALID_OPTIONS');
    const options = {};
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      check(['--root', '--control-root', ...(command === 'send' ? ['--event', '--retry'] : [])].includes(flag) &&
        !Object.hasOwn(options, flag), 'INVALID_OPTIONS');
      if (flag === '--retry') options[flag] = true;
      else {
        check(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'INVALID_OPTIONS');
        options[flag] = args[++i];
      }
    }
    const context = { root: options['--root'], controlRoot: options['--control-root'] };
    directory(context.root);
    directory(context.controlRoot);
    const result = command === 'status' ? receiptStatus(context) : await sendEvent({
      ...context, event: readJson(context.root, options['--event'], 8192), retry: options['--retry'] ?? false,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (command === 'status' || result.status === 'delivered') return 0;
    return ['suppressed', 'cancelled'].includes(result.status) ? 2 : 1;
  } catch (error) {
    // Never print native error messages, input, response bodies, or request headers.
    const safeCodes = ['INVALID_EVENT', 'UNSAFE_SUMMARY', 'UNSAFE_PATH', 'INVALID_JSON', 'INVALID_OPTIONS',
      'CORRUPT_RECEIPTS', 'MISSING_CONFIG', 'INVALID_CONFIG', 'PAYLOAD_MISMATCH', 'DESTINATION_MISMATCH',
      'PARENT_UNCERTAIN', 'RECEIPTS_FULL', 'RETRY_LIMIT', 'LOCKED', 'LOCK_LOST', 'NOT_INITIALIZED', 'CORRUPT_STATE', 'ENOENT'];
    process.stderr.write(`slack: ${safeCodes.includes(error.code) ? error.code : 'REPORTER_ERROR'}\n`);
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
