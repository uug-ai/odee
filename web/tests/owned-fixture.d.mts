import type { ChildProcess } from 'node:child_process'

export interface OwnedProcess {
  child: ChildProcess
  done: Promise<number | null>
  log(): string
  stop(): Promise<void>
}

export function installFixtureSignals(): void
export function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T>
export function run(program: string, args: string[], env: NodeJS.ProcessEnv): OwnedProcess
export function command(
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  file?: string,
  timeout?: number,
): Promise<string>
export function stopFixtureChildren(): Promise<void>
export function provisionMongoBinary(scratch: string): Promise<string>
export function cleanFixtureData(scratch: string): Promise<void>
