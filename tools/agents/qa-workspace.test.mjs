import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createWorkspace, statusWorkspace, removeWorkspace,
  createSyntheticEnvironment, reserveTestPort, createSyntheticGitFixture,
} from './workspace.mjs';

const moduleURL = new URL('./workspace.mjs', import.meta.url).href;
const cli = fileURLToPath(new URL('./workspace.mjs', import.meta.url));
const implementationTests = fileURLToPath(new URL('./workspace.test.mjs', import.meta.url));

function rootPreload(root) {
  const hook = `export async function load(url, context, next) {
    const result = await next(url, context);
    if (url === ${JSON.stringify(moduleURL)}) {
      return { ...result, source: result.source.toString().replaceAll(
        '/home/vscode/worktrees', ${JSON.stringify(root)}) };
    }
    return result;
  }`;
  const hookURL = `data:text/javascript,${encodeURIComponent(hook)}`;
  const preload = `import { register } from 'node:module'; register(${JSON.stringify(hookURL)}, import.meta.url);`;
  return `--import=data:text/javascript,${encodeURIComponent(preload)}`;
}

function git(directory, ...args) {
  const result = spawnSync('git', [
    '-c', `safe.directory=${directory}`, '-c', 'core.hooksPath=/dev/null',
    '-C', directory, ...args,
  ], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(result.status, 0, `synthetic git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trimEnd();
}

async function scratch(t, registerCleanup = true) {
  const parent = path.resolve('.local-data');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'qa-workspace-'));
  if (registerCleanup) t.after(() => fs.rm(directory, { recursive: true }));
  return directory;
}

async function fixture(t) {
  const directory = await scratch(t, false);
  const generated = await createSyntheticGitFixture({ scratchRoot: directory });
  const { repo: original, worktreeRoot } = generated.options;
  await fs.writeFile(path.join(original, 'fixture.txt'), 'synthetic baseline\n');
  await fs.writeFile(path.join(original, '.gitignore'), '.env\n.env.local\nignored.txt\n');
  git(original, 'add', '.');
  git(original, 'commit', '--quiet', '-m', 'Synthetic QA baseline');
  t.after(async () => {
    const records = git(original, 'worktree', 'list', '--porcelain', '-z').split('\0\0');
    for (const record of records) {
      const location = record.split('\0').find(line => line.startsWith('worktree '))?.slice(9);
      if (!location || location === original) continue;
      assert.equal(path.dirname(location), worktreeRoot, 'cleanup only touches this known synthetic root');
      assert.equal(git(location, 'status', '--porcelain', '--ignored'), '', 'retain dirty QA fixtures');
      const head = git(location, 'rev-parse', 'HEAD');
      assert.equal(git(original, 'merge-base', 'main', head), head, 'retain unmerged QA fixtures');
      git(original, 'worktree', 'remove', location);
    }
    await fs.rm(worktreeRoot, { recursive: true });
    await fs.rm(directory, { recursive: true });
  });
  return {
    directory, original, worktreeRoot,
    options: generated.options,
  };
}

async function absent(target) {
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
}

async function bind(port) {
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return () => new Promise(resolve => server.close(resolve));
}

test('QA: real external Git worktree, canonical parent, private manifest, and unchanged dirty original', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.original, 'fixture.txt'), 'synthetic original dirty state\n');
  await fs.writeFile(path.join(f.original, '.env.local'), 'SYNTHETIC_SECRET=do-not-copy\n');
  const before = git(f.original, 'status', '--porcelain', '--ignored');
  const options = { ...f.options, ticket: 'QA-101' };
  const workspace = await createWorkspace(options);
  const ownerFile = path.join(f.original, '.git', 'odee-workspaces', 'qa-101.json');
  const ownerBytes = await fs.readFile(ownerFile, 'utf8');
  const owner = JSON.parse(ownerBytes);
  assert.equal(path.dirname(workspace.directory), f.worktreeRoot);
  assert.ok(!workspace.directory.startsWith(`${f.original}${path.sep}`));
  assert.equal(git(workspace.directory, 'rev-parse', '--show-toplevel'), workspace.directory);
  assert.equal(git(workspace.directory, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
    path.join(f.original, '.git'));
  assert.match(await fs.readFile(path.join(workspace.directory, '.git'), 'utf8'), /^gitdir: /);
  assert.equal((await fs.stat(ownerFile)).mode & 0o777, 0o600);
  assert.equal(owner.parent, f.original);
  assert.equal(owner.baseSha, git(f.original, 'rev-parse', 'main'));
  assert.equal(owner.directory, workspace.directory);
  assert.match(owner.id, /^[a-f0-9-]{36}$/);
  await absent(path.join(workspace.directory, '.env.local'));
  assert.equal(await fs.readFile(path.join(workspace.directory, 'fixture.txt'), 'utf8'), 'synthetic baseline\n');
  for (const mutation of [
    { parent: f.directory }, { directory: f.original }, { branch: 'another-owner' },
    { kind: 'foreign' }, { version: 2 }, { id: null }, { state: 'creating' },
  ]) {
    await fs.writeFile(ownerFile, JSON.stringify({ ...owner, ...mutation }));
    await assert.rejects(statusWorkspace(options), /foreign|invalid|different branch|manual triage/);
    await assert.rejects(removeWorkspace(options), /foreign|invalid|different branch|manual triage/);
    assert.equal(git(workspace.directory, 'branch', '--show-current'), workspace.branch);
  }
  await fs.writeFile(ownerFile, ownerBytes);
  const movedRecord = `${ownerFile}.qa-backup`;
  await fs.rename(ownerFile, movedRecord);
  await fs.symlink(movedRecord, ownerFile);
  await assert.rejects(removeWorkspace(options), /foreign worktree/);
  await fs.unlink(ownerFile);
  await fs.rename(movedRecord, ownerFile);
  const alias = path.join(f.directory, 'parent-alias');
  await fs.symlink(f.original, alias);
  await assert.rejects(statusWorkspace({ ...options, expectedParent: alias }), /symlink alias/);
  await removeWorkspace(options);
  assert.equal(git(f.original, 'status', '--porcelain', '--ignored'), before);
  assert.equal(await fs.readFile(path.join(f.original, 'fixture.txt'), 'utf8'), 'synthetic original dirty state\n');
  assert.equal(await fs.readFile(path.join(f.original, '.env.local'), 'utf8'), 'SYNTHETIC_SECRET=do-not-copy\n');
});

test('QA: foreign, ignored/dirty, locked, and unmerged worktrees are retained without forcing', async t => {
  const f = await fixture(t);
  const options = { ...f.options, ticket: 'QA-102' };
  const workspace = await createWorkspace(options);
  for (const file of ['fixture.txt', 'untracked.txt', 'ignored.txt']) {
    const target = path.join(workspace.directory, file);
    await fs.writeFile(target, 'synthetic worker work\n');
    await assert.rejects(removeWorkspace(options), /dirty worktree/);
    assert.equal(await fs.readFile(target, 'utf8'), 'synthetic worker work\n');
    if (file === 'fixture.txt') git(workspace.directory, 'restore', file);
    else await fs.unlink(target);
  }
  await fs.writeFile(path.join(workspace.directory, 'fixture.txt'), 'synthetic unmerged commit\n');
  git(workspace.directory, 'add', 'fixture.txt');
  git(workspace.directory, 'commit', '--quiet', '-m', 'Synthetic unmerged QA work');
  assert.equal((await statusWorkspace(options)).merged, false);
  await assert.rejects(removeWorkspace({ ...options, repo: workspace.directory }), /unmerged work/);
  assert.equal(await fs.readFile(path.join(workspace.directory, 'fixture.txt'), 'utf8'), 'synthetic unmerged commit\n');
  git(f.original, 'merge', '--quiet', '--ff-only', workspace.branch);
  git(f.original, 'worktree', 'lock', workspace.directory);
  try {
    await assert.rejects(removeWorkspace(options), /locked/);
  } finally {
    git(f.original, 'worktree', 'unlock', workspace.directory);
  }
  await removeWorkspace(options);
  assert.equal(git(f.original, 'rev-parse', workspace.branch), git(f.original, 'rev-parse', 'main'));
  const foreign = path.join(f.worktreeRoot, 'odee-qa-103');
  git(f.original, 'worktree', 'add', '--quiet', '-b', 'synthetic-foreign', foreign, 'main');
  await assert.rejects(removeWorkspace({ ...f.options, ticket: 'QA-103' }), /foreign worktree/);
  await assert.rejects(createWorkspace({ ...f.options, ticket: 'QA-103' }), /already exists/);
  assert.equal(git(foreign, 'branch', '--show-current'), 'synthetic-foreign');
});

test('QA: unsafe refs and failed subprocesses never report an active workspace', async t => {
  const f = await fixture(t);
  for (const [field, values] of Object.entries({
    ticket: ['../QA-104', 'QA-104/../../source', '--force'],
    branch: ['--force', 'main^{}', 'agents/../bad', 'bad.lock'],
    base: ['--help', 'main:fixture.txt', 'main~0', '../main'],
  })) {
    for (const value of values) {
      await assert.rejects(createWorkspace({ ...f.options, ticket: 'QA-104', [field]: value }), /invalid|ticket/);
    }
  }
  await assert.rejects(createWorkspace({
    ...f.options, ticket: 'QA-104', base: 'synthetic-missing-base',
  }), /git rev-parse failed \(128\)/);
  await absent(path.join(f.worktreeRoot, 'odee-qa-104'));
  git(f.original, 'branch', 'agents');
  await assert.rejects(createWorkspace({ ...f.options, ticket: 'QA-104' }),
    /git worktree failed[\s\S]*retained for triage/);
  const record = JSON.parse(await fs.readFile(
    path.join(f.original, '.git', 'odee-workspaces', 'qa-104.json'), 'utf8'));
  assert.equal(record.state, 'creating');
  await assert.rejects(statusWorkspace({ ...f.options, ticket: 'QA-104' }), /manual triage/);
});

test('QA: held library ports and released CLI ports are honest, with no caller secrets', async t => {
  const f = await fixture(t);
  const reservation = await reserveTestPort();
  try {
    await assert.rejects(bind(reservation.port), { code: 'EADDRINUSE' });
  } finally {
    await reservation.release();
  }
  const close = await bind(reservation.port);
  await close();
  const poisoned = {
    MONGODB_URI: 'mongodb://synthetic.invalid/never-connect',
    ODEE_TEST_MONGODB_URI: 'mongodb://synthetic.invalid/never-connect',
    ODEE_API_TOKEN: 'synthetic-do-not-forward', GITHUB_TOKEN: 'synthetic-do-not-forward',
    SESSION_SECRET: 'synthetic-do-not-forward', AWS_SECRET_ACCESS_KEY: 'synthetic-do-not-forward',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'alias.status', GIT_CONFIG_VALUE_0: '!exit 17',
  };
  const result = spawnSync(process.execPath, [
    cli, 'env', '--ticket', 'QA-105', '--repo', f.original, '--expected-parent', f.original,
  ], {
    encoding: 'utf8',
    env: { ...process.env, ...poisoned, NODE_OPTIONS: rootPreload(f.worktreeRoot) },
  });
  assert.equal(result.status, 0, result.stderr);
  const environment = JSON.parse(result.stdout);
  assert.match(environment.portState, /^released: retry/);
  assert.equal(await fs.readFile(path.join(environment.scratchDir, '.odee-synthetic-owner'), 'utf8'), environment.id);
  for (const key of Object.keys(poisoned)) assert.equal(environment.env[key], undefined, key);
  for (const key of ['HOME', 'TMPDIR', 'GOPATH', 'GOCACHE', 'GOMODCACHE', 'NPM_CONFIG_CACHE',
    'ODEE_TEST_ORIGINALS_DIR']) {
    assert.ok(environment.env[key].startsWith(`${environment.scratchDir}${path.sep}`), key);
  }
  const port = Number(environment.env.ODEE_ADDR.split(':').at(-1));
  const closeCLI = await bind(port);
  await closeCLI();
  const child = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.env))'], {
    encoding: 'utf8', env: environment.env,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), environment.env);
});

test('QA regression: cleanup cannot delete another worker nested inside its scratch', async t => {
  const directory = await scratch(t);
  const outer = await createSyntheticEnvironment({ ticket: 'QA-106', scratchRoot: directory });
  let inner;
  try {
    try {
      inner = await createSyntheticEnvironment({ ticket: 'QA-107', scratchRoot: outer.originalsDir });
    } catch (error) {
      assert.match(error.message, /owned|nested|synthetic|scratch/);
      return;
    }
    await assert.rejects(outer.cleanup(), /owned|nested|foreign|synthetic|scratch/,
      'either reject nested allocation or refuse cleanup while another owned worker exists');
    assert.equal(await fs.readFile(path.join(inner.scratchDir, '.odee-synthetic-owner'), 'utf8'), inner.id);
  } finally {
    await inner?.cleanup();
    await outer.cleanup();
  }
});

test('QA regression: unknown inherited Object command names must fail explicitly', () => {
  for (const command of ['constructor', 'toString', 'valueOf']) {
    const result = spawnSync(process.execPath, [cli, command], { encoding: 'utf8' });
    assert.equal(result.status, 1, `${command}: must reject an unknown command; stdout=${result.stdout}`);
    assert.match(result.stderr, /unknown command/);
  }
});

test('QA regression: Ubuntu CI provisions the writable controlled root before Node tests', async () => {
  const workflow = await fs.readFile(new URL('../../.github/workflows/agents.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^\s+runs-on: ubuntu-24\.04$/m);
  const steps = workflow.split(/^      - /m).slice(1);
  const testCommand = /^\s+run: node --test tools\/agents\/\*\.test\.mjs(?:[ \t]+[^\r\n]+)?$/m;
  assert.match('        run: node --test tools/agents/*.test.mjs', testCommand);
  assert.match('        run: node --test tools/agents/*.test.mjs web/tests/test-environment.test.mjs', testCommand);
  assert.doesNotMatch('        run: node --test web/tests/test-environment.test.mjs', testCommand);
  const tests = steps.findIndex(step => testCommand.test(step));
  const prepare = steps.findIndex(step =>
    /^\s+run: sudo install -d -o "\$\(id -u\)" -g "\$\(id -g\)" \/home\/vscode\/worktrees$/m.test(step));
  assert.ok(tests >= 0, 'expected the agent Node test step');
  assert.ok(prepare >= 0 && prepare < tests,
    'provision the required root with runner ownership before invoking the Node suite');
  assert.doesNotMatch(steps[prepare], /^\s+(?:if|continue-on-error):/m,
    'required fixture-root setup must be unconditional and fail closed');
});

test('QA regression: implementation fixtures handle an absent production root safely', async t => {
  const directory = await scratch(t);
  const absentRoot = path.join(directory, 'runner', 'home', 'vscode', 'worktrees');
  await absent(absentRoot);
  // Only virtualize the fixed root in the module loader: never rename, remove,
  // or monkey-patch the actual shared /home/vscode/worktrees directory.
  const result = spawnSync(process.execPath, ['--test', implementationTests], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      NODE_OPTIONS: rootPreload(absentRoot),
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0,
    `fixtures must remain safe without privileged global-root setup:\n${result.stdout.slice(0, 4500)}${result.stderr}`);
});
