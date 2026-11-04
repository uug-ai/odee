import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  catalogs,
  detectLocale,
  messageText,
  requestMessage,
  setLocale,
  t,
  accountName,
  scanMethodText,
} from './i18n'
import { cents, decimal, money } from './accounting'
import {
  convertDecimal,
  formatDate,
  localeCents,
  localeDecimal,
  localePercent,
  parseDate,
  moneyEdit,
  moneyEditCents,
  switchMoneyEdit,
} from './locale-formats'

afterEach(() => setLocale('en'))

describe('complete shared catalogs', () => {
  it('covers every current static server invalid-input message', () => {
    const directory = fileURLToPath(new URL('../../internal/accounting/', import.meta.url))
    for (const file of readdirSync(directory).filter(
      (file) => file.endsWith('.go') && !file.endsWith('_test.go'),
    )) {
      for (const [, message] of readFileSync(`${directory}/${file}`, 'utf8').matchAll(
        /invalid\("([^"]+)"\)/g,
      ))
        expect(Object.hasOwn(catalogs.en, message), `${file}: ${message}`).toBe(true)
    }
  })
  it('has nonempty translations and exactly matching interpolation parameters for every key', () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs.nl).sort())
    for (const [key, value] of Object.entries(catalogs.nl)) {
      expect(value.trim(), key).not.toBe('')
      const placeholders = (value: string) =>
        [...value.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort()
      expect(placeholders(value), key).toEqual(placeholders(key))
    }
    expect(Object.keys(catalogs.en).length).toBeGreaterThan(400)
  })
  it('fails loudly for missing keys/parameters instead of displaying a key as translation', () => {
    expect(() => {
      // @ts-expect-error Unknown keys are also rejected at compile time.
      t('missing.key')
    }).toThrow('Missing')
    expect(() => {
      // @ts-expect-error Parameters are mandatory.
      t('Line {n} quantity')
    }).toThrow('Missing interpolation')
  })
  it('localizes application messages, never arbitrary business names', () => {
    setLocale('nl')
    expect(t('Line {n} description', { n: 2 })).toBe('Regel 2 omschrijving')
    expect(
      messageText(
        'invalid accounting input: payment must be positive and cannot exceed the outstanding balance',
      ),
    ).toBe('Betaling moet positief zijn en mag het openstaande saldo niet overschrijden')
    expect(messageText('document changed; refresh before trying again')).toBe(
      'Document gewijzigd; vernieuw voordat je opnieuw probeert',
    )
    expect(messageText('Synthetic unknown diagnostic')).toBe(
      'Oorspronkelijke diagnose: Synthetic unknown diagnostic',
    )
    expect(messageText(requestMessage(new Error('raw'), 403))).toContain('Je sessie is nog actief')
    expect(messageText(requestMessage(new Error('raw'), 401))).toBe(
      'Sessie verlopen. Meld je opnieuw aan.',
    )
    expect(accountName('1100', 'Accounts receivable')).toBe('Debiteuren')
    expect(accountName('1100', 'Customer custom account')).toBe('Customer custom account')
    expect(scanMethodText('pdf text', 'Not scanned')).toBe('PDF-tekst')
    expect(scanMethodText('pdf + ocr', 'Manual review')).toBe('PDF-tekst + OCR')
    expect(scanMethodText('ocr', 'Manual review')).toBe('OCR')
    expect(scanMethodText('', 'Not scanned')).toBe('Niet gescand')
    expect(scanMethodText('unknown original method', 'Manual review')).toBe(
      'Oorspronkelijke diagnose: unknown original method',
    )
    expect(
      t('Sign in with GitHub. Access is limited to active members of {organization}.', {
        organization: 'synthetic/fixture',
      }),
    ).toBe('Meld je aan met GitHub. Toegang is beperkt tot actieve leden van synthetic/fixture.')
    expect(messageText('contact row 3 has an invalid or repeated Odoo ID')).toContain(
      'Contactrij 3',
    )
    expect(
      messageText(
        'invalid accounting input: contact name must contain at most 200 valid characters',
      ),
    ).toBe('Contactveld Naam mag maximaal 200 geldige tekens bevatten')
  })
  it('uses explicit persisted selection, first supported browser language, then English', () => {
    expect(detectLocale('nl', ['en-US'])).toBe('nl')
    expect(detectLocale('en', ['nl-BE'])).toBe('en')
    expect(detectLocale('invalid', ['fr-BE', 'NL-be', 'en'])).toBe('nl')
    expect(detectLocale(null, ['de-DE'])).toBe('en')
    expect(detectLocale(null, [])).toBe('en')
  })
  it.each([undefined, null, 42, 'nl-BE', {}, { 0: 'nl', length: 1 }])(
    'safely defaults for malformed/unavailable preferences %j',
    (languages) => {
      expect(detectLocale(null, languages)).toBe('en')
      expect(detectLocale('nl', languages)).toBe('nl')
    },
  )
  it('ignores malformed preference entries without losing the first supported language', () => {
    expect(detectLocale(null, [null, 42, {}, 'fr-FR', 'NL-be', 'en-GB'])).toBe('nl')
  })
})

describe.each(['en', 'nl'] as const)('exact %s value presentation', (locale) => {
  it('round-trips integer cents through locale text without binary-float arithmetic', () => {
    setLocale(locale)
    for (const value of [0, 1, 5, 99, 100, 10000, 14200, 24200, 999999999999, 1000000000000]) {
      expect(localeCents(localeDecimal(value), locale)).toBe(value)
      expect(cents(decimal(value))).toBe(value)
    }
    expect(money(14200)).toBe(locale === 'nl' ? '€ 142,00' : '€142.00')
    expect(localePercent(725, locale)).toBe(locale === 'nl' ? '7,25%' : '7.25%')
    expect(localePercent(2100, locale)).toBe('21%')
    expect(money(-123456789012345678901n)).toBe(
      locale === 'nl' ? '-€ 1.234.567.890.123.456.789,01' : '-€1,234,567,890,123,456,789.01',
    )
    expect(
      convertDecimal(locale === 'nl' ? '100,05' : '100.05', locale, locale === 'nl' ? 'en' : 'nl'),
    ).toBe(locale === 'nl' ? '100.05' : '100,05')
  })
  it('rejects ambiguous grouping, wrong separators, scientific and invalid amounts', () => {
    for (const value of [
      '',
      '-1',
      '+1',
      'NaN',
      'Infinity',
      '1e2',
      '1 234',
      '1.234,56',
      '1,234.56',
      '10000000000.01',
      locale === 'nl' ? '1.00' : '1,00',
      locale === 'nl' ? '1,001' : '1.001',
    ]) {
      expect(() => localeCents(value, locale), value).toThrow()
    }
    expect(() => convertDecimal('invalid', locale, locale === 'nl' ? 'en' : 'nl')).toThrow()
  })
  it('retains invalid edit provenance across repeated switches until explicit input correction', () => {
    const other = locale === 'nl' ? 'en' : 'nl'
    const text = locale === 'nl' ? '1.05' : '1,05'
    let edit = { text, locale }
    expect(() => convertDecimal(text, locale, other)).toThrow()
    for (const target of [other, locale, other, locale, other] as const) {
      edit = switchMoneyEdit(edit, target)
      expect(edit).toEqual({ text, locale })
      expect(() => moneyEditCents(edit)).toThrow()
    }
    // Re-entering current-locale text is an explicit user correction/confirmation.
    edit = { text, locale: other }
    expect(moneyEditCents(edit)).toBe(105)
    for (const target of [locale, other, locale, other] as const) {
      edit = switchMoneyEdit(edit, target)
      expect(moneyEditCents(edit)).toBe(105)
      expect(edit.locale).toBe(target)
    }
  })
  it('switches valid monetary edits exactly without changing their integer cents', () => {
    const other = locale === 'nl' ? 'en' : 'nl'
    for (const value of [0, 1, 105, 10000, 14200, 24200, 1000000000000]) {
      let edit = moneyEdit(value, locale)
      for (const target of [other, locale, other] as const) {
        edit = switchMoneyEdit(edit, target)
        expect(edit).toEqual({ text: localeDecimal(value, target), locale: target })
        expect(moneyEditCents(edit)).toBe(value)
      }
    }
  })
  it('round-trips date-only values with no timezone conversion or invalid normalization', () => {
    for (const iso of ['2000-02-29', '2026-03-29', '2026-10-25', '2026-11-03', '2099-12-31']) {
      expect(parseDate(formatDate(iso, locale), locale)).toBe(iso)
    }
    expect(formatDate('2026-11-03', locale)).toBe(locale === 'nl' ? '03-11-2026' : '03/11/2026')
    for (const iso of [
      '2026-02-29',
      '2100-02-29',
      '2026-13-01',
      '2026-04-31',
      '2026-00-01',
      '2026-01-00',
      'not-a-date',
      '2026-11-03T00:00:00Z',
    ])
      expect(() => formatDate(iso, locale)).toThrow()
    expect(() => parseDate(locale === 'nl' ? '31-02-2026' : '31/02/2026', locale)).toThrow()
  })
})
