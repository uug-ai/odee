import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAPIRequest } from './api'

afterEach(() => vi.unstubAllGlobals())

function client(token = '') {
  let generation = 1
  let csrfToken = 'test-csrf'
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  const onUnauthorized = vi.fn(() => {
    generation++
    csrfToken = ''
  })
  const onUnauthorizedError = vi.fn<(message: string) => void>()
  return {
    request: createAPIRequest({
      token,
      csrfToken: () => csrfToken,
      generation: () => generation,
      onUnauthorized,
      onUnauthorizedError,
    }),
    fetcher,
    onUnauthorized,
    onUnauthorizedError,
    invalidate: () => generation++,
    setCSRF: (value: string) => {
      csrfToken = value
    },
  }
}

describe('authenticated API requests', () => {
  it('uses relative same-origin GET requests without write headers', async () => {
    const { request, fetcher } = client()
    fetcher.mockResolvedValue(Response.json({ authenticated: true }))
    await expect(request('session')).resolves.toEqual({ authenticated: true })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/session', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {},
    })
  })

  it('sends JSON and the current CSRF token for writes without overriding the browser origin', async () => {
    const { request, fetcher, setCSRF } = client()
    fetcher.mockImplementation(async () => Response.json({ version: 2 }))
    await request('contacts', { name: 'Synthetic contact' })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/contacts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'test-csrf', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Synthetic contact' }),
    })
    setCSRF('rotated-test-csrf')
    await request('contacts/example', { version: 1 }, 'PUT')
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/contacts/example', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'rotated-test-csrf', 'Content-Type': 'application/json' },
      body: '{"version":1}',
    })
  })

  it('uses only the explicitly supplied tab token and omits absent CSRF', async () => {
    const { request, fetcher, setCSRF } = client('synthetic-company-token')
    setCSRF('')
    fetcher.mockResolvedValue(Response.json({ id: 'example' }))
    await request('documents', {})
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/documents', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Authorization: 'Bearer synthetic-company-token',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  })

  it('lets the browser set the multipart boundary for bill imports', async () => {
    const { request, fetcher } = client()
    const body = new FormData()
    body.append('file', new Blob(['synthetic invoice']), 'invoice.txt')
    fetcher.mockResolvedValue(Response.json({ id: 'import' }))
    await request('imports', body)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/imports', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'test-csrf' },
      body,
    })
  })

  it('does not parse empty 204 responses', async () => {
    const { request, fetcher } = client()
    const response = new Response(null, { status: 204 })
    const json = vi.spyOn(response, 'json')
    fetcher.mockResolvedValue(response)
    await expect(request<void>('logout', {})).resolves.toBeUndefined()
    expect(json).not.toHaveBeenCalled()
  })

  it('expires the current session on 401 before parsing the error and reports its message', async () => {
    const { request, fetcher, onUnauthorized, onUnauthorizedError } = client()
    const response = Response.json({ error: 'Sign in with GitHub to continue.' }, { status: 401 })
    const json = vi.spyOn(response, 'json').mockImplementation(async () => {
      expect(onUnauthorized).toHaveBeenCalledOnce()
      return { error: 'Sign in with GitHub to continue.' }
    })
    fetcher.mockResolvedValue(response)
    await expect(request('contacts', {})).rejects.toThrow('Sign in with GitHub to continue.')
    expect(json).toHaveBeenCalledOnce()
    expect(onUnauthorizedError).toHaveBeenCalledExactlyOnceWith('Sign in with GitHub to continue.')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('does not let an old-generation 401 expire a later session', async () => {
    const { request, fetcher, invalidate, onUnauthorized, onUnauthorizedError } = client()
    let respond: (response: Response) => void = () => {}
    fetcher.mockReturnValue(
      new Promise<Response>((resolve) => {
        respond = resolve
      }),
    )
    const pending = request('state')
    invalidate()
    respond(Response.json({ error: 'Old session expired.' }, { status: 401 }))
    await expect(pending).rejects.toThrow('Old session expired.')
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(onUnauthorizedError).not.toHaveBeenCalled()
  })

  it.each([
    [403, { error: 'CSRF token is invalid.' }, 'CSRF token is invalid.'],
    [403, { error: 'Request origin is not allowed.' }, 'Request origin is not allowed.'],
    [409, { error: 'The document has changed.' }, 'The document has changed.'],
    [500, { error: 42 }, 'Request failed (500).'],
    [502, null, 'Request failed (502).'],
  ])('reports %s failures without expiry or unsafe retries', async (status, data, message) => {
    const { request, fetcher, onUnauthorized, onUnauthorizedError } = client()
    fetcher.mockResolvedValue(Response.json(data, { status }))
    await expect(request('documents/example/post', { version: 1 })).rejects.toThrow(message)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(onUnauthorizedError).not.toHaveBeenCalled()
  })

  it('still expires a 401 when its error response is not JSON', async () => {
    const { request, fetcher, onUnauthorized } = client()
    fetcher.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    await expect(request('state')).rejects.toThrow()
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('propagates network errors without retries or expiring the session', async () => {
    const { request, fetcher, onUnauthorized } = client()
    fetcher.mockRejectedValue(new Error('Network unavailable'))
    await expect(request('documents', {})).rejects.toThrow('Network unavailable')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
