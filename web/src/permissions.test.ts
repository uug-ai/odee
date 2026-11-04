import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAPIRequest, responseStatus } from './api'
import { can } from './permissions'
import type { Capability, Session } from './types'

afterEach(() => vi.unstubAllGlobals())

describe('capabilities have no hierarchy or unsafe default', () => {
  for (let mask = 0; mask < 16; mask++) {
    it(`mirrors exact backend capability set ${mask}`, () => {
      const all: Capability[] = ['read', 'write', 'post', 'admin']
      const capabilities = all.filter((_, bit) => mask & (1 << bit))
      const session: Session = {
        authMode: 'token',
        authenticated: true,
        access: {
          principal: 'token:company',
          authorizationMode: 'enforced',
          companyId: 'synthetic',
          member: true,
          capabilities,
        },
      }
      expect(can(session, 'read')).toBe(Boolean(mask & 1))
      expect(can(session, 'read', 'write')).toBe((mask & 3) === 3)
      expect(can(session, 'read', 'post')).toBe((mask & 5) === 5)
      expect(can(session, 'read', 'admin')).toBe((mask & 9) === 9)
      expect(can({ ...session, authenticated: false }, 'read')).toBe(false)
      expect(can({ ...session, access: { ...session.access!, member: false } }, 'read')).toBe(false)
    })
  }
  it('does not infer access from authentication, login or an absent discovery response', () => {
    expect(can(null, 'write')).toBe(false)
    expect(
      can(
        {
          authMode: 'github',
          authenticated: true,
          user: { id: 42, login: 'admin', name: 'Admin' },
        },
        'read',
      ),
    ).toBe(false)
  })
})

describe('HTTP failures preserve authentication semantics', () => {
  it.each([403, 503])('does not log out or retry an unsafe %d response', async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: 'Ask your administrator or reconcile before retrying.' },
          { status },
        ),
      )
    vi.stubGlobal('fetch', fetcher)
    const logout = vi.fn()
    const request = createAPIRequest({
      token: '',
      csrfToken: () => 'synthetic',
      generation: () => 1,
      onUnauthorized: logout,
      onUnauthorizedError: vi.fn(),
    })
    const error = await request('documents/synthetic/post', { version: 1 }).catch(
      (error: unknown) => error,
    )
    expect(error).toEqual(new Error('Ask your administrator or reconcile before retrying.'))
    expect(responseStatus(error)).toBe(status)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(logout).not.toHaveBeenCalled()
  })
})
