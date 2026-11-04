import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function header(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
  assert.ok(match, 'Expected YAML frontmatter')
  return match[1]
}

function tools(source) {
  const match = /^tools: \[([^\n]*)\]$/m.exec(header(source))
  assert.ok(match, 'Expected an explicit inline tool allowlist')
  return match[1].split(',').map((tool) => tool.trim().replace(/^(['"])(.*)\1$/, '$2'))
}

test('slash controls preserve coordinator model and tool preferences', async () => {
  const directory = resolve(root, '.github/prompts')
  const files = (await readdir(directory)).filter((file) => file.startsWith('odee-'))
  assert.equal(files.length, 5)
  for (const file of files) {
    const frontmatter = header(await readFile(resolve(directory, file), 'utf8'))
    assert.match(frontmatter, /^agent: odee-coordinator$/m, file)
    assert.doesNotMatch(frontmatter, /^(?:tools|model|model-policy|reasoning-effort):/m,
      `${file} must inherit the coordinator's selected tools/model/effort`)
  }
})

test('browser QA can read an existing shared reference page with host browser tools', async () => {
  const source = await readFile(resolve(root, '.github/agents/odee-qa-browser.agent.md'), 'utf8')
  const allowed = tools(source)
  assert.ok(allowed.includes('browser/readPage') || allowed.includes('browser/*'),
    'Shared Odoo/ODEE browser comparison needs browser/readPage (or browser/*); ' +
    'read/search/execute/edit do not expose integrated-browser page snapshots. ' +
    'Playwright on an isolated server does not inspect an already-shared host page.')
})
