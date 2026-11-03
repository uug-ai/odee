import { describe, expect, it } from 'vitest'
import { balances, cents, csvCell, decimal, journals, lineTotals, money } from './accounting'
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
    expect(ledger.get('1100')).toEqual({ debit: 12100n, credit: 5000n })
    expect(ledger.get('1000')).toEqual({ debit: 5000n, credit: 0n })
    expect([...ledger.values()].reduce((sum, b) => sum + b.debit - b.credit, 0n)).toBe(0n)
  })
})
