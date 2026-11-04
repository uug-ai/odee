import { describe, expect, it } from 'vitest'
import {
  balances,
  cents,
  csvCell,
  decimal,
  journals,
  lineTotals,
  money,
  entryMeaning,
  financialMeaningConflicts,
} from './accounting'
import type { Document } from './types'

describe('exact accounting amounts', () => {
  it('parses decimal input without floating point rounding', () => {
    expect(cents('0.29')).toBe(29)
    expect(cents('120.1')).toBe(12010)
    expect(cents(' 12.00 ')).toBe(1200)
    expect(cents('10000000000.00')).toBe(1_000_000_000_000)
    expect(() => cents('10000000000.01')).toThrow()
    for (const invalid of ['-1', '1.001', 'NaN', '1e2', '', '.2', '1,000'])
      expect(() => cents(invalid)).toThrow()
    expect(decimal(12010)).toBe('120.10')
  })
  it('rounds half-up for each line', () => {
    expect(
      lineTotals({
        description: 'Example',
        quantity: 1,
        unitCents: 5,
        taxBps: 1000,
        accountCode: '4000',
      }),
    ).toEqual({ base: 5n, tax: 1n, total: 6n })
  })
  it('formats BigInt totals beyond the safe number range', () => {
    expect(money(29)).toBe('€0.29')
    expect(money(-10001n)).toBe('-€100.01')
    expect(money(9007199254740993n)).toBe('€90,071,992,547,409.93')
  })
  it('neutralizes formulas in CSV cells', () => {
    expect(csvCell('=HYPERLINK("example")')).toBe(`"'=HYPERLINK(""example"")"`)
    expect(csvCell('Sales, domestic')).toBe('"Sales, domestic"')
  })
})

describe('posted ledger', () => {
  const doc: Document = {
    financialMeaning: {
      schemaVersion: 1,
      selection: { policy: 'legacy-starter-v1', digest: 'starter-fixture' },
      accounts: [
        { code: '1000', name: 'Bank', type: 'asset', active: true },
        { code: '1100', name: 'Accounts receivable', type: 'asset', active: true },
        { code: '4000', name: 'Sales revenue', type: 'income', active: true },
        { code: '2100', name: 'VAT payable', type: 'liability', active: true },
      ],
      mappings: { bank: '1000', receivable: '1100', revenue: '4000', vatPayable: '2100' },
      journals: [],
      period: { start: '2026-01-01', end: '2026-12-31', active: true },
    },
    id: 'a',
    number: 'INV-a',
    version: 2,
    kind: 'invoice',
    partner: 'Example',
    email: '',
    reference: '',
    date: '2026-11-03',
    dueDate: '2026-12-03',
    currency: 'EUR',
    status: 'posted',
    lines: [],
    subtotal: 10000,
    tax: 2100,
    total: 12100,
    paid: 5000,
    entries: [
      { accountCode: '1100', debit: 12100, credit: 0 },
      { accountCode: '4000', debit: 0, credit: 10000 },
      { accountCode: '2100', debit: 0, credit: 2100 },
    ],
    payments: [
      {
        id: 'p1',
        date: '2026-11-03',
        amount: 5000,
        reference: 'Transfer',
        entries: [
          { accountCode: '1000', debit: 5000, credit: 0 },
          { accountCode: '1100', debit: 0, credit: 5000 },
        ],
      },
    ],
    createdAt: '',
    updatedAt: '',
  }
  it('excludes drafts and includes payment journals exactly once', () => {
    const docs: Document[] = [doc, { ...doc, id: 'draft', status: 'draft' }]
    expect(journals(docs)).toHaveLength(2)
    const ledger = balances(docs)
    expect([...ledger.values()].find((row) => row.code === '1100')).toMatchObject({
      debit: 12100n,
      credit: 5000n,
    })
    expect([...ledger.values()].find((row) => row.code === '1000')).toMatchObject({
      debit: 5000n,
      credit: 0n,
    })
    expect([...ledger.values()].reduce((sum, b) => sum + b.debit - b.credit, 0n)).toBe(0n)
  })
  it('keeps same-code meanings separate and includes unresolved history', () => {
    const changed: Document = {
      ...doc,
      id: 'v2',
      financialMeaning: {
        ...doc.financialMeaning!,
        selection: { versionId: 'v2', digest: 'different' },
        accounts: doc.financialMeaning!.accounts.map((account) =>
          account.code === '1100'
            ? { ...account, name: 'Different meaning', type: 'expense' }
            : account,
        ),
      },
    }
    const unknown: Document = {
      ...doc,
      id: 'unknown',
      financialMeaning: undefined,
      meaningError: 'unknown',
    }
    const rows = [...balances([doc, changed, unknown]).values()]
    expect(rows.filter((row) => row.code === '1100' && row.known)).toHaveLength(2)
    expect(rows.find((row) => row.name === 'Different meaning')?.type).toBe('expense')
    expect(rows.filter((row) => !row.known)).toHaveLength(5)
    expect(rows.reduce((sum, row) => sum + row.debit - row.credit, 0n)).toBe(0n)
    expect(rows.reduce((sum, row) => sum + row.debit, 0n)).toBe(51300n)
  })
  it.each(['name', 'type', 'active', 'role'])(
    'marks conflicting frozen %s unresolved without merging or losing cents',
    (field) => {
      const original = structuredClone(doc)
      original.financialMeaning!.selection = { versionId: 'v1', digest: 'same-digest' }
      const changed = structuredClone(original)
      changed.id = 'contradictory'
      const account = changed.financialMeaning!.accounts.find((a) => a.code === '1100')!
      if (field === 'name') account.name = 'Contradictory receivable'
      if (field === 'type') account.type = 'expense'
      if (field === 'active') account.active = false
      if (field === 'role') changed.financialMeaning!.mappings.other = '1100'
      for (const documents of [
        [original, changed],
        [changed, original],
      ]) {
        const conflicts = financialMeaningConflicts(documents)
        const rows = [...balances(documents).values()]
        const receivable = rows.filter((row) => row.code === '1100')
        expect(receivable).toHaveLength(4)
        expect(receivable.every((row) => !row.known && row.type === 'unknown')).toBe(true)
        expect(receivable.reduce((sum, row) => sum + row.debit, 0n)).toBe(24200n)
        expect(receivable.reduce((sum, row) => sum + row.credit, 0n)).toBe(10000n)
        expect(rows.reduce((sum, row) => sum + row.debit - row.credit, 0n)).toBe(0n)
        expect(rows.filter((row) => row.code === '4000').every((row) => row.known)).toBe(true)
        for (const document of documents)
          expect(entryMeaning(document, document.entries[0], document.id, conflicts).known).toBe(
            false,
          )
      }
    },
  )
  it('still aggregates identical frozen definitions and mapping order', () => {
    const second = structuredClone(doc)
    second.id = 'same-meaning'
    second.financialMeaning!.mappings = Object.fromEntries(
      Object.entries(second.financialMeaning!.mappings).reverse(),
    )
    expect(financialMeaningConflicts([doc, second]).size).toBe(0)
    expect([...balances([doc, second]).values()].find((row) => row.code === '1100')).toMatchObject({
      known: true,
      debit: 24200n,
      credit: 10000n,
    })
  })
})
