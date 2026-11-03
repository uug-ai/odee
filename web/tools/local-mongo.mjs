import { MongoBinary } from 'mongodb-memory-server'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const directory = fileURLToPath(new URL('../../.local-data/mongo/', import.meta.url))
await mkdir(directory, { recursive: true, mode: 0o700 })
const binary = await MongoBinary.getPath({
  version: '8.0.16',
  ...(process.platform === 'linux' && process.arch === 'arm64'
    ? { os: { os: 'linux', dist: 'ubuntu', release: '22.04' } }
    : {}),
})
// Run a standalone daemon with a durable dbpath, not a temporary memory-server instance.
const child = spawn(
  binary,
  ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', '27028', '--quiet'],
  { stdio: 'inherit' },
)
child.on('error', (error) => {
  console.error('Could not start the dedicated local Odee MongoDB:', error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 0
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
