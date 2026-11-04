import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const agentDirectory = resolve(root, '.github/agents')
const promptDirectory = resolve(root, '.github/prompts')

function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
  assert.ok(match, 'Expected YAML frontmatter')
  const fields = {}
  for (const line of match[1].split('\n')) {
    const field = /^([a-z-]+): (.+)$/.exec(line)
    assert.ok(field, `Unsupported frontmatter syntax: ${line}`)
    const [, key, value] = field
    assert.ok(!Object.hasOwn(fields, key), `Duplicate field: ${key}`)
    if (value.startsWith('"')) {
      fields[key] = JSON.parse(value)
    } else if (value === 'true' || value === 'false') {
      fields[key] = value === 'true'
    } else if (/^\[[a-zA-Z/, -]*\]$/.test(value)) {
      fields[key] = value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)
    } else {
      assert.match(value, /^[a-z][a-z0-9-]*$/, `Unsupported scalar: ${value}`)
      fields[key] = value
    }
  }
  return fields
}

async function definitions(directory, suffix) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(suffix))
  return Promise.all(files.map(async (file) => {
    const path = resolve(directory, file)
    const source = await readFile(path, 'utf8')
    return { file, path, source, fields: frontmatter(source) }
  }))
}

test('ODEE roles have discoverable descriptions and narrowly declared tools', async () => {
  const agents = await definitions(agentDirectory, '.agent.md')
  const names = new Set(agents.map(({ fields }) => fields.name))
  assert.equal(names.size, agents.length)
  assert.equal(agents.length, 24)
  const allowedTools = new Set(['read', 'search', 'edit', 'execute', 'agent', 'todo', 'web',
    'browser/readPage', 'browser/screenshotPage'])
  for (const { file, fields } of agents) {
    assert.equal(file, `${fields.name}.agent.md`)
    assert.match(fields.description, /^Use when /)
    assert.ok(Array.isArray(fields.tools) && fields.tools.length > 0)
    for (const tool of fields.tools) assert.ok(allowedTools.has(tool), `Unknown tool: ${tool}`)
    assert.equal(typeof fields['user-invocable'], 'boolean')
    assert.equal(fields.model, undefined, 'Use the host model preferences')
    assert.equal(fields['reasoning-effort'], undefined, 'Use the host effort preferences')
    assert.equal(fields.tools.includes('agent'), fields.name === 'odee-coordinator')
  }
  const pm = agents.find(({ fields }) => fields.name === 'odee-project-manager')
  assert.ok(pm.fields.tools.includes('web'))
  assert.ok(!pm.fields.tools.includes('execute'), 'PM must not execute merges or alter scheduler state')
  for (const role of ['ledger', 'belgian-peppol', 'api-data', 'browser', 'localization',
    'supply', 'services-people', 'security', 'resilience', 'integration']) {
    assert.ok(names.has(`odee-qa-${role}`), `Missing independent tester: ${role}`)
  }
})

test('start/resume/status/pause/stop prompts select the coordinator', async () => {
  const prompts = await definitions(promptDirectory, '.prompt.md')
  assert.deepEqual(prompts.map(({ fields }) => fields.name).sort(),
    ['pause', 'resume', 'start', 'status', 'stop'].map((command) => `odee-${command}`))
  for (const { fields } of prompts) {
    assert.equal(fields.agent, 'odee-coordinator')
    assert.ok(fields.description.length > 20)
  }
})

test('agent, prompt and guide links resolve inside the ODEE repository', async () => {
  const documents = [
    ...await definitions(agentDirectory, '.agent.md'),
    ...await definitions(promptDirectory, '.prompt.md'),
    ...await Promise.all(['AGENTS.md', 'docs/agents.md'].map(async (file) => {
      const path = resolve(root, file)
      return { path, source: await readFile(path, 'utf8') }
    })),
  ]
  for (const { path, source } of documents) {
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(match[1])) continue
      const target = resolve(dirname(path), match[1].split('#')[0])
      assert.ok(target.startsWith(`${root}/`), `Link escapes repository: ${target}`)
      assert.ok((await stat(target)).isFile(), `Missing linked file: ${target}`)
    }
  }
})

test('dedicated workspace exposes ODEE as its customization root', async () => {
  const workspace = JSON.parse(await readFile(resolve(root, 'odee.code-workspace'), 'utf8'))
  assert.deepEqual(workspace.folders, [{ path: '.' }])
})

test('live coordinator state is ignored and not confused with agent execution', async () => {
  const ignore = await readFile(resolve(root, '.gitignore'), 'utf8')
  assert.ok(ignore.split('\n').includes('.odee/'))
  const guide = await readFile(resolve(root, 'docs/agents.md'), 'utf8')
  assert.match(guide, /not an autonomous agent runtime/)
  assert.match(guide, /shared.*control root/)
  assert.match(guide, /three unsuccessful repair rounds/)
  assert.match(guide, /Human release review/)
})

test('CI covers operating contracts and the real persistent browser rehearsal', async () => {
  const agents = await readFile(resolve(root, '.github/workflows/agents.yml'), 'utf8')
  assert.match(agents, /contents: read/)
  assert.match(agents, /node --test tools\/agents\/\*\.test\.mjs/)
  const application = await readFile(resolve(root, '.github/workflows/check.yml'), 'utf8')
  assert.match(application, /npm run test:e2e/)
  assert.match(application, /node tests\/persistence\.mjs/)
})
