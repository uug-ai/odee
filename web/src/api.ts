import type { APIRequest } from './types'

interface Authentication {
  token: string
  csrfToken: () => string
  generation: () => number
  onUnauthorized: () => void
  onUnauthorizedError: (message: string) => void
}

export function createAPIRequest(auth: Authentication): APIRequest {
  return async <T>(path: string, body?: unknown, method = 'POST'): Promise<T> => {
    const requestGeneration = auth.generation()
    const csrf = auth.csrfToken()
    const response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...(body === undefined || body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    })
    // Stale errors must not expire a newer session; state loaders also guard successful responses.
    const unauthorized = response.status === 401 && requestGeneration === auth.generation()
    if (unauthorized) auth.onUnauthorized()
    if (!response.ok) {
      const data: unknown = await response.json()
      const message =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof data.error === 'string'
          ? data.error
          : `Request failed (${response.status}).`
      if (unauthorized) auth.onUnauthorizedError(message)
      throw new Error(message)
    }
    return response.status === 204 ? (undefined as T) : response.json()
  }
}
