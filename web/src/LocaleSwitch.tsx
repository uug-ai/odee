import { setLocale, t, useLocale, type Locale } from './i18n'
import { refreshValidation } from './form-validation'

export function LocaleSwitch() {
  const locale = useLocale()
  return (
    <label className="locale-switch">
      <span>{t('Language')}</span>
      <select
        aria-label={t('Language')}
        value={locale}
        onChange={(event) => {
          setLocale(event.target.value as Locale)
          refreshValidation()
        }}
      >
        <option value="en" lang="en">
          {t('English')}
        </option>
        <option value="nl" lang="nl">
          {t('Nederlands')}
        </option>
      </select>
    </label>
  )
}
