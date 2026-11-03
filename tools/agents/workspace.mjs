#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKTREE_ROOT = '/home/vscode/worktrees';
export const EXPECTED_PARENT = '/workspaces/monorepo/odee';
const SAFE_PATH = `${path.dirname(process.execPath)}:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin`;
const FIXTURE_CAPABILITY = Symbol('owned synthetic Git fixture');
const syntheticGitFixtures = new WeakMap();

function ticketName(ticket) {
  if (typeof ticket !== 'string' || !/^[A-Z][A-Z0-9]{1,15}-[0-9]{1,8}$/i.test(ticket)) {
    throw new Error('ticket must be a ticket ID such as ODEE-002');
  }
  return ticket.toUpperCase();
}

function refName(value, label) {
  if (typeof value !== 'string' || value.length > 200 ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
      value.includes('..') || value.includes('//') ||
      value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) {
    throw new Error(`invalid ${label}: use a plain local Git ref, not options or revision expressions`);
  }
  return value;
}

function git(repo, args, allowed = [0]) {
  const result = spawnSync('git', [
    '-c', `safe.directory=${repo}`, '-c', 'core.hooksPath=/dev/null',
    '-C', repo, ...args,
  ], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      PATH: SAFE_PATH, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    },
    timeout: 30_000,
  });
  if (result.error || !allowed.includes(result.status)) {
    throw new Error(`git ${args[0]} failed (${result.status ?? result.error?.code}): ${
      result.error?.message ?? result.stderr.trim()}`);
  }
  return { output: result.stdout.trimEnd(), status: result.status };
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative);
}

function syntheticDirectory(directory) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory ||
      directory === '/tmp' || directory.startsWith('/tmp/') ||
      directory === '/var/tmp' || directory.startsWith('/var/tmp/')) {
    throw new Error('synthetic directory must be an absolute non-temporary path');
  }
  let ancestor = directory;
  for (;;) {
    try {
      if (realpathSync(ancestor) !== ancestor) throw new Error('synthetic directory must not use a symlink alias');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory) throw new Error('synthetic directory must not use a symlink alias');
}

async function canonicalDirectory(input, label) {
  const absolute = path.resolve(input);
  const real = await fs.realpath(absolute);
  if (absolute !== real || !(await fs.stat(real)).isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink alias`);
  }
  return real;
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function repositoryContext(options = {}) {
  const {
  repo = process.cwd(), expectedParent = EXPECTED_PARENT, worktreeRoot = WORKTREE_ROOT,
  } = options;
  const parent = await canonicalDirectory(expectedParent, 'expected parent');
  const root = await canonicalDirectory(repo, 'caller repo');
  for (const directory of new Set([parent, root])) {
    if (git(directory, ['rev-parse', '--show-toplevel']).output !== directory) {
      throw new Error('caller repo and expected parent must be exact Git roots, not subdirectories');
    }
    const common = git(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir']).output;
    if (common !== path.join(parent, '.git')) {
      throw new Error('caller repo does not belong to the expected parent repository');
    }
  }
  const workspaceRoot = await canonicalDirectory(worktreeRoot, 'worktree root');
  const fixture = syntheticGitFixtures.get(options[FIXTURE_CAPABILITY]);
  const ownedFixture = fixture?.parent === parent && fixture?.worktreeRoot === workspaceRoot;
  if (fixture && !ownedFixture) throw new Error('synthetic fixture cannot authorize foreign paths; production worktrees must be strictly under the external root');
  if ((!ownedFixture && workspaceRoot !== WORKTREE_ROOT && !within(WORKTREE_ROOT, workspaceRoot)) ||
      workspaceRoot === root || within(root, workspaceRoot) ||
      workspaceRoot === parent || within(parent, workspaceRoot)) {
    throw new Error(`worktrees must be strictly under ${WORKTREE_ROOT}`);
  }
  const common = await canonicalDirectory(path.join(parent, '.git'), 'Git common directory');
  return { repo: root, parent, workspaceRoot, common };
}

// The only exception to the external production root is a newly allocated fake
// repository. An unforgeable in-memory capability cannot authorize existing repos.
export async function createSyntheticGitFixture({
  scratchRoot = path.join(process.cwd(), '.local-data', 'agents'),
} = {}) {
  scratchRoot = path.resolve(scratchRoot);
  syntheticDirectory(scratchRoot);
  const scratchDir = await fs.mkdtemp(path.join(scratchRoot, 'workspace-tests-'));
  const parent = path.join(scratchDir, 'original');
  const worktreeRoot = path.join(scratchDir, 'worktrees');
  await Promise.all([parent, worktreeRoot].map(directory => fs.mkdir(directory, { mode: 0o700 })));
  git(parent, ['init', '--initial-branch=main', '--quiet']);
  git(parent, ['config', 'user.name', 'Synthetic workspace test']);
  git(parent, ['config', 'user.email', 'synthetic@example.invalid']);
  const capability = {};
  syntheticGitFixtures.set(capability, { parent, worktreeRoot });
  return {
    scratchDir,
    options: { repo: parent, expectedParent: parent, worktreeRoot, [FIXTURE_CAPABILITY]: capability },
  };
}

function worktrees(context) {
  const records = git(context.repo, ['worktree', 'list', '--porcelain', '-z']).output;
  return records.split('\0\0').filter(Boolean).map(record => Object.fromEntries(
    record.split('\0').filter(Boolean).map(line => {
      const space = line.indexOf(' ');
      return space < 0 ? [line, true] : [line.slice(0, space), line.slice(space + 1)];
    }),
  ));
}

function locations(context, ticket) {
  return {
    directory: path.join(context.workspaceRoot, `odee-${ticket.toLowerCase()}`),
    record: path.join(context.common, 'odee-workspaces', `${ticket.toLowerCase()}.json`),
  };
}

async function readOwned(context, ticket) {
  const { directory, record } = locations(context, ticket);
  if (!(await exists(record)) || (await fs.lstat(record)).isSymbolicLink()) {
    throw new Error('refusing foreign worktree: no owned workspace record');
  }
  const ownerDirectory = await canonicalDirectory(path.dirname(record), 'ownership directory');
  if (ownerDirectory !== path.join(context.common, 'odee-workspaces')) {
    throw new Error('invalid ownership directory');
  }
  const owner = JSON.parse(await fs.readFile(record, 'utf8'));
  if (owner.version !== 1 || owner.kind !== 'odee-workspace' ||
      owner.ticket !== ticket || owner.parent !== context.parent ||
      owner.directory !== directory || typeof owner.id !== 'string') {
    throw new Error('refusing foreign or invalid workspace ownership record');
  }
  refName(owner.branch, 'owned branch');
  refName(owner.base, 'owned base');
  if (owner.state !== 'active') throw new Error(`workspace is ${owner.state}; retain it for manual triage`);
  const registered = worktrees(context).find(entry => entry.worktree === directory);
  if (!registered || registered.branch !== `refs/heads/${owner.branch}` || registered.locked) {
    throw new Error('owned worktree is missing, locked, detached, or on a different branch');
  }
  await canonicalDirectory(directory, 'owned worktree');
  if (git(directory, ['rev-parse', '--show-toplevel']).output !== directory ||
      git(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir']).output !== context.common) {
    throw new Error('owned directory is not the expected registered worktree');
  }
  return { owner, directory, record };
}

export async function createWorkspace(options = {}) {
  const ticket = ticketName(options.ticket);
  const branch = refName(options.branch ?? `agents/${ticket.toLowerCase()}`, 'branch');
  const requestedBase = refName(options.base ?? 'main', 'base');
  const context = await repositoryContext(options);
  git(context.repo, ['check-ref-format', '--branch', branch]);
  const baseSha = git(context.repo, ['rev-parse', '--verify', '--end-of-options', `${requestedBase}^{commit}`]).output;
  const symbolicBase = git(context.repo, ['rev-parse', '--symbolic-full-name', '--verify', '--end-of-options', requestedBase]).output;
  const base = /^(refs\/heads\/|refs\/tags\/)/.test(symbolicBase) ? symbolicBase : baseSha;
  const { directory, record } = locations(context, ticket);
  if (await exists(directory) || await exists(record) ||
      worktrees(context).some(entry => entry.worktree === directory)) {
    throw new Error('workspace path or ownership record already exists; existing work is preserved');
  }
  if (git(context.repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], [0, 1]).status === 0) {
    throw new Error('branch already exists; existing branches are never reused');
  }
  const tracked = git(context.repo, ['ls-tree', '-r', '--name-only', '-z', baseSha]).output.split('\0');
  if (tracked.some(file => ['.env', '.env.local'].includes(path.posix.basename(file)))) {
    throw new Error('base tracks .env or .env.local; refusing to copy live configuration');
  }
  await fs.mkdir(path.dirname(record), { recursive: true, mode: 0o700 });
  return createRecordedWorkspace(context, { ticket, branch, base, baseSha, directory, record });
}

async function createRecordedWorkspace(context, details) {
  const { ticket, branch, base, baseSha, directory, record } = details;
  await canonicalDirectory(path.dirname(record), 'ownership directory');
  const owner = {
    version: 1, kind: 'odee-workspace', id: randomUUID(), ticket, branch, base, baseSha,
    parent: context.parent, directory, state: 'creating',
  };
  await fs.writeFile(record, `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    git(context.repo, ['worktree', 'add', '-b', branch, directory, baseSha]);
    owner.state = 'active';
    await fs.writeFile(record, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
    return owner;
  } catch (error) {
    throw new Error(`${error.message}; failed workspace retained for triage: ${record}`);
  }
}

export async function statusWorkspace(options = {}) {
  const ticket = ticketName(options.ticket);
  const context = await repositoryContext(options);
  const { owner, directory } = await readOwned(context, ticket);
  const dirty = git(directory, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored']).output !== '';
  const head = git(directory, ['rev-parse', 'HEAD']).output;
  const merged = git(context.repo, ['merge-base', '--is-ancestor', head, owner.base], [0, 1]).status === 0;
  return { ...owner, head, dirty, merged };
}

export async function removeWorkspace(options = {}) {
  const ticket = ticketName(options.ticket);
  const context = await repositoryContext(options);
  const { owner, directory, record } = await readOwned(context, ticket);
  if (git(directory, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored']).output) {
    throw new Error('refusing dirty worktree (including untracked/ignored files); preserve and triage it');
  }
  const head = git(directory, ['rev-parse', 'HEAD']).output;
  if (git(context.repo, ['merge-base', '--is-ancestor', head, owner.base], [0, 1]).status !== 0) {
    throw new Error(`refusing unmerged work: HEAD is not merged into ${owner.base}`);
  }
  git(context.repo, ['worktree', 'remove', directory]);
  await fs.unlink(record);
  return { ticket, directory, removed: true, branchRetained: owner.branch };
}

export async function reserveTestPort() {
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  const port = server.address().port;
  let released = false;
  return {
    port,
    // The reservation is exclusive only until release. A non-socket-activation
    // child must start immediately, detect EADDRINUSE, and reserve/retry anew.
    async release() {
      if (released) return;
      released = true;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

const TEST_PATH_KEYS = [
  'HOME', 'TMPDIR', 'TMP', 'TEMP', 'GOPATH', 'GOCACHE', 'GOMODCACHE', 'NPM_CONFIG_CACHE',
  'ODEE_TEST_SCRATCH_DIR', 'ODEE_TEST_ORIGINALS_DIR', 'ODEE_TEST_FIXTURES', 'ODEE_WEB_DIR',
];
const TEST_KEYS = new Set([
  ...TEST_PATH_KEYS, 'GOWORK', 'CI', 'NODE_ENV', 'ODEE_DEV_MODE', 'ODEE_DEMO', 'ODEE_AUTH_MODE',
  'ODEE_ADDR', 'ODEE_ORIGIN', 'ODEE_COMPANY_ID', 'ODEE_COMPANY_NAME', 'ODEE_TEST_RUN_ID',
  'MONGODB_DATABASE_ODEE',
]);

export function safeTestEnvironment(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('test environment overrides must be an object');
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!TEST_KEYS.has(key) || typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`unsafe test environment override: ${key}`);
    }
  }
  for (const [key, required] of Object.entries({
    GOWORK: 'off', ODEE_DEV_MODE: 'true', ODEE_DEMO: 'true', ODEE_AUTH_MODE: 'token',
    CI: 'true', NODE_ENV: 'test',
  })) {
    if (key in overrides && overrides[key] !== required) throw new Error(`${key} must remain ${required} for synthetic tests`);
  }
  const id = overrides.ODEE_TEST_RUN_ID ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('invalid synthetic run ID');
  const scratchDir = overrides.ODEE_TEST_SCRATCH_DIR ??
    path.join(process.cwd(), '.local-data', 'agents', `env-${randomUUID()}`);
  const addr = overrides.ODEE_ADDR ?? '127.0.0.1:0';
  const address = /^(127\.0\.0\.1|\[::1\]):([0-9]{1,5})$/.exec(addr);
  if (!address || Number(address[2]) > 65535) throw new Error('test address must be an explicit loopback IP and port');
  const origin = overrides.ODEE_ORIGIN ?? `http://${addr}`;
  if (origin !== `http://${addr}`) throw new Error('test origin must match the loopback HTTP address');
  const database = overrides.MONGODB_DATABASE_ODEE ?? `odee_test_${id.replaceAll('-', '_')}`;
  if (!/^odee_test_[a-zA-Z0-9_]{1,54}$/.test(database)) throw new Error('database must have an odee_test_ synthetic name of at most 63 bytes');
  const company = overrides.ODEE_COMPANY_ID ?? randomBytes(12).toString('hex');
  if (!/^[a-fA-F0-9]{24}$/.test(company) || /^0+$/.test(company)) throw new Error('synthetic company must be a nonzero BSON ObjectID');
  const env = {
    PATH: SAFE_PATH, LANG: 'C.UTF-8', GOWORK: 'off', NODE_ENV: 'test',
    HOME: path.join(scratchDir, 'home'), TMPDIR: path.join(scratchDir, 'scratch'),
    TMP: path.join(scratchDir, 'scratch'), TEMP: path.join(scratchDir, 'scratch'),
    GOPATH: path.join(scratchDir, 'go'), GOCACHE: path.join(scratchDir, 'go-cache'),
    GOMODCACHE: path.join(scratchDir, 'go', 'pkg', 'mod'), NPM_CONFIG_CACHE: path.join(scratchDir, 'npm-cache'),
    ODEE_DEV_MODE: 'true', ODEE_DEMO: 'true', ODEE_AUTH_MODE: 'token',
    ODEE_ADDR: addr, ODEE_ORIGIN: origin, ODEE_COMPANY_ID: company,
    ODEE_COMPANY_NAME: 'Synthetic worker', ODEE_TEST_RUN_ID: id,
    ODEE_TEST_SCRATCH_DIR: scratchDir, ODEE_TEST_ORIGINALS_DIR: path.join(scratchDir, 'originals'),
    MONGODB_DATABASE_ODEE: database, ...overrides,
  };
  for (const key of TEST_PATH_KEYS) {
    if (!(key in env)) continue;
    const value = env[key];
    if (!path.isAbsolute(value) || path.normalize(value) !== value ||
        value === '/tmp' || value.startsWith('/tmp/') || value === '/var/tmp' || value.startsWith('/var/tmp/')) {
      throw new Error(`${key} must be an absolute non-temporary synthetic path`);
    }
    if (!['ODEE_TEST_SCRATCH_DIR', 'ODEE_TEST_FIXTURES', 'ODEE_WEB_DIR'].includes(key) &&
        !within(scratchDir, value)) {
      throw new Error(`${key} must remain inside the synthetic scratch directory`);
    }
  }
  // An isolated HOME also prevents tools from loading the caller's credential
  // files. Dedicated caches avoid shared mutable test state and go.work leaks.
  for (const key of ['ODEE_TEST_SCRATCH_DIR', ...TEST_PATH_KEYS.filter(
    key => !['ODEE_TEST_SCRATCH_DIR', 'ODEE_TEST_FIXTURES', 'ODEE_WEB_DIR'].includes(key),
  )]) {
    syntheticDirectory(env[key]);
  }
  return Object.freeze(env);
}

export async function createSyntheticEnvironment({
  ticket, scratchRoot = path.join(process.cwd(), '.local-data', 'agents'),
} = {}) {
  ticket = ticketName(ticket);
  scratchRoot = path.resolve(scratchRoot);
  for (let ancestor = scratchRoot;; ancestor = path.dirname(ancestor)) {
    if (await exists(path.join(ancestor, '.odee-synthetic-owner'))) {
      throw new Error('refusing nested allocation inside another owned synthetic environment');
    }
    if (path.dirname(ancestor) === ancestor) break;
  }
  syntheticDirectory(scratchRoot);
  scratchRoot = await canonicalDirectory(scratchRoot, 'scratch root');
  const scratchDir = await fs.mkdtemp(path.join(scratchRoot, `${ticket.toLowerCase()}-`));
  const id = randomUUID();
  const originalsDir = path.join(scratchDir, 'originals');
  const home = path.join(scratchDir, 'home');
  const temporary = path.join(scratchDir, 'scratch');
  await Promise.all([originalsDir, home, temporary].map(directory => fs.mkdir(directory, { mode: 0o700 })));
  const marker = path.join(scratchDir, '.odee-synthetic-owner');
  await fs.writeFile(marker, id, { flag: 'wx', mode: 0o600 });
  const baseEnv = safeTestEnvironment({
    HOME: home,
    TMPDIR: temporary, TMP: temporary, TEMP: temporary,
    GOWORK: 'off', GOPATH: path.join(scratchDir, 'go'),
    GOCACHE: path.join(scratchDir, 'go-cache'), GOMODCACHE: path.join(scratchDir, 'go', 'pkg', 'mod'),
    NPM_CONFIG_CACHE: path.join(scratchDir, 'npm-cache'),
    ODEE_DEV_MODE: 'true', ODEE_DEMO: 'true', ODEE_AUTH_MODE: 'token',
    ODEE_COMPANY_ID: randomBytes(12).toString('hex'), ODEE_COMPANY_NAME: 'Synthetic worker',
    ODEE_TEST_RUN_ID: id, ODEE_TEST_ORIGINALS_DIR: originalsDir,
    ODEE_TEST_SCRATCH_DIR: scratchDir,
    MONGODB_DATABASE_ODEE: `odee_test_${ticket.toLowerCase().replaceAll('-', '_')}_${id.replaceAll('-', '').slice(0, 24)}`,
  });
  const reservation = await reserveTestPort();
  const env = Object.freeze({
    ...baseEnv, ODEE_ADDR: `127.0.0.1:${reservation.port}`, ODEE_ORIGIN: `http://127.0.0.1:${reservation.port}`,
  });
  return {
    id, ticket, scratchDir, originalsDir, env, reservation,
    async cleanup() {
      await reservation.release();
      if (!(await exists(scratchDir))) return;
      await canonicalDirectory(scratchDir, 'owned synthetic scratch');
      if (await fs.readFile(marker, 'utf8') !== id) throw new Error('refusing foreign synthetic scratch cleanup');
      await writableSyntheticDirectories(scratchDir);
      await fs.rm(scratchDir, { recursive: true });
    },
  };
}

async function writableSyntheticDirectories(directory) {
  const entry = await fs.lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) return;
  const handle = await fs.open(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    await handle.chmod(entry.mode | 0o700);
  } finally {
    await handle.close();
  }
  for (const child of await fs.readdir(directory, { withFileTypes: true })) {
    if (child.isDirectory() && !child.isSymbolicLink()) {
      await writableSyntheticDirectories(path.join(directory, child.name));
    }
  }
}

const HELP = `ODEE worker workspace isolation (Node 20; local Git only)
Usage:
  node tools/agents/workspace.mjs create --ticket ODEE-002 [--repo ROOT]
      [--expected-parent ROOT] [--branch agents/odee-002] [--base main]
  node tools/agents/workspace.mjs status|remove --ticket ODEE-002
      [--repo ROOT] [--expected-parent ROOT]
  node tools/agents/workspace.mjs env --ticket ODEE-002 [--repo ROOT]
      [--expected-parent ROOT]
  node tools/agents/workspace.mjs --help

Expected parent defaults to /workspaces/monorepo/odee; repo must be an exact
Git root belonging to that parent. Worktrees are /home/vscode/worktrees/odee-<ticket>.
Existing paths/branches and dirty original repositories are never altered.
Removal requires an owned, clean worktree whose HEAD is merged into its recorded
base. Git's normal worktree remove is used; branches are retained, never forced.
No .env files are copied; bases tracking .env or .env.local are rejected.

env prints JSON with a minimal synthetic demo environment, unique scratch,
original-file directory, and database name. It inherits NO caller environment.
It is not a persistent MongoDB integration setup and carries NO database URI.
The CLI releases its port before exiting: this is NOT an exclusive reservation
for a later process. Start promptly and retry EADDRINUSE with a fresh env.
Library callers can hold reservation until handoff, then release/start/retry.
Library callers must cleanup() their own synthetic scratch after child exit.
safeTestEnvironment(overrides) is a synchronous allowlisted child-env builder.
It creates isolated paths under .local-data/agents unless explicitly supplied;
its ODEE_TEST_SCRATCH_DIR identifies that synthetic scratch for later cleanup.
It defaults to port 0; browser harnesses must supply an allocated loopback port.
CLI scratch is retained for triage; delete only that known synthetic directory.
`;

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    process.stdout.write(HELP);
    return;
  }
  const [command, ...args] = argv;
  const commands = { create: createWorkspace, status: statusWorkspace, remove: removeWorkspace };
  if (!Object.hasOwn(commands, command) && command !== 'env') throw new Error('unknown command; use --help');
  const allowed = new Set(['ticket', 'repo', 'expected-parent',
    ...(command === 'create' ? ['branch', 'base'] : [])]);
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2);
    if (!args[index]?.startsWith('--') || !allowed.has(key) || key in parsed ||
        !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('unknown, duplicate, or missing option; use --help');
    }
    parsed[key] = args[index + 1];
  }
  const options = { ...parsed, expectedParent: parsed['expected-parent'] };
  if (command === 'env') {
    const context = await repositoryContext(options);
    const synthetic = await createSyntheticEnvironment({
      ticket: options.ticket,
      scratchRoot: path.join(context.repo, '.local-data', 'agents'),
    });
    await synthetic.reservation.release();
    process.stdout.write(`${JSON.stringify({
      id: synthetic.id, scratchDir: synthetic.scratchDir, originalsDir: synthetic.originalsDir,
      env: synthetic.env, portState: 'released: retry child EADDRINUSE with a fresh env',
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(await commands[command](options), null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`workspace: ${error.message}\n`);
    process.exitCode = 1;
  });
}
