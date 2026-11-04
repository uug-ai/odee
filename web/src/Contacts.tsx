import { useState, type FormEvent } from 'react'
import { ArrowRight, Building, Download, Plus, RefreshDouble, Search } from 'iconoir-react'
import { Modal } from './Modal'
import type { APIRequest, Contact, ContactData, OdooContactImport } from './types'
import { getLocale, messageText, requestMessage, statusText, t } from './i18n'
import { responseStatus } from './api'
import { localizedValidation } from './form-validation'
import { AccountingFields, blankContact } from './Company'

const errorMessage = (error: unknown) => requestMessage(error, responseStatus(error))
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
const addressText = (contact: Contact) =>
  [
    contact.address.street,
    contact.address.street2,
    [contact.address.postalCode, contact.address.city].filter(Boolean).join(' '),
    contact.address.state,
    contact.address.country,
  ]
    .filter(Boolean)
    .join('\n')

export function Contacts({
  items,
  request,
  onChange,
  onRefresh,
  canWrite = false,
}: {
  items: Contact[]
  request: APIRequest
  onChange: (item: Contact) => void
  onRefresh: () => Promise<void>
  canWrite?: boolean
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('Active')
  const [selected, setSelected] = useState<Contact | null>(null)
  const [editor, setEditor] = useState<Contact | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [importResult, setImportResult] = useState<{
    created: number
    skipped: number
    normalizedWebsites: number
  } | null>(null)
  const visible = items
    .filter((item) => {
      if (filter === 'Archived' ? item.active : !item.active) return false
      if ((filter === 'Companies' && !item.isCompany) || (filter === 'People' && item.isCompany))
        return false
      if ((filter === 'Customers' && !item.customer) || (filter === 'Vendors' && !item.vendor))
        return false
      return [
        item.name,
        item.companyName,
        item.email,
        item.phone,
        item.mobile,
        item.vat,
        item.reference,
        addressText(item),
        ...item.tags,
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim())
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const parent = selected?.odoo?.parentId
    ? items.find(
        (item) =>
          item.odoo?.origin === selected.odoo?.origin &&
          item.odoo?.database === selected.odoo?.database &&
          item.odoo?.id === selected.odoo?.parentId,
      )
    : undefined
  function exportContacts() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'odee-contacts.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <>
      <div className="breadcrumb">
        <button onClick={onRefresh}>{t('Workspace data')}</button>
        <span>/</span>
        <span>{t('Contacts')}</span>
      </div>
      <div className="page-heading contacts-heading">
        <div>
          <div className="eyebrow">{t('YOUR BUSINESS RELATIONSHIPS')}</div>
          <h1>{t('Contacts')}</h1>
          <p>{t('Companies, people and the details that keep you connected.')}</p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            aria-label={t('Refresh contacts')}
            onClick={() => void onRefresh()}
          >
            <RefreshDouble />
          </button>
          <button
            className="button secondary"
            disabled={!canWrite}
            onClick={() => setImporting(true)}
          >
            {t('Import Odoo JSON')}
          </button>
          <button className="button secondary" disabled={!items.length} onClick={exportContacts}>
            <Download />
            {t('Export JSON')}
          </button>
          <button
            className="button primary"
            disabled={!canWrite}
            onClick={() => {
              setError('')
              setEditor('new')
            }}
          >
            <Plus />
            {t('New contact')}
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {messageText(error)}
        </p>
      )}
      {notice && (
        <div className="alert success" role="status">
          {messageText(notice)}
        </div>
      )}
      {importResult && (
        <div className="alert success" role="status">
          {t(
            'Odoo import finished: {created} created, {skipped} already present. Existing contacts were not overwritten.',
            importResult,
          )}
          {importResult.normalizedWebsites > 0 &&
            ` ${t('{count} website links normalized; source text retained.', { count: importResult.normalizedWebsites })}`}
        </div>
      )}
      <div className="contacts-toolbar panel">
        <div className="filter-tabs" role="group" aria-label={t('Contact filters')}>
          {['Active', 'Companies', 'People', 'Customers', 'Vendors', 'Archived'].map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={filter === value ? 'active' : ''}
            >
              {statusText(value)}
            </button>
          ))}
        </div>
        <label className="contact-search">
          <Search />
          <input
            aria-label={t('Search contacts')}
            placeholder={t('Search name, email, VAT or address…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <p className="contact-count">
        {statusText(filter)} ·{' '}
        {t('{visible} contacts · {total} total records', {
          visible: visible.length,
          total: items.length,
        })}
      </p>
      <div className="contact-grid">
        {visible.map((item) => (
          <button
            className={`contact-card ${!item.active ? 'archived' : ''}`}
            aria-label={t('Open contact {name}', { name: item.name })}
            key={item.id}
            onClick={() => {
              setSelected(item)
              setError('')
            }}
          >
            <span className={`contact-avatar ${item.isCompany ? 'company-avatar' : ''}`}>
              {item.isCompany ? <Building /> : initials(item.name)}
            </span>
            <span className="contact-summary">
              <strong>{item.name}</strong>
              <span>
                {item.isCompany ? t('Company') : t('Person')}
                {item.companyName ? ` · ${item.companyName}` : ''}
              </span>
              {item.email && <span>{item.email}</span>}
              {item.phone && <span>{item.phone}</span>}
              {[item.address.city, item.address.country].filter(Boolean).length > 0 && (
                <span>{[item.address.city, item.address.country].filter(Boolean).join(', ')}</span>
              )}
              <span className="contact-tags">
                {item.customer && <em>{t('Customer')}</em>}
                {item.vendor && <em>{t('Vendor')}</em>}
                {item.tags.map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
                {item.odoo && <em>Odoo</em>}
              </span>
            </span>
            <ArrowRight />
          </button>
        ))}
      </div>
      {!visible.length && (
        <div className="empty panel">
          <Building />
          <h3>{items.length ? t('No matching contacts.') : t('Your contacts start here.')}</h3>
          <p>
            {t(
              'Create a contact or import your Odoo records. No sample contacts are added automatically.',
            )}
          </p>
        </div>
      )}
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div className="dialog-body">
            <div className="contact-detail-heading">
              <span className="contact-avatar company-avatar">
                <Building />
              </span>
              <div>
                <h3>{selected.isCompany ? t('Company') : t('Person')}</h3>
                <p>{selected.companyName}</p>
              </div>
              <span className="badge">{selected.active ? t('Active') : t('Archived')}</span>
            </div>
            <dl className="contact-details">
              <dt>{t('Email')}</dt>
              <dd>
                {selected.email ? (
                  <a href={`mailto:${selected.email}`}>{selected.email}</a>
                ) : (
                  t('Not set')
                )}
              </dd>
              <dt>{t('Phone')}</dt>
              <dd>
                {selected.phone || t('Not set')}
                {selected.mobile && (
                  <>
                    <br />
                    {t('Mobile')}: {selected.mobile}
                  </>
                )}
              </dd>
              <dt>{t('Website')}</dt>
              <dd>
                {selected.website ? (
                  <a href={selected.website} target="_blank" rel="noreferrer">
                    {selected.website}
                  </a>
                ) : (
                  t('Not set')
                )}
              </dd>
              <dt>{t('Address')}</dt>
              <dd className="postal-address">{addressText(selected) || t('Not set')}</dd>
              <dt>{t('Address type')}</dt>
              <dd>{statusText(selected.type)}</dd>
              <dt>{t('VAT / tax ID')}</dt>
              <dd>{selected.vat || t('Not set')}</dd>
              <dt>{t('Reference')}</dt>
              <dd>{selected.reference || t('Not set')}</dd>
              <dt>{t('Enterprise identifier')}</dt>
              <dd>{selected.enterpriseId || t('Incomplete / unknown')}</dd>
              <dt>{t('Bank account / IBAN')}</dt>
              <dd>{selected.bankAccount || t('Incomplete / unknown')}</dd>
              <dt>{t('BIC')}</dt>
              <dd>{selected.bic || t('Incomplete / unknown')}</dd>
              <dt>{t('Payment terms')}</dt>
              <dd>{selected.paymentTerms || t('Incomplete / unknown')}</dd>
              <dt>{t('Tax applicability')}</dt>
              <dd>
                {selected.taxApplicability === 'unsupported'
                  ? t('Unsupported')
                  : t('Unknown / not assessed')}
              </dd>
              <dt>{t('Relationships')}</dt>
              <dd>
                {[selected.customer && t('Customer'), selected.vendor && t('Vendor')]
                  .filter(Boolean)
                  .join(', ') || t('Contact')}
              </dd>
              <dt>{t('Tags')}</dt>
              <dd>{selected.tags.join(', ') || t('None')}</dd>
              {selected.odoo && (
                <>
                  {selected.odoo.originalWebsite &&
                    selected.odoo.originalWebsite !== selected.website && (
                      <>
                        <dt>{t('Original Odoo website')}</dt>
                        <dd>
                          {selected.odoo.originalWebsite}
                          <br />
                          <small>
                            {t(
                              'Source text retained; the current website was normalized or edited.',
                            )}
                          </small>
                        </dd>
                      </>
                    )}
                  <dt>{t('Odoo source')}</dt>
                  <dd>
                    {t('Record #{id} · {origin}', {
                      id: selected.odoo.id,
                      origin: selected.odoo.origin,
                    })}
                    <br />
                    {t('Copied {date}', {
                      date: new Date(selected.odoo.importedAt).toLocaleDateString(
                        getLocale() === 'nl' ? 'nl-NL' : 'en-GB',
                      ),
                    })}
                    {selected.odoo.parentId > 0 && (
                      <>
                        <br />
                        {t('Parent')}:{' '}
                        {parent ? (
                          <button className="text-button" onClick={() => setSelected(parent)}>
                            {parent.name}
                          </button>
                        ) : (
                          t('Odoo #{id} (not in this workspace)', { id: selected.odoo.parentId })
                        )}
                      </>
                    )}
                  </dd>
                </>
              )}
            </dl>
            <p className="dialog-intro">
              {t(
                'Changes here stay in Odee. Existing invoice and bill snapshots are not modified.',
              )}
            </p>
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setSelected(null)}>
              {t('Close')}
            </button>
            <button
              className="button primary"
              disabled={!canWrite}
              onClick={() => {
                setEditor(selected)
                setSelected(null)
              }}
            >
              {t('Edit contact')}
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <ContactEditor
          initial={editor}
          request={request}
          onClose={() => setEditor(null)}
          onSave={(item) => {
            onChange(item)
            setEditor(null)
            setSelected(item)
            setNotice('Contact saved in this workspace.')
          }}
        />
      )}
      {importing && (
        <OdooImport
          request={request}
          onClose={() => setImporting(false)}
          onDone={async (result) => {
            await onRefresh()
            setNotice('')
            setImportResult(result)
            setImporting(false)
          }}
        />
      )}
    </>
  )
}

function ContactEditor({
  initial,
  request,
  onClose,
  onSave,
}: {
  initial: Contact | 'new'
  request: APIRequest
  onClose: () => void
  onSave: (item: Contact) => void
}) {
  const [data, setData] = useState<ContactData>(() =>
    initial === 'new'
      ? blankContact()
      : {
          name: initial.name,
          isCompany: initial.isCompany,
          companyName: initial.companyName,
          email: initial.email,
          phone: initial.phone,
          mobile: initial.mobile,
          website: initial.website,
          vat: initial.vat,
          enterpriseId: initial.enterpriseId,
          bankAccount: initial.bankAccount,
          bic: initial.bic,
          paymentTerms: initial.paymentTerms,
          taxApplicability: initial.taxApplicability,
          reference: initial.reference,
          type: initial.type,
          address: { ...initial.address },
          tags: [...initial.tags],
          customer: initial.customer,
          vendor: initial.vendor,
          active: initial.active,
        },
  )
  const [tags, setTags] = useState(data.tags.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = (key: keyof ContactData, value: string | boolean) =>
    setData((current) => ({ ...current, [key]: value }))
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = {
        ...data,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        ...(initial === 'new' ? {} : { version: initial.version }),
      }
      onSave(
        await request<Contact>(
          initial === 'new' ? 'contacts' : `contacts/${initial.id}`,
          body,
          initial === 'new' ? 'POST' : 'PUT',
        ),
      )
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial === 'new' ? t('New contact') : t('Edit contact')}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form {...localizedValidation} onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className="dialog-body">
            <div className="form-grid">
              <label>
                {t('Name')}
                <input
                  required
                  autoFocus
                  maxLength={200}
                  value={data.name}
                  onChange={(event) => field('name', event.target.value)}
                />
              </label>
              <label>
                {t('Contact kind')}
                <select
                  value={data.isCompany ? 'company' : 'person'}
                  onChange={(event) => field('isCompany', event.target.value === 'company')}
                >
                  <option value="company">{t('Company')}</option>
                  <option value="person">{t('Person')}</option>
                </select>
              </label>
              <label>
                {t('Company / affiliation')}
                <input
                  maxLength={200}
                  value={data.companyName}
                  onChange={(event) => field('companyName', event.target.value)}
                />
              </label>
              <label>
                {t('Email')}
                <input
                  type="email"
                  maxLength={320}
                  value={data.email}
                  onChange={(event) => field('email', event.target.value)}
                />
              </label>
              <label>
                {t('Phone')}
                <input
                  maxLength={80}
                  value={data.phone}
                  onChange={(event) => field('phone', event.target.value)}
                />
              </label>
              <label>
                {t('Mobile')}
                <input
                  maxLength={80}
                  value={data.mobile}
                  onChange={(event) => field('mobile', event.target.value)}
                />
              </label>
              <label>
                {t('Website')}
                <input
                  maxLength={500}
                  value={data.website}
                  onChange={(event) => field('website', event.target.value)}
                  placeholder="https://example.com"
                />
              </label>
              <label>
                {t('VAT / tax ID')}
                <input
                  maxLength={80}
                  value={data.vat}
                  onChange={(event) => field('vat', event.target.value)}
                />
              </label>
              <label>
                {t('Reference')}
                <input
                  maxLength={100}
                  value={data.reference}
                  onChange={(event) => field('reference', event.target.value)}
                />
              </label>
              <AccountingFields data={data} onChange={setData} />
              <label>
                {t('Address type')}
                <select
                  value={data.type}
                  onChange={(event) =>
                    setData((current) => ({
                      ...current,
                      type: event.target.value as ContactData['type'],
                    }))
                  }
                >
                  {['contact', 'invoice', 'delivery', 'other', 'private'].map((type) => (
                    <option key={type} value={type}>
                      {statusText(type)}
                    </option>
                  ))}
                </select>
              </label>
              {(['street', 'street2', 'postalCode', 'city', 'state', 'country'] as const).map(
                (key) => (
                  <label key={key}>
                    {
                      {
                        street: t('Street'),
                        street2: t('Street 2'),
                        postalCode: t('Postal code'),
                        city: t('City'),
                        state: t('State / province'),
                        country: t('Country'),
                      }[key]
                    }
                    <input
                      maxLength={key === 'postalCode' ? 40 : key.startsWith('street') ? 300 : 150}
                      value={data.address[key]}
                      onChange={(event) =>
                        setData((current) => ({
                          ...current,
                          address: { ...current.address, [key]: event.target.value },
                        }))
                      }
                    />
                  </label>
                ),
              )}
              <label>
                {t('Tags (comma separated)')}
                <input value={tags} onChange={(event) => setTags(event.target.value)} />
              </label>
            </div>
            <div className="contact-checkboxes">
              {(['customer', 'vendor', 'active'] as const).map((key) => (
                <label className="checkbox" key={key}>
                  <input
                    type="checkbox"
                    checked={data[key]}
                    onChange={(event) => field(key, event.target.checked)}
                  />
                  <span>
                    {
                      {
                        customer: t('Customer'),
                        vendor: t('Vendor'),
                        active: t('Active (uncheck to archive)'),
                      }[key]
                    }
                  </span>
                </label>
              ))}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {messageText(error)}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button className="button primary">
              {busy ? t('Saving…') : t('Save contact')}
              <ArrowRight />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}

function OdooImport({
  request,
  onClose,
  onDone,
}: {
  request: APIRequest
  onClose: () => void
  onDone: (result: {
    created: number
    skipped: number
    normalizedWebsites: number
  }) => Promise<void>
}) {
  const [document, setDocument] = useState<OdooContactImport | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function read(file: File | undefined) {
    setDocument(null)
    setReviewed(false)
    setError('')
    if (!file) return
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error('Choose a contact import JSON file of at most 2 MiB.')
      const data: unknown = JSON.parse(await file.text())
      if (
        !data ||
        typeof data !== 'object' ||
        !('source' in data) ||
        typeof data.source !== 'string' ||
        !('database' in data) ||
        typeof data.database !== 'string' ||
        !('contacts' in data) ||
        !Array.isArray(data.contacts) ||
        !data.contacts.length ||
        data.contacts.length > 1000
      )
        throw new Error(
          'Expected source, database, and 1–1000 normalized Odoo contacts. See the import format in the README.',
        )
      setDocument({ source: data.source, database: data.database, contacts: data.contacts })
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!document) return
    setBusy(true)
    setError('')
    try {
      await onDone(
        await request<{ created: number; skipped: number; normalizedWebsites: number }>(
          'contacts/import',
          {
            ...document,
            reviewed,
          },
        ),
      )
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={t('Copy contacts from Odoo')}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form {...localizedValidation} onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className="dialog-body">
            <p className="dialog-intro">
              {t(
                'Import a normalized Odoo JSON export. Source IDs preserve companies, people and address relationships. No Odoo credentials are stored and nothing is written back. Existing source IDs are skipped, preserving local edits.',
              )}
            </p>
            <label>
              {t('Odoo contact JSON')}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => void read(event.target.files?.[0])}
              />
            </label>
            {document && (
              <div className="contact-import-summary">
                <strong>{t('{count} contacts', { count: document.contacts.length })}</strong>
                <p>
                  {t('Source')}: {document.source}
                </p>
                <p>
                  {t('Database identity')}: {document.database}
                </p>
              </div>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                required
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>
                {t('I am authorized to copy these contacts into this company workspace.')}
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {messageText(error)}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button className="button primary" disabled={!document || !reviewed}>
              {busy ? t('Importing…') : t('Import contacts')}
              <ArrowRight />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
