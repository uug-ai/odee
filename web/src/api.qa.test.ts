import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAPIRequest } from './api'

afterEach(() => vi.unstubAllGlobals())

function setup(token = '') {
  let generation = 7
  let csrf = 'synthetic-csrf-before'
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  const onUnauthorized = vi.fn(() => {
    generation++
    csrf = ''
  })
  const onUnauthorizedError = vi.fn<(message: string) => void>()
  return {
    request: createAPIRequest({
      token,
      csrfToken: () => csrf,
      generation: () => generation,
      onUnauthorized,
      onUnauthorizedError,
    }),
    fetcher,
    onUnauthorized,
    onUnauthorizedError,
    changeSession: () => {
      generation++
      csrf = 'synthetic-csrf-after'
    },
  }
}

describe('ODEE-004 rev1 independent API compatibility', () => {
  it.each([null, false, 0, '', [], {}])(
    'treats a defined falsy/empty payload %j as a write, not a GET',
    async (body) => {
      const { request, fetcher } = setup()
      fetcher.mockImplementation(async () => new Response(null, { status: 204 }))

      await request('documents/synthetic', body, 'PATCH')

      expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/documents/synthetic', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'X-CSRF-Token': 'synthetic-csrf-before',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    },
  )

  it('keeps the legacy undefined-body GET rule even with an explicit method', async () => {
    const { request, fetcher } = setup()
    fetcher.mockResolvedValue(Response.json({ company: 'Synthetic' }))

    await request('state', undefined, 'DELETE')

    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/state', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {},
    })
  })

  it('never obtains credentials from browser storage or carries one client token into another', async () => {
    const readStorage = vi.fn(() => {
      throw new Error('API extraction must not read browser storage')
    })
    vi.stubGlobal('localStorage', { getItem: readStorage })
    vi.stubGlobal('sessionStorage', { getItem: readStorage })
    const first = setup('synthetic-tab-token')
    first.fetcher.mockImplementation(async () => Response.json({}))
    await first.request('state')
    const firstHeaders = new Headers(first.fetcher.mock.calls[0][1]?.headers)
    expect(firstHeaders.get('Authorization')).toBe(['Bearer', 'synthetic-tab-token'].join(' '))
    expect(firstHeaders.has('X-CSRF-Token')).toBe(false)
    expect(firstHeaders.has('Content-Type')).toBe(false)

    const second = setup()
    second.fetcher.mockImplementation(async () => Response.json({}))
    await second.request('state')
    expect(new Headers(second.fetcher.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
    expect(readStorage).not.toHaveBeenCalled()
    expect(first.fetcher.mock.calls[0][1]?.credentials).toBe('same-origin')
    expect(second.fetcher.mock.calls[0][1]?.credentials).toBe('same-origin')
  })

  it('samples current CSRF per dispatch, including multipart uploads, without forging origin headers', async () => {
    const { request, fetcher, changeSession } = setup('synthetic-token')
    fetcher.mockImplementation(async () => new Response(null, { status: 204 }))
    const upload = new FormData()
    upload.append('file', new Blob(['synthetic bill']), 'bill.txt')

    await request('imports', upload)
    changeSession()
    await request('documents/synthetic/post', { version: 3 })

    const first = fetcher.mock.calls[0][1]!
    const second = fetcher.mock.calls[1][1]!
    expect(first.body).toBe(upload)
    expect(new Headers(first.headers).get('X-CSRF-Token')).toBe('synthetic-csrf-before')
    expect(new Headers(first.headers).has('Content-Type')).toBe(false)
    expect(new Headers(second.headers).get('X-CSRF-Token')).toBe('synthetic-csrf-after')
    expect(new Headers(second.headers).get('Content-Type')).toBe('application/json')
    for (const options of [first, second]) {
      const headers = new Headers(options.headers)
      expect(options.credentials).toBe('same-origin')
      expect(headers.get('Authorization')).toBe(['Bearer', 'synthetic-token'].join(' '))
      for (const name of ['Origin', 'Referer', 'Cookie']) expect(headers.has(name)).toBe(false)
    }
  })

  it('expires only once when two same-generation writes receive concurrent 401 responses', async () => {
    const { request, fetcher, onUnauthorized, onUnauthorizedError } = setup()
    let respond!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      respond = resolve
    })
    fetcher.mockImplementation(() => response.then((value) => value.clone()))
    const first = request('documents/synthetic-a/post', { version: 1 })
    const second = request('documents/synthetic-b/post', { version: 1 })
    const results = Promise.allSettled([first, second])

    respond(Response.json({ error: 'Synthetic session expired.' }, { status: 401 }))

    expect(await results).toEqual([
      { status: 'rejected', reason: new Error('Synthetic session expired.') },
      { status: 'rejected', reason: new Error('Synthetic session expired.') },
    ])
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(onUnauthorizedError).toHaveBeenCalledExactlyOnceWith('Synthetic session expired.')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects a stale 401 without clearing or reporting an error into the newer session', async () => {
    const { request, fetcher, changeSession, onUnauthorized, onUnauthorizedError } = setup()
    let respond!: (response: Response) => void
    fetcher.mockReturnValue(
      new Promise<Response>((resolve) => {
        respond = resolve
      }),
    )
    const pending = request('state')
    const rejected = expect(pending).rejects.toThrow('Old session')
    changeSession()
    respond(Response.json({ error: 'Old session' }, { status: 401 }))

    await rejected
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(onUnauthorizedError).not.toHaveBeenCalled()
    fetcher.mockResolvedValue(Response.json({ saved: true }))
    await request('contacts', { name: 'Synthetic' })
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('X-CSRF-Token')).toBe(
      'synthetic-csrf-after',
    )
  })

  it('clears CSRF before decoding a current 401 and never repeats the failed write', async () => {
    const { request, fetcher, onUnauthorized, onUnauthorizedError } = setup()
    const response = Response.json({ error: 'Sign in again.' }, { status: 401 })
    vi.spyOn(response, 'json').mockImplementation(async () => {
      expect(onUnauthorized).toHaveBeenCalledOnce()
      expect(onUnauthorizedError).not.toHaveBeenCalled()
      return { error: 'Sign in again.' }
    })
    fetcher.mockResolvedValueOnce(response)

    await expect(request('documents/synthetic/post', { version: 1 })).rejects.toThrow(
      'Sign in again.',
    )

    expect(fetcher).toHaveBeenCalledOnce()
    expect(onUnauthorizedError).toHaveBeenCalledExactlyOnceWith('Sign in again.')
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await request('logout', {})
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).has('X-CSRF-Token')).toBe(false)
  })

  it.each([null, false, 17, 'synthetic', ['a'], { saved: true }])(
    'returns successful JSON %j without changing its shape',
    async (payload) => {
      const { request, fetcher, onUnauthorized } = setup()
      fetcher.mockResolvedValue(Response.json(payload))
      await expect(request('state')).resolves.toEqual(payload)
      expect(onUnauthorized).not.toHaveBeenCalled()
    },
  )

  it('does not decode any body for 204', async () => {
    const { request, fetcher } = setup()
    const response = new Response(null, { status: 204 })
    const parse = vi.spyOn(response, 'json').mockRejectedValue(new Error('must not parse'))
    fetcher.mockResolvedValue(response)
    await expect(request<void>('logout', {})).resolves.toBeUndefined()
    expect(parse).not.toHaveBeenCalled()
  })

  it.each([
    [403, { error: 'CSRF token is invalid.' }, 'CSRF token is invalid.'],
    [403, { error: 'Request origin is not allowed.' }, 'Request origin is not allowed.'],
    [409, { error: 'Version conflict.' }, 'Version conflict.'],
    [422, { error: '' }, ''],
    [500, { error: null }, 'Request failed (500).'],
    [502, ['error'], 'Request failed (502).'],
    [503, 'unavailable', 'Request failed (503).'],
    [400, null, 'Request failed (400).'],
  ])('preserves %s error semantics without retry or expiry', async (status, data, message) => {
    const { request, fetcher, onUnauthorized, onUnauthorizedError } = setup()
    fetcher.mockResolvedValue(Response.json(data, { status }))
    await expect(request('documents', {})).rejects.toEqual(new Error(message))
    expect(fetcher).toHaveBeenCalledOnce()
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(onUnauthorizedError).not.toHaveBeenCalled()
  })

  it.each([200, 401, 403, 502])(
    'preserves baseline non-JSON %s parsing failures; only 401 expires the session',
    async (status) => {
      const { request, fetcher, onUnauthorized, onUnauthorizedError } = setup()
      fetcher.mockResolvedValue(new Response('not JSON', { status }))
      await expect(request('documents', {})).rejects.toBeInstanceOf(SyntaxError)
      expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
      expect(onUnauthorizedError).not.toHaveBeenCalled()
      expect(fetcher).toHaveBeenCalledOnce()
    },
  )

  it('propagates the exact network rejection without unsafe retry', async () => {
    const { request, fetcher, onUnauthorized } = setup()
    const failure = new DOMException('Synthetic request aborted', 'AbortError')
    fetcher.mockRejectedValue(failure)
    await expect(request('documents/synthetic/post', {})).rejects.toBe(failure)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
