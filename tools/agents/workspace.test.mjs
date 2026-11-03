import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import {
  WORKTREE_ROOT, createWorkspace, statusWorkspace, removeWorkspace,
  createSyntheticEnvironment, reserveTestPort, safeTestEnvironment,
  createSyntheticGitFixture,
} from './workspace.mjs';

const cli = path.resolve(import.meta.dirname, 'workspace.mjs');

function git(repo, ...args) {
  const result = spawnSync('git', [
    '-c', `safe.directory=${repo}`, '-c', 'core.hooksPath=/dev/null', '-C', repo, ...args,
  ], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

async function fixture(t) {
  // Both roots are unique and disposable; no actual ODEE worktree is touched.
  const localRoot = path.join(process.cwd(), '.local-data');
  const generated = await createSyntheticGitFixture({ scratchRoot: localRoot });
  const scratch = generated.scratchDir;
  const { repo: original, worktreeRoot } = generated.options;
  await fs.writeFile(path.join(original, 'fixture.txt'), 'synthetic baseline\n');
  git(original, 'add', 'fixture.txt');
  git(original, 'commit', '--quiet', '-m', 'Synthetic baseline');
  const options = generated.options;
  t.after(async () => {
    const records = git(original, 'worktree', 'list', '--porcelain').split('\n\n');
    let retained = false;
    for (const record of records) {
      const directory = record.split('\n').find(line => line.startsWith('worktree '))?.slice(9);
      if (!directory || directory === original) continue;
      assert.ok(directory.startsWith(`${worktreeRoot}${path.sep}`), 'fixture must never clean a real worktree');
      const head = git(directory, 'rev-parse', 'HEAD');
      const merged = spawnSync('git', [
        '-c', `safe.directory=${original}`, '-C', original, 'merge-base', '--is-ancestor', head, 'main',
      ]).status === 0;
      if (git(directory, 'status', '--porcelain', '--untracked-files=all', '--ignored') || !merged) {
        t.diagnostic(`retained failed synthetic fixture for triage: ${directory}`);
        retained = true;
      } else {
        git(original, 'worktree', 'remove', directory);
      }
    }
    if (!retained) {
      await fs.rm(worktreeRoot, { recursive: true });
      await fs.rm(scratch, { recursive: true });
    }
  });
  return { ...options, original, scratch, options };
}

async function missing(target) {
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
}

test('create and normal owned cleanup preserve dirty original and never copy ignored env files', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.original, '.gitignore'), '.env\n.env.local\n');
  git(f.original, 'add', '.gitignore');
  git(f.original, 'commit', '--quiet', '-m', 'Ignore live local settings');
  await fs.writeFile(path.join(f.original, 'fixture.txt'), 'uncommitted original work\n');
  await fs.writeFile(path.join(f.original, '.env'), 'MONGODB_URI=live-do-not-copy\n');
  await fs.writeFile(path.join(f.original, '.env.local'), 'PROVIDER_SECRET=live-do-not-copy\n');
  const before = git(f.original, 'status', '--porcelain', '--ignored');
  const workspace = await createWorkspace({ ...f.options, ticket: 'ODEE-002' });
  assert.equal(workspace.directory, path.join(f.worktreeRoot, 'odee-odee-002'));
  assert.equal(await fs.readFile(path.join(workspace.directory, 'fixture.txt'), 'utf8'), 'synthetic baseline\n');
  await missing(path.join(workspace.directory, '.env'));
  await missing(path.join(workspace.directory, '.env.local'));
  const status = await statusWorkspace({ ...f.options, ticket: 'odee-002' });
  assert.equal(status.dirty, false);
  assert.equal(status.merged, true);
  assert.equal(status.base, 'refs/heads/main');
  const result = await removeWorkspace({ ...f.options, ticket: 'ODEE-002' });
  assert.equal(result.removed, true);
  assert.equal(result.branchRetained, 'agents/odee-002');
  await missing(workspace.directory);
  assert.equal(git(f.original, 'status', '--porcelain', '--ignored'), before);
  assert.equal(await fs.readFile(path.join(f.original, '.env.local'), 'utf8'), 'PROVIDER_SECRET=live-do-not-copy\n');
});

test('reject traversal, ref injection, foreign roots, non-root callers, and outside worktree roots', async t => {
  const f = await fixture(t);
  for (const ticket of ['../ODEE-002', '/ODEE-002', 'ODEE-002/../003', '--help', 'ODEE-002;touch nope']) {
    await assert.rejects(createWorkspace({ ...f.options, ticket }), /ticket/);
  }
  for (const branch of ['--detach', '../bad', 'x;touch nope', 'x..y', 'x//y', 'x.lock', 'a/@{1}']) {
    await assert.rejects(createWorkspace({ ...f.options, ticket: 'ODEE-002', branch }), /invalid branch/);
  }
  for (const base of ['--help', 'main~1', 'main^{commit}', '../main', 'main;echo nope']) {
    await assert.rejects(createWorkspace({ ...f.options, ticket: 'ODEE-002', base }), /invalid base/);
  }
  await fs.mkdir(path.join(f.original, 'subdirectory'));
  await assert.rejects(createWorkspace({
    ...f.options, repo: path.join(f.original, 'subdirectory'), ticket: 'ODEE-002',
  }), /exact Git roots/);
  const foreign = await fixture(t);
  await assert.rejects(createWorkspace({
    ...f.options, repo: foreign.original, ticket: 'ODEE-002',
  }), /expected parent/);
  await assert.rejects(createWorkspace({
    ...f.options, repo: foreign.original, expectedParent: foreign.original, ticket: 'ODEE-002',
  }), /strictly under/);
  await assert.rejects(createWorkspace({
    ...f.options, ticket: 'ODEE-002', worktreeRoot: f.original,
  }), /strictly under/);
  const alias = path.join(f.scratch, 'worker-alias');
  await fs.symlink(f.worktreeRoot, alias);
  await assert.rejects(createWorkspace({
    ...f.options, ticket: 'ODEE-002', worktreeRoot: alias,
  }), /symlink alias/);
});

test('existing paths, branches, and foreign worktrees are preserved, not adopted', async t => {
  const f = await fixture(t);
  const directory = path.join(f.worktreeRoot, 'odee-odee-002');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'sentinel'), 'foreign files');
  await assert.rejects(createWorkspace({ ...f.options, ticket: 'ODEE-002' }), /already exists/);
  await assert.rejects(removeWorkspace({ ...f.options, ticket: 'ODEE-002' }), /foreign worktree/);
  assert.equal(await fs.readFile(path.join(directory, 'sentinel'), 'utf8'), 'foreign files');
  const foreignWorktree = path.join(f.worktreeRoot, 'odee-odee-003');
  git(f.original, 'worktree', 'add', '--quiet', '-b', 'foreign', foreignWorktree, 'main');
  await assert.rejects(createWorkspace({ ...f.options, ticket: 'ODEE-003' }), /already exists/);
  await assert.rejects(removeWorkspace({ ...f.options, ticket: 'ODEE-003' }), /foreign worktree/);
  assert.equal(git(foreignWorktree, 'branch', '--show-current'), 'foreign');
  git(f.original, 'branch', 'already-here');
  await assert.rejects(createWorkspace({
    ...f.options, ticket: 'ODEE-004', branch: 'already-here',
  }), /branch already exists/);
  assert.equal(git(f.original, 'rev-parse', 'already-here'), git(f.original, 'rev-parse', 'main'));
});

test('dirty, ignored, unmerged, and switched worktrees cannot be discarded', async t => {
  const f = await fixture(t);
  const options = { ...f.options, ticket: 'ODEE-002', base: 'HEAD' };
  const workspace = await createWorkspace(options);
  const target = path.join(workspace.directory, 'fixture.txt');
  await fs.writeFile(target, 'unique uncommitted worker work\n');
  await assert.rejects(removeWorkspace(options), /dirty worktree/);
  assert.equal(await fs.readFile(target, 'utf8'), 'unique uncommitted worker work\n');
  git(workspace.directory, 'add', 'fixture.txt');
  git(workspace.directory, 'commit', '--quiet', '-m', 'Synthetic worker change');
  assert.equal((await statusWorkspace(options)).merged, false);
  // Even calling from the worker cannot make HEAD itself count as the merge base.
  await assert.rejects(removeWorkspace({ ...options, repo: workspace.directory }), /unmerged work/);
  git(f.original, 'merge', '--quiet', '--ff-only', workspace.branch);
  await fs.writeFile(path.join(workspace.directory, '.gitignore'), 'ignored-secret\n');
  git(workspace.directory, 'add', '.gitignore');
  git(workspace.directory, 'commit', '--quiet', '-m', 'Synthetic ignore file');
  git(f.original, 'merge', '--quiet', '--ff-only', workspace.branch);
  const ignored = path.join(workspace.directory, 'ignored-secret');
  await fs.writeFile(ignored, 'keep this');
  await assert.rejects(removeWorkspace(options), /dirty worktree/);
  assert.equal(await fs.readFile(ignored, 'utf8'), 'keep this');
  await fs.unlink(ignored);
  git(workspace.directory, 'checkout', '--quiet', '-b', 'other-worker');
  await assert.rejects(removeWorkspace(options), /different branch/);
  git(workspace.directory, 'checkout', '--quiet', workspace.branch);
  git(f.original, 'worktree', 'lock', workspace.directory);
  await assert.rejects(removeWorkspace(options), /locked/);
  git(f.original, 'worktree', 'unlock', workspace.directory);
  await removeWorkspace(options);
});

test('tracked .env files are rejected and failed Git subprocesses are explicit', async t => {
  const f = await fixture(t);
  await assert.rejects(createWorkspace({
    ...f.options, ticket: 'ODEE-002', base: 'missing-base',
  }), /git rev-parse failed \(128\)/);
  await missing(path.join(f.worktreeRoot, 'odee-odee-002'));
  for (const file of ['.env', '.env.local']) {
    await fs.writeFile(path.join(f.original, file), 'synthetic-only fixture\n');
    git(f.original, 'add', file);
    git(f.original, 'commit', '--quiet', '-m', 'Synthetic tracked configuration');
    await assert.rejects(createWorkspace({ ...f.options, ticket: 'ODEE-003' }), /refusing to copy/);
    git(f.original, 'rm', '--quiet', file);
    git(f.original, 'commit', '--quiet', '-m', 'Remove synthetic tracked configuration');
  }
  git(f.original, 'branch', 'agents');
  await assert.rejects(createWorkspace({ ...f.options, ticket: 'ODEE-004' }), /git worktree failed [\s\S]*retained for triage/);
  const record = JSON.parse(await fs.readFile(path.join(f.original, '.git', 'odee-workspaces', 'odee-004.json'), 'utf8'));
  assert.equal(record.state, 'creating');
  await assert.rejects(removeWorkspace({ ...f.options, ticket: 'ODEE-004' }), /manual triage/);
});

test('simultaneous workspaces isolate tickets and a duplicate ticket never replaces its owner', async t => {
  const f = await fixture(t);
  const created = await Promise.all(['ODEE-002', 'ODEE-003'].map(ticket => createWorkspace({ ...f.options, ticket })));
  assert.notEqual(created[0].directory, created[1].directory);
  assert.notEqual(created[0].branch, created[1].branch);
  await fs.writeFile(path.join(created[0].directory, 'fixture.txt'), 'first worker only\n');
  assert.equal(await fs.readFile(path.join(created[1].directory, 'fixture.txt'), 'utf8'), 'synthetic baseline\n');
  git(created[0].directory, 'restore', 'fixture.txt');
  const attempts = await Promise.allSettled([1, 2].map(() => createWorkspace({ ...f.options, ticket: 'ODEE-004' })));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
  for (const ticket of ['ODEE-002', 'ODEE-003', 'ODEE-004']) {
    await removeWorkspace({ ...f.options, ticket });
  }
});

async function tryListen(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return () => new Promise(resolve => server.close(resolve));
}

test('port reservations really hold the socket until an explicit, non-exclusive handoff', async () => {
  const reservation = await reserveTestPort();
  try {
    await assert.rejects(tryListen(reservation.port), { code: 'EADDRINUSE' });
    await reservation.release();
    const close = await tryListen(reservation.port);
    await close();
    await reservation.release();
  } finally {
    await reservation.release();
  }
});

test('concurrent synthetic environments inherit no live settings or secrets and isolate originals and ports', async t => {
  const f = await fixture(t);
  const poison = {
    MONGODB_URI: 'mongodb://live.invalid/production', ODEE_TEST_MONGODB_URI: 'mongodb://live.invalid/test',
    ODEE_API_TOKEN: 'live-token', ODEE_DEMO: 'false', ODEE_DEV_MODE: 'false',
    ODEE_ADDR: '0.0.0.0:8098', ODEE_AUTH_MODE: 'github', ODEE_ORIGIN: 'https://live.invalid',
    GITHUB_TOKEN: 'live-gh', GITHUB_CLIENT_SECRET: 'live-client', SESSION_SECRET: 'live-session',
    AWS_ACCESS_KEY_ID: 'live-aws', AWS_SECRET_ACCESS_KEY: 'live-aws-secret',
    AZURE_OPENAI_API_KEY: 'live-provider', GOOGLE_APPLICATION_CREDENTIALS: '/live/credentials',
    NODE_OPTIONS: '--require=/live/plugin.cjs', GOWORK: '/live/go.work', HTTPS_PROXY: 'https://live-proxy.invalid',
  };
  const previous = Object.fromEntries(Object.keys(poison).map(key => [key, process.env[key]]));
  Object.assign(process.env, poison);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const runs = await Promise.all([1, 2, 3].map(() => createSyntheticEnvironment({
    ticket: 'ODEE-002', scratchRoot: path.join(f.scratch, 'synthetic'),
  })));
  t.after(async () => { await Promise.all(runs.map(run => run.cleanup())); });
  for (const property of ['id', 'scratchDir', 'originalsDir']) {
    assert.equal(new Set(runs.map(run => run[property])).size, runs.length);
  }
  assert.equal(new Set(runs.map(run => run.env.MONGODB_DATABASE_ODEE)).size, runs.length);
  assert.equal(new Set(runs.map(run => run.reservation.port)).size, runs.length);
  for (const run of runs) {
    assert.equal(run.env.GOWORK, 'off');
    assert.equal(run.env.ODEE_DEMO, 'true');
    assert.equal(run.env.ODEE_DEV_MODE, 'true');
    assert.match(run.env.ODEE_ADDR, /^127\.0\.0\.1:\d+$/);
    await assert.rejects(tryListen(run.reservation.port), { code: 'EADDRINUSE' });
    assert.ok(run.env.HOME.startsWith(run.scratchDir));
    assert.ok(run.env.GOCACHE.startsWith(run.scratchDir));
    for (const [key, value] of Object.entries(poison)) assert.notEqual(run.env[key], value, key);
    assert.equal(run.env.MONGODB_URI, undefined);
    assert.equal(run.env.ODEE_TEST_MONGODB_URI, undefined);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
      env: run.env, encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), run.env);
  }
  await fs.writeFile(path.join(runs[0].originalsDir, 'invoice.txt'), 'synthetic invoice');
  await missing(path.join(runs[1].originalsDir, 'invoice.txt'));
  const readonlyModule = path.join(runs[0].env.GOMODCACHE, 'synthetic-module');
  await fs.mkdir(readonlyModule);
  await fs.writeFile(path.join(readonlyModule, 'go.mod'), 'module synthetic.invalid/example\n', { mode: 0o444 });
  await fs.chmod(readonlyModule, 0o555);
  const protectedDirectory = path.join(f.scratch, 'outside-synthetic-scratch');
  await fs.mkdir(protectedDirectory, { mode: 0o555 });
  await fs.symlink(protectedDirectory, path.join(runs[0].scratchDir, 'foreign-directory-link'));
  for (const run of runs) {
    await run.cleanup();
    await missing(run.scratchDir);
  }
  assert.equal((await fs.stat(protectedDirectory)).mode & 0o777, 0o555);
  await fs.chmod(protectedDirectory, 0o700);
});

test('safeTestEnvironment permits only explicit synthetic settings and loopback origins', async t => {
  const f = await fixture(t);
  for (const overrides of [
    { MONGODB_URI: 'mongodb://live.invalid' }, { ODEE_TEST_MONGODB_URI: 'mongodb://live.invalid' },
    { GITHUB_TOKEN: 'secret' }, { PATH: '/malicious' }, { NODE_OPTIONS: '--require=plugin' },
    { ODEE_DEMO: 'false' }, { ODEE_DEV_MODE: 'false' }, { ODEE_AUTH_MODE: 'github' },
    { GOWORK: '/live/go.work' }, { ODEE_ADDR: '0.0.0.0:8098' },
    { ODEE_ADDR: '127.0.0.1:65536' }, { ODEE_ORIGIN: 'https://live.invalid' },
    { MONGODB_DATABASE_ODEE: 'production' }, { HOME: '../credentials' },
    { HOME: f.original }, { MONGODB_DATABASE_ODEE: `odee_test_${'x'.repeat(55)}` },
    { ODEE_COMPANY_ID: '000000000000000000000000' },
  ]) {
    assert.throws(() => safeTestEnvironment(overrides), /unsafe|must|synthetic/);
  }
  const env = safeTestEnvironment({
    ODEE_TEST_SCRATCH_DIR: path.join(f.scratch, 'safe-env'),
    ODEE_ADDR: '127.0.0.1:18432', ODEE_ORIGIN: 'http://127.0.0.1:18432', CI: 'true',
  });
  assert.equal(env.ODEE_ADDR, '127.0.0.1:18432');
  assert.equal(env.GOWORK, 'off');
  assert.equal(env.MONGODB_URI, undefined);
  assert.equal(env.ODEE_TEST_MONGODB_URI, undefined);
  assert.equal(env.ODEE_AUTH_MODE, 'token');
  assert.equal((await fs.stat(env.TMPDIR)).isDirectory(), true);
  assert.equal((await fs.stat(env.ODEE_TEST_ORIGINALS_DIR)).isDirectory(), true);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.ODEE_DEMO)'], {
    env, encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'true');
  const alias = path.join(f.scratch, 'scratch-alias');
  await fs.symlink(f.original, alias);
  assert.throws(() => safeTestEnvironment({
    ODEE_TEST_SCRATCH_DIR: path.join(alias, 'must-not-be-created'),
  }), /symlink alias/);
  await missing(path.join(f.original, 'must-not-be-created'));
  await assert.rejects(createSyntheticEnvironment({
    ticket: 'ODEE-002', scratchRoot: path.join(alias, 'also-must-not-be-created'),
  }), /symlink alias/);
  await missing(path.join(f.original, 'also-must-not-be-created'));
});

test('synthetic ownership cannot nest and be deleted by another run cleanup', async t => {
  const f = await fixture(t);
  const first = await createSyntheticEnvironment({ ticket: 'ODEE-002', scratchRoot: f.scratch });
  t.after(() => first.cleanup());
  await assert.rejects(createSyntheticEnvironment({
    ticket: 'ODEE-003', scratchRoot: first.originalsDir,
  }), /refusing nested allocation/);
  await assert.rejects(createSyntheticEnvironment({
    ticket: 'ODEE-003', scratchRoot: path.join(first.originalsDir, 'not-created'),
  }), /refusing nested allocation/);
  await missing(path.join(first.originalsDir, 'not-created'));
  assert.deepEqual(await fs.readdir(first.originalsDir), []);
  await first.cleanup();
  await missing(first.scratchDir);
});

test('CLI help, validation, explicit failures, and create/status/remove are usable', async t => {
  const f = await fixture(t);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /NOT an exclusive reservation/);
  for (const args of [[], ['bogus'], ['constructor'], ['toString'], ['valueOf'], ['__proto__'],
    ['create', '--ticket'], ['remove', '--force'], ['create', '--ticket', 'ODEE-002', '--ticket', 'ODEE-003']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /workspace:/);
  }
  const failure = run('create', '--ticket', 'ODEE-002', '--repo', f.original, '--expected-parent', f.original, '--base', 'not-here');
  assert.equal(failure.status, 1);
  const productionRootAvailable = await fs.access(WORKTREE_ROOT, fs.constants.W_OK).then(() => true, () => false);
  if (!productionRootAvailable) {
    assert.match(failure.stderr, /workspace:.*(ENOENT|EACCES)/);
    t.diagnostic('Production root unavailable: CLI refuses safely; synthetic library lifecycle remains fully tested.');
    return;
  }
  assert.match(failure.stderr, /git rev-parse failed/);
  // CLI has no root override. Test its lifecycle only with a globally unique
  // ticket and a fake parent, still under the mandated external worktree root.
  const ticket = `TEST-${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const args = ['--ticket', ticket, '--repo', f.original, '--expected-parent', f.original];
  const directory = path.join(WORKTREE_ROOT, `odee-${ticket.toLowerCase()}`);
  t.after(async () => {
    try {
      const status = await statusWorkspace({ repo: f.original, expectedParent: f.original, ticket });
      if (!status.dirty && status.merged) await removeWorkspace({ repo: f.original, expectedParent: f.original, ticket });
    } catch (error) {
      if (await fs.stat(directory).then(() => true, () => false)) t.diagnostic(`retained synthetic CLI fixture: ${error.message}`);
    }
  });
  const created = run('create', ...args);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).directory, directory);
  const status = run('status', ...args);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).merged, true);
  const removed = run('remove', ...args);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).removed, true);
  await missing(directory);
  const synthetic = run('env', ...args);
  assert.equal(synthetic.status, 0, synthetic.stderr);
  const environment = JSON.parse(synthetic.stdout);
  assert.equal(environment.env.GOWORK, 'off');
  assert.equal(environment.env.ODEE_DEMO, 'true');
  assert.equal(environment.env.MONGODB_URI, undefined);
  assert.match(environment.portState, /^released: retry/);
  assert.ok(environment.scratchDir.startsWith(`${f.original}${path.sep}`));
  assert.equal(await fs.readFile(path.join(environment.scratchDir, '.odee-synthetic-owner'), 'utf8'), environment.id);
});
