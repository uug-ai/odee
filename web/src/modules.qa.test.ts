import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { Book } from 'iconoir-react'
import { describe, expect, it, vi } from 'vitest'
import { AppLauncher } from './AppLauncher'
import { Contacts } from './Contacts'
import {
  activeModules,
  defaultView,
  moduleForView,
  modules,
  navigation,
  views,
  type ModuleProps,
  type View,
} from './modules'
import type { APIRequest, Contact, State } from './types'

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...elements(child.props.children as ReactNode)]
      : [],
  )
}

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

function contact(id: string, version = 1): Contact {
  return {
    id,
    version,
    name: `Synthetic ${id}`,
    isCompany: true,
    companyName: '',
    email: '',
    phone: '',
    mobile: '',
    website: '',
    vat: '',
    reference: '',
    type: 'contact',
    address: { street: '', street2: '', postalCode: '', city: '', state: '', country: '' },
    tags: [],
    customer: true,
    vendor: false,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('ODEE-004 rev1 independent module compatibility', () => {
  it('gives every registered view one active owner and keeps apps outside a module', () => {
    const owned = activeModules.flatMap((module) => module.navigation.map((item) => item.view))
    expect([...owned].sort()).toEqual(Object.keys(views).sort())
    expect(new Set(owned).size).toBe(owned.length)
    expect(navigation).toEqual(activeModules.flatMap((module) => module.navigation))
    for (const module of activeModules) {
      expect(module.navigation.map((item) => item.view)).toContain(module.entryView)
      for (const item of module.navigation) {
        expect(moduleForView(item.view)).toBe(module)
        expect(views[item.view].title).toBeTruthy()
      }
    }
    expect(moduleForView('apps')).toBeUndefined()
    expect(moduleForView(defaultView)?.id).toBe('accounting')
    expect(moduleForView('contacts')?.id).toBe('contacts')
  })

  it('executes only Accounting and Contacts launcher callbacks with the original destinations', () => {
    const onNavigate = vi.fn<(view: View) => void>()
    const tree = elements(AppLauncher({ onNavigate }))
    const buttons = tree.filter((element) => element.type === 'button')
    expect(buttons.map((button) => button.key?.split('$').at(-1))).toEqual([
      'accounting',
      'contacts',
    ])
    expect(onNavigate).not.toHaveBeenCalled()
    for (const button of buttons) {
      expect(button.props.disabled).not.toBe(true)
      const click = button.props.onClick as () => void
      click()
    }
    expect(onNavigate.mock.calls).toEqual([['dashboard'], ['contacts']])

    const planned = tree.filter((element) => element.props.className === 'tile planned')
    expect(planned).toHaveLength(3)
    expect(planned.map((tile) => tile.key?.split('$').at(-1))).toEqual([
      'sales',
      'projects',
      'inventory',
    ])
    for (const tile of planned) {
      expect(tile.type).toBe('div')
      expect(tile.props.onClick).toBeUndefined()
      expect(tile.props.tabIndex).toBeUndefined()
      expect(elements(tile.props.children as ReactNode).some((child) => child.type === 'a')).toBe(
        false,
      )
      expect(
        elements(tile.props.children as ReactNode).some((child) => child.type === 'button'),
      ).toBe(false)
    }
    expect(modules.filter((module) => module.status === 'planned')).toHaveLength(3)
  })

  it('forwards Contacts dependencies and applies changes to latest state, not the render snapshot', () => {
    const original = contact('existing')
    const unrelated = contact('unrelated')
    const saved = contact('existing', 2)
    const request: APIRequest = vi.fn(async () => {
      throw new Error('Rendering must never issue an API request')
    })
    const onRefresh = vi.fn(async () => {})
    const onStateChange = vi.fn<(value: SetStateAction<State | null>) => void>()
    const Registered = views.contacts.component as (
      props: ModuleProps,
    ) => ReactElement<React.ComponentProps<typeof Contacts>>
    const rendered = Registered({
      state: { ...state, contacts: [original] },
      request,
      onRefresh,
      onStateChange,
    })
    expect(rendered.type).toBe(Contacts)
    expect(rendered.props.items).toEqual([original])
    expect(rendered.props.request).toBe(request)
    expect(rendered.props.onRefresh).toBe(onRefresh)
    expect(request).not.toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()

    rendered.props.onChange(saved)

    expect(onStateChange).toHaveBeenCalledOnce()
    const update = onStateChange.mock.calls[0][0]
    if (typeof update !== 'function') throw new Error('Contacts must use a functional state update')
    const latest = {
      ...state,
      company: 'Latest synthetic company',
      contacts: [original, unrelated],
    }
    const changed = update(latest)
    expect(changed).toEqual({ ...latest, contacts: [unrelated, saved] })
    expect(changed?.documents).toBe(latest.documents)
    expect(latest.contacts).toEqual([original, unrelated])
    expect(original.version).toBe(1)
    expect(update(null)).toBeNull()
  })

  it('appends a newly created contact without discarding existing contacts', () => {
    const existing = contact('existing')
    const added = contact('new')
    const onStateChange = vi.fn<(value: SetStateAction<State | null>) => void>()
    const Registered = views.contacts.component as (
      props: ModuleProps,
    ) => ReactElement<React.ComponentProps<typeof Contacts>>
    const rendered = Registered({
      state,
      request: async () => {
        throw new Error('No request expected')
      },
      onRefresh: async () => {},
      onStateChange,
    })
    rendered.props.onChange(added)
    const update = onStateChange.mock.calls[0][0]
    if (typeof update !== 'function') throw new Error('Expected functional state update')
    expect(update({ ...state, contacts: [existing] })?.contacts).toEqual([existing, added])
  })

  it('renders and launches a future registry entry without a module-specific launcher branch', async () => {
    vi.resetModules()
    vi.doMock('./modules', () => ({
      modules: [
        {
          id: 'synthetic-future-module',
          status: 'active',
          name: 'Sales',
          description: 'From opportunity to order',
          icon: Book,
          entryView: 'synthetic-future-view',
          openLabel: 'Open accounting',
        },
        {
          id: 'synthetic-planned-module',
          status: 'planned',
          name: 'Inventory',
          description: 'Everything in its place',
          icon: Book,
        },
      ],
    }))
    try {
      const { AppLauncher: ExtendedLauncher } = await import('./AppLauncher')
      const onNavigate = vi.fn()
      const tree = elements(ExtendedLauncher({ onNavigate }))
      const buttons = tree.filter((element) => element.type === 'button')
      expect(buttons).toHaveLength(1)
      expect(elements(buttons[0].props.children as ReactNode)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'h2', props: { children: 'Sales' } }),
        ]),
      )
      const click = buttons[0].props.onClick as () => void
      click()
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith('synthetic-future-view')
      expect(tree.filter((element) => element.props.className === 'tile planned')).toHaveLength(1)
    } finally {
      vi.doUnmock('./modules')
      vi.resetModules()
    }
  })
})
