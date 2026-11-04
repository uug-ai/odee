import { createElement, type ComponentType, type Dispatch, type SetStateAction } from 'react'
import {
  Book,
  Building,
  CheckCircle,
  CreditCard,
  GraphUp,
  HomeSimple,
  ViewGrid,
  Wallet,
} from 'iconoir-react'
import { Contacts } from './Contacts'
import { Company } from './Company'
import type { APIRequest, State } from './types'
import type { StaticKey } from './i18n'

export interface ModuleProps {
  state: State
  request: APIRequest
  onRefresh: () => Promise<void>
  onStateChange: Dispatch<SetStateAction<State | null>>
  canWrite?: boolean
  canAdmin?: boolean
}

function ContactsView({ state, request, onRefresh, onStateChange, canWrite = false }: ModuleProps) {
  return createElement(Contacts, {
    items: state.contacts ?? [],
    request,
    onRefresh,
    canWrite,
    onChange: (contact) =>
      onStateChange(
        (current) =>
          current && {
            ...current,
            contacts: [...current.contacts.filter((item) => item.id !== contact.id), contact],
          },
      ),
  })
}

interface ViewDefinition {
  title: StaticKey
  path: string
  component?: ComponentType<ModuleProps>
}

// Accounting screens stay in App; additional modules register their own components here.
const registeredViews = {
  dashboard: { title: 'Dashboard', path: '/accounting' },
  invoices: { title: 'Customer invoices', path: '/accounting/invoices' },
  bills: { title: 'Vendor bills', path: '/accounting/bills' },
  journal: { title: 'Journal entries', path: '/accounting/journal' },
  accounts: { title: 'Chart of accounts', path: '/accounting/accounts' },
  reports: { title: 'Trial balance', path: '/accounting/reports' },
  contacts: { title: 'Contacts', path: '/contacts', component: ContactsView },
  settings: { title: 'Legal company profile', path: '/accounting/settings', component: Company },
} satisfies Record<string, ViewDefinition>

export type ModuleView = keyof typeof registeredViews
export type View = 'apps' | ModuleView
export const views: Readonly<Record<ModuleView, ViewDefinition>> = registeredViews

interface NavigationItem {
  view: ModuleView
  icon: typeof Book
  label: StaticKey
  group?: StaticKey
  standalone?: boolean
}

interface ModuleDetails {
  id: string
  name: StaticKey
  description: StaticKey
  icon: typeof Book
}

interface ActiveModule extends ModuleDetails {
  status: 'active'
  entryView: ModuleView
  openLabel: StaticKey
  iconClassName?: string
  workspaceDescription: StaticKey
  navigationLabel: StaticKey
  navigation: readonly NavigationItem[]
}

interface PlannedModule extends ModuleDetails {
  status: 'planned'
  entryView?: never
  navigation?: never
}

export type WorkspaceModule = ActiveModule | PlannedModule

export const modules: readonly WorkspaceModule[] = [
  {
    id: 'accounting',
    status: 'active',
    name: 'Accounting',
    description: 'Invoices, bills & your books.',
    icon: Book,
    entryView: 'dashboard',
    openLabel: 'Open accounting',
    workspaceDescription: 'Your financial workspace',
    navigationLabel: 'Accounting navigation',
    navigation: [
      { view: 'dashboard', icon: HomeSimple, label: 'Overview' },
      { view: 'invoices', icon: CreditCard, label: 'Invoices', group: 'CUSTOMERS' },
      { view: 'bills', icon: Wallet, label: 'Bills', group: 'VENDORS' },
      { view: 'journal', icon: Book, label: 'Journal entries', group: 'ACCOUNTING' },
      { view: 'accounts', icon: Building, label: 'Chart of accounts' },
      { view: 'reports', icon: GraphUp, label: 'Trial balance', group: 'REPORTING' },
      { view: 'settings', icon: Building, label: 'Legal company profile', group: 'WORKSPACE' },
    ],
  },
  {
    id: 'contacts',
    status: 'active',
    name: 'Contacts',
    description: 'Your business relationships.',
    icon: Building,
    iconClassName: 'contacts-icon',
    entryView: 'contacts',
    openLabel: 'Open contacts',
    workspaceDescription: 'Your business relationships',
    navigationLabel: 'Workspace navigation',
    navigation: [
      {
        view: 'contacts',
        icon: Building,
        label: 'Contacts',
        group: 'WORKSPACE',
        standalone: true,
      },
    ],
  },
  {
    id: 'sales',
    status: 'planned',
    name: 'Sales',
    description: 'From opportunity to order',
    icon: GraphUp,
  },
  {
    id: 'projects',
    status: 'planned',
    name: 'Projects',
    description: 'Make room for great work',
    icon: CheckCircle,
  },
  {
    id: 'inventory',
    status: 'planned',
    name: 'Inventory',
    description: 'Everything in its place',
    icon: ViewGrid,
  },
]

export const activeModules = modules.filter(
  (module): module is ActiveModule => module.status === 'active',
)
export const navigation = activeModules.flatMap((module) => module.navigation)
export const defaultView = activeModules[0].entryView
export const moduleForView = (view: View) =>
  activeModules.find((module) => module.navigation.some((item) => item.view === view))

export const pathForView = (view: View) => (view === 'apps' ? '/' : views[view].path)
export const viewForPath = (path: string): View | null =>
  path === '/' ? 'apps' : (navigation.find((item) => views[item.view].path === path)?.view ?? null)
