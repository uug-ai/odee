import type { Document, Journal, Line, Entry } from './types'
import { getLocale, accountName, t } from './i18n'

export function cents(value: string): number {
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter a positive amount with at most two decimal places.')
  const [whole, fraction = ''] = value.trim().split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result > 1_000_000_000_000)
    throw new Error('Amount exceeds the supported limit.')
  return result
}

export function decimal(value: number) {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

export function money(value: number | bigint): string {
  const amount = BigInt(value)
  const absolute = amount < 0n ? -amount : amount
  const dutch = getLocale() === 'nl'
  return `${amount < 0n ? '-' : ''}€${dutch ? ' ' : ''}${new Intl.NumberFormat(dutch ? 'nl-NL' : 'en-GB').format(absolute / 100n)}${dutch ? ',' : '.'}${String(absolute % 100n).padStart(2, '0')}`
}

export function lineTotals(line: Line) {
  const base = BigInt(line.quantity) * BigInt(line.unitCents)
  const tax = (base * BigInt(line.taxBps) + 5000n) / 10000n
  return { base, tax, total: base + tax }
}

export function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dueInDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function overdue(doc: Document) {
  return doc.status === 'posted' && doc.dueDate < today()
}
export function label(doc: Document) {
  if (doc.status === 'draft') return 'Draft'
  if (doc.status === 'paid') return 'Paid'
  if (overdue(doc)) return 'Overdue'
  return doc.paid > 0 ? 'Partial' : 'Posted'
}

export function journals(documents: Document[]): Journal[] {
  return documents
    .filter((d) => d.status !== 'draft')
    .flatMap((document) => [
      {
        key: document.id,
        document,
        date: document.date,
        reference: document.reference || document.partner,
        entries: document.entries,
        payment: false,
      },
      ...document.payments.map((payment) => ({
        key: `${document.id}/${payment.id}`,
        document,
        date: payment.date,
        reference: payment.reference || 'Payment',
        entries: payment.entries,
        payment: true,
      })),
    ])
    .sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))
}

export function balances(documents: Document[]) {
  const result = new Map<
    string,
    ReturnType<typeof entryMeaning> & { debit: bigint; credit: bigint }
  >()
  for (const journal of journals(documents)) {
    for (const [index, entry] of journal.entries.entries()) {
      const meaning = entryMeaning(journal.document, entry, `${journal.key}/${index}`)
      const current = result.get(meaning.key) ?? { debit: 0n, credit: 0n }
      result.set(meaning.key, {
        ...meaning,
        debit: current.debit + BigInt(entry.debit),
        credit: current.credit + BigInt(entry.credit),
      })
    }
  }
  return result
}

export function selectionLabel(
  doc: Pick<Document, 'configurationSelection' | 'financialMeaning' | 'meaningError'>,
) {
  return (
    doc.configurationSelection?.versionId ??
    doc.configurationSelection?.policy ??
    doc.financialMeaning?.selection.policy ??
    (doc.meaningError ? t('Financial meaning unknown') : 'legacy-starter-v1')
  )
}
export function entryMeaning(doc: Document, entry: Entry, identity: string) {
  const frozen = doc.financialSnapshot ?? doc.financialMeaning
  const account = frozen?.accounts.find((a) => a.code === entry.accountCode)
  const scope = `${doc.organisationId ?? ''}/${doc.projectId ?? ''}/${doc.currency}`
  if (account && !doc.meaningError) {
    const selection = frozen!.selection
    const version = selection.versionId ?? selection.policy ?? ''
    return {
      key: `${scope}/${version}/${selection.digest}/${account.code}`,
      code: account.code,
      name:
        selection.policy === 'legacy-starter-v1'
          ? accountName(account.code, account.name)!
          : account.name,
      type: account.type,
      version,
      currency: doc.currency,
      known: true,
      role: Object.keys(frozen!.mappings).filter((role) => frozen!.mappings[role] === account.code),
    }
  }
  return {
    key: `${scope}/unresolved/${identity}`,
    code: entry.accountCode,
    name: t('Financial meaning unknown'),
    type: 'unknown',
    version: doc.configurationSelection?.versionId ?? 'unresolved',
    currency: doc.currency,
    known: false,
    role: [] as string[],
  }
}

export function csvCell(value: string) {
  // Spreadsheet exports must not evaluate partner-controlled formulas.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}
