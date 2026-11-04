export const repositoryRoot: string
export function safeTestEnvironment(
  overrides?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>>
export function testPort(value?: string): number
export function browserEnvironment(
  port: number,
  scratchDir?: string,
): Readonly<Record<string, string>>
export function isolatedCommand(
  environment: Readonly<Record<string, string>>,
  args: readonly string[],
): string
