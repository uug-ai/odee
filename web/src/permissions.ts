import type { Capability, Session } from './types'

export function can(session: Session | null, ...required: Capability[]): boolean {
  return Boolean(
    session?.authenticated &&
    session.access?.member &&
    required.every((capability) => session.access?.capabilities.includes(capability)),
  )
}
