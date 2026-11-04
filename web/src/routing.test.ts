import { describe, expect, it } from 'vitest'
import { navigation, pathForView, viewForPath } from './modules'
import { githubSignInPath } from './routing'
import { routeMessages } from './RouteNotFound'

describe('registered workspace paths', () => {
  it('pins existing views to their public paths with no duplicate destinations', () => {
    expect(navigation.map((item) => [item.view, pathForView(item.view)])).toEqual([
      ['dashboard', '/accounting'],
      ['invoices', '/accounting/invoices'],
      ['bills', '/accounting/bills'],
      ['journal', '/accounting/journal'],
      ['accounts', '/accounting/accounts'],
      ['reports', '/accounting/reports'],
      ['contacts', '/contacts'],
    ])
    expect(pathForView('apps')).toBe('/')
    expect(viewForPath('/')).toBe('apps')
    for (const { view } of navigation) expect(viewForPath(pathForView(view))).toBe(view)
    expect(new Set(navigation.map((item) => pathForView(item.view))).size).toBe(navigation.length)
  })

  it.each([
    '/sales',
    '/projects',
    '/inventory',
    '/missing',
    '/accounting/unknown',
    '/contacts/child',
    '/contacts/',
    '/%63ontacts',
    '/api/state',
    '/auth/github',
    '/assets/app.js',
    '/healthz',
    '//evil.example/contacts',
    'https://evil.example/contacts',
  ])('does not activate unknown, planned or reserved path %s', (path) => {
    expect(viewForPath(path)).toBeNull()
  })

  it('builds sign-in return targets only from canonical registered views', () => {
    expect(githubSignInPath('apps')).toBe('/auth/github')
    for (const { view } of navigation) {
      const link = new URL(githubSignInPath(view), 'https://odee.example')
      expect(link.origin).toBe('https://odee.example')
      expect(link.pathname).toBe('/auth/github')
      expect(link.searchParams.get('returnTo')).toBe(pathForView(view))
    }
  })

  it('provides English and Dutch strings for the new not-found screen only', () => {
    expect(routeMessages('en-GB')).toEqual({
      language: 'en',
      title: 'Page not found',
      description: 'This page does not exist or the app is not available yet.',
      launcher: 'Back to workspace',
    })
    expect(routeMessages('nl-BE')).toEqual({
      language: 'nl',
      title: 'Pagina niet gevonden',
      description: 'Deze pagina bestaat niet of de app is nog niet beschikbaar.',
      launcher: 'Terug naar de werkruimte',
    })
    expect(routeMessages('fr')).toEqual(routeMessages('en'))
  })
})
