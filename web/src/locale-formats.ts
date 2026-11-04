import { cents, decimal } from './accounting'
import { getLocale, t, type Locale } from './i18n'

export function localeDecimal(value: number, locale = getLocale()) {
  return decimal(value).replace('.', locale === 'nl' ? ',' : '.')
}
export function localePercent(bps: number, locale = getLocale()) {
  return `${localeDecimal(bps, locale)
    .replace(/([.,]\d*?)0+$/, '$1')
    .replace(/[.,]$/, '')}%`
}
export interface ScaledDecimalEdit {
  text: string
  locale: Locale
}
export function parseScaledDecimal(value: string, locale = getLocale()) {
  const separator = locale === 'nl' ? ',' : '.'
  const pattern = new RegExp(`^(0|[1-9]\\d*)(?:\\${separator}(\\d{1,4}))?$`)
  const parts = pattern.exec(value)
  if (!parts)
    throw new Error(
      t('Enter a nonnegative number with up to four decimal places in the current locale.'),
    )
  return (BigInt(parts[1]) * 10_000n + BigInt((parts[2] ?? '').padEnd(4, '0') || '0')).toString()
}
export function formatScaledDecimal(value: string, locale = getLocale()) {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid canonical scaled decimal')
  const amount = BigInt(value)
  const whole = (amount / 10_000n).toString()
  const fraction = String(amount % 10_000n).padStart(4, '0')
  return `${whole}${locale === 'nl' ? ',' : '.'}${fraction}`
}
export function parseBasisPointPercent(value: string, locale = getLocale()) {
  const percentUnits = BigInt(parseScaledDecimal(value, locale))
  if (percentUnits % 100n !== 0n)
    throw new Error(t('Percentage rates must resolve to whole basis points.'))
  const bps = percentUnits / 100n
  if (bps > 10_000n) throw new Error(t('Percentage rates must be between zero and one hundred.'))
  return bps.toString()
}
export function formatBasisPointPercent(value: string, locale = getLocale()) {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid canonical basis-point value')
  return formatScaledDecimal((BigInt(value) * 100n).toString(), locale)
    .replace(/([.,]\d*?[1-9])0+$/, '$1')
    .replace(/[.,]0+$/, '')
}
export function scaledDecimalEdit(value: string, locale = getLocale()): ScaledDecimalEdit {
  return { text: formatScaledDecimal(value, locale), locale }
}
export function switchScaledDecimalEdit(
  edit: ScaledDecimalEdit,
  locale: Locale,
): ScaledDecimalEdit {
  try {
    return { text: formatScaledDecimal(parseScaledDecimal(edit.text, edit.locale), locale), locale }
  } catch {
    return edit
  }
}
export function localeCents(value: string, locale = getLocale()) {
  const pattern = locale === 'nl' ? /^\d{1,11}(,\d{1,2})?$/ : /^\d{1,11}(\.\d{1,2})?$/
  if (!pattern.test(value.trim()))
    throw new Error(t('Enter a positive amount with at most two decimal places.'))
  return cents(value.trim().replace(',', '.'))
}
export function convertDecimal(value: string, from: Locale, to: Locale) {
  return localeDecimal(localeCents(value, from), to)
}
export interface MoneyEdit {
  text: string
  locale: Locale
}
export function moneyEdit(value: number, locale = getLocale()): MoneyEdit {
  return { text: localeDecimal(value, locale), locale }
}
export function moneyEditCents(edit: MoneyEdit) {
  return localeCents(edit.text, edit.locale)
}
export function switchMoneyEdit(edit: MoneyEdit, locale: Locale): MoneyEdit {
  try {
    return { text: convertDecimal(edit.text, edit.locale, locale), locale }
  } catch {
    // Invalid text retains its source rules until the user explicitly edits it.
    return edit
  }
}
function validISO(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
}
export function formatDate(iso: string, locale = getLocale()) {
  if (!validISO(iso)) throw new Error('Invalid ISO date')
  const [year, month, day] = iso.split('-')
  return [day, month, year].join(locale === 'nl' ? '-' : '/')
}
export function parseDate(value: string, locale = getLocale()) {
  const pattern = locale === 'nl' ? /^(\d{2})-(\d{2})-(\d{4})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/
  const parts = pattern.exec(value)
  if (!parts) throw new Error('Invalid local date')
  const iso = `${parts[3]}-${parts[2]}-${parts[1]}`
  if (!validISO(iso)) throw new Error('Invalid local date')
  return iso
}
