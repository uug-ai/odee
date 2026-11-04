import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppLauncher } from './AppLauncher'
import { Contacts } from './Contacts'
import { activeModules, defaultView, moduleForView, modules, navigation, views } from './modules'
import type { APIRequest, State } from './types'

describe('workspace registration', () => {
  it('keeps only Accounting and Contacts active in the existing order', () => {
    expect(activeModules.map((module) => [module.id, module.entryView])).toEqual([
      ['accounting', 'dashboard'],
      ['contacts', 'contacts'],
    ])
    expect(defaultView).toBe('dashboard')
    expect(modules.map((module) => module.name)).toEqual([
      'Accounting',
      'Contacts',
      'Sales',
      'Projects',
      'Inventory',
    ])
  })

  it('registers every current view once with its existing title and navigation group', () => {
    expect(navigation.map(({ view, label, group }) => [view, label, group])).toEqual([
      ['dashboard', 'Overview', undefined],
      ['invoices', 'Invoices', 'CUSTOMERS'],
      ['bills', 'Bills', 'VENDORS'],
      ['journal', 'Journal entries', 'ACCOUNTING'],
      ['accounts', 'Chart of accounts', undefined],
      ['reports', 'Trial balance', 'REPORTING'],
      ['contacts', 'Contacts', 'WORKSPACE'],
    ])
    expect(new Set(navigation.map((item) => item.view)).size).toBe(Object.keys(views).length)
    expect(Object.values(views).map((view) => view.title)).toEqual([
      'Dashboard',
      'Customer invoices',
      'Vendor bills',
      'Journal entries',
      'Chart of accounts',
      'Trial balance',
      'Contacts',
    ])
    for (const module of activeModules)
      for (const item of module.navigation) expect(moduleForView(item.view)).toBe(module)
    expect(moduleForView('apps')).toBeUndefined()
    expect(views.contacts.component).toBeDefined()
    expect(navigation.filter((item) => item.standalone).map((item) => item.view)).toEqual([
      'contacts',
    ])
  })

  it('does not assign planned modules a launch target or navigation', () => {
    const planned = modules.filter((module) => module.status === 'planned')
    expect(planned.map((module) => module.id)).toEqual(['sales', 'projects', 'inventory'])
    for (const module of planned) {
      expect(module.entryView).toBeUndefined()
      expect(module.navigation).toBeUndefined()
    }
  })

  it('renders the same two launch buttons and three inert Planned tiles', () => {
    const html = renderToStaticMarkup(createElement(AppLauncher, { onNavigate: () => {} }))
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toContain('<h2>Accounting</h2>')
    expect(buttons[0]).toContain('Open accounting')
    expect(buttons[1]).toContain('<h2>Contacts</h2>')
    expect(buttons[1]).toContain('Open contacts')
    expect(html.match(/class="tile planned"/g)).toHaveLength(3)
    expect(html.match(/<span class="badge">Planned<\/span>/g)).toHaveLength(3)
    expect(html).toContain('class="app-icon contacts-icon"')
    expect(html).toContain('Good work starts here.')
    expect(html).toContain('MongoDB-backed accounting. No hidden spreadsheets, no vendor lock-in.')
  })

  it('renders Contacts through the registry without changing its current screen', () => {
    const state: State = {
      company: 'Synthetic company',
      currency: 'EUR',
      demo: true,
      development: true,
      accounts: [],
      documents: [],
      imports: [],
      scannerReady: false,
      scannerError: '',
      contacts: [],
    }
    const request: APIRequest = async () => {
      throw new Error('Rendering must not issue a request.')
    }
    const onRefresh = async () => {}
    const RegisteredView = views.contacts.component
    if (!RegisteredView) throw new Error('Contacts must have a registered component.')
    const registered = renderToStaticMarkup(
      createElement(RegisteredView, { state, request, onRefresh, onStateChange: () => {} }),
    )
    const original = renderToStaticMarkup(
      createElement(Contacts, { items: [], request, onRefresh, onChange: () => {} }),
    )
    expect(registered).toBe(original)
  })
})
