import type { SyntheticEvent } from 'react'
import { t } from './i18n'

function localize(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  input.setCustomValidity('')
  const validity = input.validity
  const message = validity.valueMissing
    ? input instanceof HTMLInputElement && input.type === 'checkbox'
      ? t('Confirm this checkbox.')
      : t('Complete this field.')
    : validity.typeMismatch
      ? t('Enter a valid email address.')
      : validity.rangeOverflow ||
          validity.rangeUnderflow ||
          validity.stepMismatch ||
          validity.badInput
        ? input instanceof HTMLInputElement && input.type === 'date'
          ? t('Enter a date within the allowed range.')
          : t('Enter a whole number within the allowed range.')
        : validity.valid
          ? ''
          : t('Check this value.')
  input.setCustomValidity(message)
  input.toggleAttribute('data-odee-invalid', Boolean(message))
}
export const localizedValidation = {
  onInvalid(event: SyntheticEvent) {
    const input = event.target
    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLSelectElement ||
      input instanceof HTMLTextAreaElement
    )
      localize(input)
  },
  onInput(event: SyntheticEvent) {
    const input = event.target
    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLSelectElement ||
      input instanceof HTMLTextAreaElement
    ) {
      input.setCustomValidity('')
      input.removeAttribute('data-odee-invalid')
    }
  },
}
export function refreshValidation() {
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      '[data-odee-invalid]',
    )
    .forEach(localize)
}
