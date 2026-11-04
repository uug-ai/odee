import { useSyncExternalStore } from 'react'
import { nl } from './locales/nl'

export type Locale = 'en' | 'nl'
export type MessageKey = keyof typeof nl
export type StaticKey = {
  [K in MessageKey]: K extends `${string}{${string}` ? never : K
}[MessageKey]
type Parameters<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Parameters<Rest>
  : never
type Values<K extends MessageKey> = Record<Parameters<K>, string | number>
export const catalogs: Record<Locale, Record<MessageKey, string>> = {
  en: Object.fromEntries(Object.keys(nl).map((key) => [key, key])) as Record<MessageKey, string>,
  nl,
}
const storageKey = 'odee.locale'
export function detectLocale(saved: unknown, languages: unknown): Locale {
  if (saved === 'en' || saved === 'nl') return saved
  if (!Array.isArray(languages)) return 'en'
  for (const language of languages) {
    if (typeof language !== 'string') continue
    const base = language.toLowerCase().split('-')[0]
    if (base === 'en' || base === 'nl') return base
  }
  return 'en'
}
function initialLocale(): Locale {
  let saved: string | null = null
  try {
    saved = globalThis.localStorage?.getItem(storageKey) ?? null
  } catch {
    // Storage can be disabled. Switching still works for the current tab.
  }
  if (saved === 'en' || saved === 'nl') return saved
  let languages: unknown
  try {
    languages = typeof navigator === 'undefined' ? undefined : navigator.languages
  } catch {
    // Browser preferences may be unavailable independently of persistent storage.
    return 'en'
  }
  return detectLocale(null, languages)
}
let locale = initialLocale()
const listeners = new Set<() => void>()
export const getLocale = () => locale
export function setLocale(next: Locale) {
  locale = next
  try {
    globalThis.localStorage?.setItem(storageKey, next)
  } catch {
    // No persistent storage is required to use the application.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  listeners.forEach((listener) => listener())
}
export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLocale,
    () => 'en' as const,
  )
}
export function t<K extends MessageKey>(
  key: K,
  ...args: Parameters<K> extends never ? [] : [Values<K>]
): string {
  const template = catalogs[locale][key]
  if (template === undefined) throw new Error(`Missing ${locale} translation: ${key}`)
  const values = args[0] as Record<string, string | number> | undefined
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (values?.[name] === undefined) throw new Error(`Missing interpolation: ${name}`)
    return String(values[name])
  })
}

// State/status codes remain locale-independent; only their visible representation changes.
export const statusText = (value: string) => {
  const keys: Record<string, StaticKey> = {
    All: 'All',
    Draft: 'Draft',
    Posted: 'Posted',
    Partial: 'Partial',
    Paid: 'Paid',
    Overdue: 'Overdue',
    Active: 'Active',
    Companies: 'Companies',
    People: 'People',
    Customers: 'Customers',
    Vendors: 'Vendors',
    Archived: 'Archived',
    draft: 'Draft',
    posted: 'Posted',
    paid: 'Paid',
    pending: 'Pending',
    scanning: 'Scanning',
    ready: 'Ready for review',
    failed: 'Needs attention',
    contact: 'Contact',
    invoice: 'Invoice',
    bill: 'Bill',
    delivery: 'Delivery',
    other: 'Other',
    private: 'Private',
    asset: 'Asset',
    liability: 'Liability',
    equity: 'Equity',
    income: 'Income',
    revenue: 'Income',
    expense: 'Expense',
  }
  return keys[value] ? t(keys[value]) : value
}

export function scanMethodText(method: string, empty: StaticKey) {
  if (!method) return t(empty)
  const methods: Record<string, StaticKey> = {
    'pdf text': 'PDF text',
    'pdf + ocr': 'PDF text + OCR',
    ocr: 'OCR',
  }
  return Object.hasOwn(methods, method)
    ? t(methods[method])
    : t('Original diagnostic: {message}', { message: method })
}

// Never translate business data. This adapter is only for application messages, not names/text.
export function messageText(message: string): string {
  if (message.startsWith('Sign-out was not confirmed. '))
    return `${t('Sign-out was not confirmed.')} ${messageText(message.slice(28))}`
  if (message.startsWith('invalid accounting input: ')) return messageText(message.slice(26))
  if (Object.hasOwn(nl, message)) return catalogs[locale][message as MessageKey]
  const key = (Object.keys(nl) as MessageKey[]).find((key) => nl[key] === message)
  if (key) return catalogs[locale][key]
  const field = /^contact (.+) must contain at most (\d+) valid characters$/.exec(message)
  if (field) {
    const fields: Record<string, StaticKey> = {
      name: 'Name',
      'company name': 'Company',
      email: 'Email',
      phone: 'Phone',
      mobile: 'Mobile',
      website: 'Website',
      VAT: 'VAT',
      reference: 'Reference',
      street: 'Street',
      'street 2': 'Street 2',
      'postal code': 'Postal code',
      city: 'City',
      state: 'State / province',
      country: 'Country',
    }
    return t('contact {field} must contain at most {max} valid characters', {
      field: fields[field[1]] ? t(fields[field[1]]) : field[1],
      max: field[2],
    })
  }
  for (const key of Object.keys(nl) as MessageKey[]) {
    if (!key.includes('{')) continue
    const names: string[] = []
    const pattern = key
      .split(/(\{[^}]+\})/)
      .map((part) => {
        if (part.startsWith('{') && part.endsWith('}')) {
          names.push(part.slice(1, -1))
          return '(.+?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    const match = new RegExp(`^${pattern}$`).exec(message)
    if (match)
      return catalogs[locale][key].replace(
        /\{([^}]+)\}/g,
        (_, name: string) => match[names.indexOf(name) + 1],
      )
  }
  const row = /^contact row (\d+): (.+)$/.exec(message)
  if (row) return t('Contact row {row}: {message}', { row: row[1], message: messageText(row[2]) })
  if (message.startsWith('Invalid JSON request: '))
    return `${t('Invalid JSON request.')} ${t('Original diagnostic: {message}', { message: message.slice(22) })}`
  return t('Original diagnostic: {message}', { message })
}

export function requestMessage(error: unknown, status?: number): string {
  if (status === 401) return 'Session expired. Sign in again.'
  if (status === 403)
    return 'Access denied. Your session is still active; ask your administrator for permission.'
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

export function accountName(code: string, original?: string) {
  const names: Record<string, StaticKey> = {
    '1000': 'Bank',
    '1100': 'Accounts receivable',
    '1200': 'Recoverable VAT',
    '2000': 'Accounts payable',
    '2100': 'VAT payable',
    '3000': 'Retained earnings',
    '4000': 'Sales revenue',
    '5000': 'Operating expenses',
  }
  const key = names[code]
  return key && key === original ? t(key) : original
}
