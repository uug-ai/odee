import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from './i18n'
import { calculatePolicyPreview } from './calculation-policy'
import {
  formatBasisPointPercent,
  formatScaledDecimal,
  parseBasisPointPercent,
  parseScaledDecimal,
} from './locale-formats'
import type { PolicyLineData } from './types'

afterEach(() => setLocale('en'))

describe('localized exact calculation inputs', () => {
  it.each([
    ['en', '0.3334', '0.0150'],
    ['nl', '0,3334', '0,0150'],
  ] as const)('round-trips four decimal places in %s', (locale, quantity, price) => {
    setLocale(locale)
    expect(parseScaledDecimal(quantity)).toBe('3334')
    expect(parseScaledDecimal(price)).toBe('150')
    expect(formatScaledDecimal('3334')).toBe(quantity)
    expect(formatScaledDecimal('150')).toBe(price)
  })

  it.each([
    ['en', '0,3334', '0.33345'],
    ['nl', '0.3334', '0,33345'],
  ] as const)('rejects ambiguous or over-precise values in %s', (locale, wrongMark, tooPrecise) => {
    setLocale(locale)
    expect(() => parseScaledDecimal(wrongMark)).toThrow()
    expect(() => parseScaledDecimal(tooPrecise)).toThrow()
  })

  it('converts only exact whole basis-point percentage rates', () => {
    setLocale('en')
    expect(parseBasisPointPercent('21.01')).toBe('2101')
    expect(formatBasisPointPercent('2101')).toBe('21.01')
    expect(() => parseBasisPointPercent('21.001')).toThrow()
    expect(() => parseBasisPointPercent('100.01')).toThrow()
  })
})

describe('exact fixed calculation preview', () => {
  it('applies fixed then ordered percentage discounts and rounds the line net once', () => {
    const line: PolicyLineData = {
      lineId: 'line-a',
      quantityUnits: '3334',
      unitPriceUnits: '15000',
      fixedDiscountUnits: '1000',
      percentageDiscountBps: ['1000', '500'],
      taxRateBps: '2100',
    }
    expect(calculatePolicyPreview([line])).toMatchObject({
      netMinor: '34',
      taxMinor: '7',
      grossMinor: '41',
      lines: [
        {
          lineId: 'line-a',
          netMinor: '34',
          taxMinor: '7',
          grossMinor: '41',
          netRoundingResidue: { numerator: '-4171', denominator: '20000' },
        },
      ],
    })
  })

  it('allocates grouped tax by largest remainder and UTF-8 line ID, not array order', () => {
    const line = (lineId: string): PolicyLineData => ({
      lineId,
      quantityUnits: '10000',
      unitPriceUnits: '25000',
      fixedDiscountUnits: '0',
      percentageDiscountBps: [],
      taxRateBps: '2100',
    })
    const preview = calculatePolicyPreview([line('B'), line('A')])
    expect(preview.taxGroups).toEqual([
      {
        taxRateBps: '2100',
        netMinor: '500',
        taxMinor: '105',
        independentLineTax: '106',
        roundingAdjustment: '-1',
      },
    ])
    expect(preview.lines.map(({ lineId, taxMinor }) => [lineId, taxMinor])).toEqual([
      ['B', '52'],
      ['A', '53'],
    ])
  })

  it('rejects excess fixed discounts, unsupported rates, and repeated stable IDs', () => {
    const line: PolicyLineData = {
      lineId: 'line-a',
      quantityUnits: '10000',
      unitPriceUnits: '100',
      fixedDiscountUnits: '101',
      percentageDiscountBps: [],
      taxRateBps: '2100',
    }
    expect(() => calculatePolicyPreview([line])).toThrow('fixed line discount')
    expect(() =>
      calculatePolicyPreview([{ ...line, fixedDiscountUnits: '0', taxRateBps: '10001' }]),
    ).toThrow('outside policy bounds')
    expect(() =>
      calculatePolicyPreview([
        { ...line, fixedDiscountUnits: '0' },
        { ...line, fixedDiscountUnits: '0' },
      ]),
    ).toThrow('outside policy bounds')
  })
})
