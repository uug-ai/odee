import { useEffect, useState } from 'react'
import type {
  APIRequest,
  ConfigurationData,
  ConfigurationView,
  Document,
  PublishedConfiguration,
} from './types'
import { statusText, messageText, requestMessage, t, useLocale } from './i18n'
import { responseStatus } from './api'
import { selectionLabel } from './accounting'

const roleLabels = {
  bank: 'Bank',
  receivable: 'Accounts receivable',
  payable: 'Accounts payable',
  revenue: 'Sales revenue',
  expense: 'Operating expenses',
  vatPayable: 'VAT payable',
  vatRecoverable: 'Recoverable VAT',
  invoiceJournal: 'Sales journal',
  billJournal: 'Purchase journal',
  paymentJournal: 'Payment journal',
} as const
function failure(error: unknown) {
  return messageText(requestMessage(error, responseStatus(error)))
}
export function Configuration({
  view,
  request,
  onRefresh,
  canAdmin,
}: {
  view: ConfigurationView
  request: APIRequest
  onRefresh: () => Promise<void>
  canAdmin: boolean
}) {
  useLocale()
  const [data, setData] = useState<ConfigurationData>(() => structuredClone(view.stage.data))
  const [versions, setVersions] = useState<PublishedConfiguration[]>([])
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<PublishedConfiguration | null>(null)
  useEffect(() => {
    setData(structuredClone(view.stage.data))
  }, [view.stage.version])
  async function load(after = '') {
    const result = await request<{ items: PublishedConfiguration[]; next: string }>(
      `accounting-configuration/versions${after ? `?after=${after}` : ''}`,
    )
    setVersions((current) => (after ? [...current, ...result.items] : result.items))
    setNext(result.next)
  }
  useEffect(() => {
    let active = true
    request<{ items: PublishedConfiguration[]; next: string }>('accounting-configuration/versions')
      .then((result) => {
        if (active) {
          setVersions(result.items)
          setNext(result.next)
        }
      })
      .catch((error) => {
        if (active) setError(failure(error))
      })
    return () => {
      active = false
    }
  }, [request, view.stage.version, view.default.revision])
  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
      await onRefresh()
      await load()
      setNotice(message)
    } catch (error) {
      setError(failure(error))
    } finally {
      setBusy(false)
    }
  }
  const disabled = !canAdmin || busy
  return (
    <section className="panel configuration">
      <h2>{t('Accounting configuration')}</h2>
      <p>
        {t(
          'SYNTHETIC starter codes are not a Belgian statutory chart. Publication and Make default are software operations, not legal approval.',
        )}
      </p>
      <p>
        {t('Stage revision')}: {view.stage.version} · {t('Default revision')}:{' '}
        {view.default.revision} · {view.default.versionId ?? 'legacy-starter-v1'}
      </p>
      {!canAdmin && (
        <p>{t('Read-only. Configuration changes require read and admin capabilities.')}</p>
      )}
      {view.defaultError && <p role="alert">{messageText(view.defaultError)}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <details open>
        <summary>{t('Configuration readiness')}</summary>
        {(['invoice', 'bill'] as const).map((kind) => (
          <div key={kind}>
            <strong>{t(kind === 'invoice' ? 'Customer invoices' : 'Vendor bills')}</strong>
            <ul>
              {view.readiness[kind].length ? (
                view.readiness[kind].map((issue, i) => <li key={i}>{messageText(issue)}</li>)
              ) : (
                <li>{t('Ready for the current engine; statutory use is not assessed.')}</li>
              )}
            </ul>
          </div>
        ))}
      </details>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void act(
            () =>
              request(
                'accounting-configuration/stage',
                { expectedStageVersion: view.stage.version, data },
                'PUT',
              ),
            t('Configuration stage saved.'),
          )
        }}
      >
        <fieldset disabled={disabled}>
          <legend>{t('Editable stage')}</legend>
          <h3>{t('Accounts')}</h3>
          {data.accounts.map((account, index) => (
            <div className="configuration-row" key={index}>
              <label>
                {t('Code')}
                <input
                  aria-label={`${t('Account code')} ${index + 1}`}
                  value={account.code}
                  maxLength={12}
                  required
                  onChange={(event) =>
                    setData({
                      ...data,
                      accounts: data.accounts.map((a, i) =>
                        i === index ? { ...a, code: event.target.value } : a,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t('Name')}
                <input
                  aria-label={`${t('Account name')} ${index + 1}`}
                  value={account.name}
                  maxLength={200}
                  required
                  onChange={(event) =>
                    setData({
                      ...data,
                      accounts: data.accounts.map((a, i) =>
                        i === index ? { ...a, name: event.target.value } : a,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t('Type')}
                <select
                  aria-label={`${t('Account type')} ${index + 1}`}
                  value={account.type}
                  onChange={(event) =>
                    setData({
                      ...data,
                      accounts: data.accounts.map((a, i) =>
                        i === index ? { ...a, type: event.target.value } : a,
                      ),
                    })
                  }
                >
                  {['asset', 'liability', 'equity', 'income', 'expense'].map((type) => (
                    <option key={type} value={type}>
                      {statusText(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={account.active}
                  onChange={(event) =>
                    setData({
                      ...data,
                      accounts: data.accounts.map((a, i) =>
                        i === index ? { ...a, active: event.target.checked } : a,
                      ),
                    })
                  }
                />
                {t('Active')}
              </label>
              <button
                type="button"
                onClick={() =>
                  setData({ ...data, accounts: data.accounts.filter((_, i) => i !== index) })
                }
              >
                {t('Remove account')} {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={data.accounts.length >= 256}
            onClick={() =>
              setData({
                ...data,
                accounts: [...data.accounts, { code: '', name: '', type: 'asset', active: true }],
              })
            }
          >
            {t('Add account')}
          </button>
          <h3>{t('Mappings')}</h3>
          {Object.entries(roleLabels).map(([role, label]) => (
            <label className="configuration-mapping" key={role}>
              {t(label)}
              <select
                aria-label={`${t('Mapping')}: ${t(label)}`}
                value={data.mappings[role] ?? ''}
                onChange={(event) =>
                  setData({ ...data, mappings: { ...data.mappings, [role]: event.target.value } })
                }
              >
                <option value="">{t('Unresolved')}</option>
                {(role.endsWith('Journal') ? data.journals : data.accounts).map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <h3>{t('Journals')}</h3>
          {data.journals.map((journal, index) => (
            <div className="configuration-row" key={index}>
              <label>
                {t('Code')}
                <input
                  aria-label={`${t('Journal code')} ${index + 1}`}
                  value={journal.code}
                  maxLength={24}
                  required
                  onChange={(event) =>
                    setData({
                      ...data,
                      journals: data.journals.map((j, i) =>
                        i === index ? { ...j, code: event.target.value } : j,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t('Name')}
                <input
                  aria-label={`${t('Journal name')} ${index + 1}`}
                  value={journal.name}
                  required
                  maxLength={200}
                  onChange={(event) =>
                    setData({
                      ...data,
                      journals: data.journals.map((j, i) =>
                        i === index ? { ...j, name: event.target.value } : j,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t('Type')}
                <select
                  aria-label={`${t('Journal kind')} ${index + 1}`}
                  value={journal.kind}
                  onChange={(event) =>
                    setData({
                      ...data,
                      journals: data.journals.map((j, i) =>
                        i === index ? { ...j, kind: event.target.value } : j,
                      ),
                    })
                  }
                >
                  {['invoice', 'bill', 'payment'].map((kind) => (
                    <option key={kind} value={kind}>
                      {t(kind === 'invoice' ? 'Invoice' : kind === 'bill' ? 'Bill' : 'Payment')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={journal.active}
                  onChange={(event) =>
                    setData({
                      ...data,
                      journals: data.journals.map((j, i) =>
                        i === index ? { ...j, active: event.target.checked } : j,
                      ),
                    })
                  }
                />
                {t('Active')}
              </label>
              <button
                type="button"
                onClick={() =>
                  setData({ ...data, journals: data.journals.filter((_, i) => i !== index) })
                }
              >
                {t('Remove journal')} {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={data.journals.length >= 16}
            onClick={() =>
              setData({
                ...data,
                journals: [...data.journals, { code: '', name: '', kind: 'invoice', active: true }],
              })
            }
          >
            {t('Add journal')}
          </button>
          <h3>{t('Fiscal years and supported periods')}</h3>
          {data.years.map((year, index) => (
            <fieldset key={index}>
              <legend>
                {t('Fiscal year')} {index + 1}
              </legend>
              <div className="configuration-row">
                {(['start', 'end'] as const).map((field) => (
                  <label key={field}>
                    {t(field === 'start' ? 'Start date' : 'End date')}
                    <input
                      type="date"
                      aria-label={`${t('Fiscal year')} ${index + 1} ${t(field === 'start' ? 'Start date' : 'End date')}`}
                      value={year[field]}
                      required
                      onChange={(event) =>
                        setData({
                          ...data,
                          years: data.years.map((y, i) =>
                            i === index ? { ...y, [field]: event.target.value } : y,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              {year.periods.map((period, p) => (
                <div className="configuration-row" key={p}>
                  {(['start', 'end'] as const).map((field) => (
                    <label key={field}>
                      {t(field === 'start' ? 'Start date' : 'End date')}
                      <input
                        type="date"
                        aria-label={`${t('Period')} ${index + 1}/${p + 1} ${t(field === 'start' ? 'Start date' : 'End date')}`}
                        value={period[field]}
                        required
                        onChange={(event) =>
                          setData({
                            ...data,
                            years: data.years.map((y, i) =>
                              i === index
                                ? {
                                    ...y,
                                    periods: y.periods.map((v, n) =>
                                      n === p ? { ...v, [field]: event.target.value } : v,
                                    ),
                                  }
                                : y,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={period.active}
                      onChange={(event) =>
                        setData({
                          ...data,
                          years: data.years.map((y, i) =>
                            i === index
                              ? {
                                  ...y,
                                  periods: y.periods.map((v, n) =>
                                    n === p ? { ...v, active: event.target.checked } : v,
                                  ),
                                }
                              : y,
                          ),
                        })
                      }
                    />
                    {t('Supported')}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setData({
                        ...data,
                        years: data.years.map((y, i) =>
                          i === index ? { ...y, periods: y.periods.filter((_, n) => n !== p) } : y,
                        ),
                      })
                    }
                  >
                    {t('Remove period')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={year.periods.length >= 24}
                onClick={() =>
                  setData({
                    ...data,
                    years: data.years.map((y, i) =>
                      i === index
                        ? {
                            ...y,
                            periods: [...y.periods, { start: y.start, end: y.end, active: true }],
                          }
                        : y,
                    ),
                  })
                }
              >
                {t('Add period')}
              </button>
              <button
                type="button"
                onClick={() =>
                  setData({ ...data, years: data.years.filter((_, i) => i !== index) })
                }
              >
                {t('Remove fiscal year')}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={data.years.length >= 10}
            onClick={() =>
              setData({
                ...data,
                years: [...data.years, { start: '2026-01-01', end: '2026-12-31', periods: [] }],
              })
            }
          >
            {t('Add fiscal year')}
          </button>
          <label>
            {t('Mapping sources and accountant decisions')}
            <textarea
              value={data.note}
              maxLength={2000}
              onChange={(event) => setData({ ...data, note: event.target.value })}
            />
          </label>
          <button className="primary" type="submit">
            {t('Save stage')}
          </button>
        </fieldset>
      </form>
      <button
        disabled={disabled || view.stage.version === 0}
        onClick={() =>
          void act(
            () =>
              request('accounting-configuration/versions', {
                expectedStageVersion: view.stage.version,
                publicationId: view.stage.publicationId,
              }),
            t('Configuration published.'),
          )
        }
      >
        {t('Publish observed stage')}
      </button>
      <h3>{t('Immutable published versions')}</h3>
      <ul>
        {versions.map((p) => (
          <li key={p.id}>
            <button onClick={() => setReview(p)}>
              {t('Review version')} {p.id}
            </button>{' '}
            · {p.payload.sourceStageVersion}
            <button
              disabled={disabled}
              onClick={() =>
                void act(
                  () =>
                    request('accounting-configuration/activate', {
                      versionId: p.id,
                      expectedDefaultRevision: view.default.revision,
                    }),
                  t('Default configuration changed.'),
                )
              }
            >
              {t('Make default')} {p.id}
            </button>
          </li>
        ))}
      </ul>
      {next && (
        <button onClick={() => void load(next).catch((error) => setError(failure(error)))}>
          {t('More versions')}
        </button>
      )}
      {review && (
        <section aria-label={t('Published version review')}>
          <h4>{review.id}</h4>
          <p>{review.payload.digest}</p>
          <p>{review.payload.data.note}</p>
          <pre className="configuration-review">{JSON.stringify(review.payload.data, null, 2)}</pre>
          <button onClick={() => setReview(null)}>{t('Close review')}</button>
        </section>
      )}
    </section>
  )
}

export function DraftBinding({
  doc,
  request,
  onRefresh,
  canWrite,
}: {
  doc: Document
  request: APIRequest
  onRefresh: () => Promise<void>
  canWrite: boolean
}) {
  useLocale()
  const [target, setTarget] = useState('')
  const [journal, setJournal] = useState(doc.journalCode ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState<PublishedConfiguration[]>([])
  const [next, setNext] = useState('')
  const [loaded, setLoaded] = useState(false)
  async function load(after = '') {
    try {
      const result = await request<{ items: PublishedConfiguration[]; next: string }>(
        `accounting-configuration/versions${after ? `?after=${after}` : ''}`,
      )
      setVersions((v) => (after ? [...v, ...result.items] : result.items))
      setNext(result.next)
      setLoaded(true)
    } catch (error) {
      setError(failure(error))
    }
  }
  return (
    <section className="configuration-binding">
      <h3>{t('Selected accounting configuration')}</h3>
      <p>
        {selectionLabel(doc)} · {doc.journalCode ?? t('Unresolved')}
      </p>
      {doc.status === 'draft' && canWrite && (
        <>
          <p>
            {t(
              'Rebind changes only the selected version. Lines and legal captures are never substituted. Review accounts and journal before posting.',
            )}
          </p>
          {!loaded && <button onClick={() => void load()}>{t('Choose published version')}</button>}
          {loaded && (
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                setBusy(true)
                setError('')
                try {
                  await request(`documents/${doc.id}/configuration`, {
                    version: doc.version,
                    targetVersionId: target,
                    journalCode: journal,
                  })
                  await onRefresh()
                } catch (error) {
                  setError(failure(error))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <label>
                {t('Published target')}
                <select
                  aria-label={t('Published target')}
                  required
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">{t('Choose published version')}</option>
                  {versions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · {p.payload.sourceStageVersion}
                    </option>
                  ))}
                </select>
              </label>
              {next && (
                <button type="button" onClick={() => void load(next)}>
                  {t('More versions')}
                </button>
              )}
              <label>
                {t('Selected journal')}
                <input
                  maxLength={24}
                  value={journal}
                  onChange={(event) => setJournal(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy || !target}>
                {t('Confirm explicit rebind')}
              </button>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
