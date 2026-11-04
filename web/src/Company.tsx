import { useState, type FormEvent } from 'react'
import type { ContactData } from './types'
import type { ModuleProps } from './modules'
import { localizedValidation } from './form-validation'
import { messageText, requestMessage, t, useLocale } from './i18n'
import { responseStatus } from './api'

export const blankContact = (): ContactData => ({
  name: '',
  isCompany: true,
  companyName: '',
  email: '',
  phone: '',
  mobile: '',
  website: '',
  vat: '',
  reference: '',
  type: 'contact',
  address: { street: '', street2: '', postalCode: '', city: '', state: '', country: '' },
  tags: [],
  customer: false,
  vendor: false,
  active: true,
})

export function AccountingFields({
  data,
  onChange,
}: {
  data: ContactData
  onChange: (data: ContactData) => void
}) {
  return (
    <>
      <p>
        {t(
          'Identifier checks cover Belgian checksums only; registration, tax eligibility and legal completeness are not assessed.',
        )}
      </p>
      {(
        [
          ['enterpriseId', 'Enterprise identifier'],
          ['bankAccount', 'Bank account / IBAN'],
          ['bic', 'BIC'],
          ['paymentTerms', 'Payment terms'],
        ] as const
      ).map(([field, label]) => (
        <label key={field}>
          {t(label)}
          <input
            maxLength={300}
            value={data[field] ?? ''}
            onChange={(e) => onChange({ ...data, [field]: e.target.value })}
          />
        </label>
      ))}
      <label>
        {t('Tax applicability')}
        <select
          aria-label={t('Tax applicability')}
          value={data.taxApplicability || 'unknown'}
          onChange={(e) =>
            onChange({ ...data, taxApplicability: e.target.value as 'unknown' | 'unsupported' })
          }
        >
          <option value="unknown">{t('Unknown / not assessed')}</option>
          <option value="unsupported">{t('Unsupported')}</option>
        </select>
      </label>
    </>
  )
}

export function AccountingSummary({ data }: { data: ContactData }) {
  return (
    <dl>
      <dt>{t('Name')}</dt>
      <dd>{data.name}</dd>
      <dt>{t('Address')}</dt>
      <dd>{Object.values(data.address).filter(Boolean).join(', ') || t('Incomplete / unknown')}</dd>
      <dt>{t('Enterprise identifier')}</dt>
      <dd>{data.enterpriseId || t('Incomplete / unknown')}</dd>
      <dt>{t('VAT / tax ID')}</dt>
      <dd>{data.vat || t('Incomplete / unknown')}</dd>
      <dt>{t('Bank account / IBAN')}</dt>
      <dd>{data.bankAccount || t('Incomplete / unknown')}</dd>
      <dt>{t('BIC')}</dt>
      <dd>{data.bic || t('Incomplete / unknown')}</dd>
      <dt>{t('Payment terms')}</dt>
      <dd>{data.paymentTerms || t('Incomplete / unknown')}</dd>
      <dt>{t('Tax applicability')}</dt>
      <dd>
        {data.taxApplicability === 'unsupported' ? t('Unsupported') : t('Unknown / not assessed')}
      </dd>
    </dl>
  )
}

export function Company({ state, request, onRefresh, canAdmin = false }: ModuleProps) {
  useLocale()
  const profile = state.companyProfile
  const [data, setData] = useState<ContactData>(() => profile?.data ?? blankContact())
  const [version, setVersion] = useState(profile?.version ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  async function reload() {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const current = await request<typeof profile>('company-profile')
      setData(current?.data ?? blankContact())
      setVersion(current?.version ?? 0)
      await onRefresh()
    } catch (error) {
      setError(requestMessage(error, responseStatus(error)))
    } finally {
      setBusy(false)
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const result = await request<NonNullable<typeof profile>>(
        'company-profile',
        { version, data },
        'PUT',
      )
      setVersion(result.version)
      setData(result.data)
      setSaved(true)
      await onRefresh()
    } catch (error) {
      setError(requestMessage(error, responseStatus(error)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel">
      <h1>{t('Legal company profile')}</h1>
      <p>
        {t(
          'New documents capture this profile as invoice seller or bill buyer. Existing captures change only through explicit draft refresh.',
        )}
      </p>
      {!profile && <p role="status">{t('Incomplete / unknown')}</p>}
      {profile && <p>{t('Saved profile version {version}', { version })}</p>}
      {!canAdmin && (
        <p role="status">
          {t('Read-only. Company profile changes require read and admin capabilities.')}
        </p>
      )}
      {error && <p role="alert">{messageText(error)}</p>}
      {saved && <p role="status">{t('Company profile saved.')}</p>}
      <button className="button secondary" disabled={busy} onClick={() => void reload()}>
        {t('Reload saved profile')}
      </button>
      <form {...localizedValidation} onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy || !canAdmin}>
          <div className="form-grid">
            <label>
              {t('Name')}
              <input
                required
                maxLength={200}
                value={data.name}
                onChange={(e) => setData({ ...data, name: e.target.value })}
              />
            </label>
            <label>
              {t('VAT / tax ID')}
              <input
                maxLength={80}
                value={data.vat}
                onChange={(e) => setData({ ...data, vat: e.target.value })}
              />
            </label>
            {(
              [
                ['street', 'Street'],
                ['street2', 'Street 2'],
                ['postalCode', 'Postal code'],
                ['city', 'City'],
                ['state', 'State / province'],
                ['country', 'Country'],
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                {t(label)}
                <input
                  maxLength={
                    field === 'street' || field === 'street2'
                      ? 300
                      : field === 'postalCode'
                        ? 40
                        : 150
                  }
                  value={data.address[field]}
                  onChange={(e) =>
                    setData({ ...data, address: { ...data.address, [field]: e.target.value } })
                  }
                />
              </label>
            ))}
            <AccountingFields data={data} onChange={setData} />
          </div>
          <button className="button primary" type="submit">
            {t('Save company profile')}
          </button>
        </fieldset>
      </form>
    </section>
  )
}
