import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { repositoryRoot } from './test-environment.mjs'

const children = new Set()
let interrupted = false

export function installFixtureSignals() {
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      interrupted = true
      for (const owner of children) owner.child.kill('SIGTERM')
    })
}

export async function bounded(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function run(program, args, env) {
  if (interrupted) throw new Error('Owned fixture interrupted')
  const child = spawn(program, args, {
    cwd: repositoryRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      log += data
    })
  child.once('error', (error) => {
    log += `\n${error.stack}`
  })
  let stopping
  const owner = {
    child,
    log: () => log,
    done: new Promise((resolve) => {
      child.once('close', (code) => {
        children.delete(owner)
        resolve(code)
      })
    }),
    stop() {
      stopping ??= (async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        try {
          await bounded(owner.done, 12000, 'Owned child shutdown')
        } catch {
          console.error(`Escalating owned child ${child.pid} shutdown to SIGKILL`)
          child.kill('SIGKILL')
          await bounded(owner.done, 3000, 'Owned child forced shutdown')
        }
      })()
      return stopping
    },
  }
  children.add(owner)
  return owner
}

export async function command(program, args, env, file, timeout = 240000) {
  const owner = run(program, args, env)
  try {
    const code = await bounded(owner.done, timeout, `${program} ${args.join(' ')}`)
    if (code !== 0 || interrupted)
      throw new Error(
        `${program} ${args.join(' ')} (${code})\n${file ? `Full output: ${file}\n${owner.log().slice(-3500)}` : owner.log()}`,
      )
    if (!file) console.log(owner.log())
    return owner.log()
  } finally {
    try {
      await owner.stop()
    } finally {
      if (file) await writeFile(file, owner.log())
    }
  }
}

export async function stopFixtureChildren() {
  await Promise.all([...children].map((owner) => owner.stop()))
}

export async function provisionMongoBinary(scratch) {
  const cache = join(scratch, 'mongodb-binaries')
  await mkdir(cache)
  const source = process.env.MONGOMS_DOWNLOAD_DIR || join(homedir(), '.cache', 'mongodb-binaries')
  for (const name of await readdir(source).catch(() => []))
    if (new RegExp(`^mongod-${process.arch}-[a-zA-Z0-9._-]+-8\\.0\\.16$`).test(name))
      await copyFile(join(source, name), join(cache, name))
  return cache
}

export async function cleanFixtureData(scratch) {
  await stopFixtureChildren()
  for (const name of [
    'mongo',
    'mongodb-binaries',
    'go',
    'go-cache',
    'npm-cache',
    'home',
    'scratch',
    'originals',
    'odee',
  ]) {
    const target = join(scratch, name)
    if (name === 'go') {
      const directories = [target]
      while (directories.length) {
        const directory = directories.pop()
        await chmod(directory, 0o700)
        for (const entry of await readdir(directory, { withFileTypes: true }))
          if (entry.isDirectory()) directories.push(join(directory, entry.name))
      }
    }
    await rm(target, { recursive: true, force: true, maxRetries: 3 })
  }
}
