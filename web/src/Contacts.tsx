import { useState, type FormEvent } from 'react'
import { ArrowRight, Building, Download, Plus, RefreshDouble, Search } from 'iconoir-react'
import { Modal } from './Modal'
import type { APIRequest, Contact, ContactData, OdooContactImport } from './types'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Contact operation failed.'
const blank = (): ContactData => ({
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
}: {
  items: Contact[]
  request: APIRequest
  onChange: (item: Contact) => void
  onRefresh: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('Active')
  const [selected, setSelected] = useState<Contact | null>(null)
  const [editor, setEditor] = useState<Contact | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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
        <button onClick={onRefresh}>Workspace data</button>
        <span>/</span>
        <span>Contacts</span>
      </div>
      <div className="page-heading contacts-heading">
        <div>
          <div className="eyebrow">YOUR BUSINESS RELATIONSHIPS</div>
          <h1>Contacts</h1>
          <p>Companies, people and the details that keep you connected.</p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            aria-label="Refresh contacts"
            onClick={() => void onRefresh()}
          >
            <RefreshDouble />
          </button>
          <button className="button secondary" onClick={() => setImporting(true)}>
            Import Odoo JSON
          </button>
          <button className="button secondary" disabled={!items.length} onClick={exportContacts}>
            <Download />
            Export JSON
          </button>
          <button
            className="button primary"
            onClick={() => {
              setError('')
              setEditor('new')
            }}
          >
            <Plus />
            New contact
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <div className="contacts-toolbar panel">
        <div className="filter-tabs" role="group" aria-label="Contact filters">
          {['Active', 'Companies', 'People', 'Customers', 'Vendors', 'Archived'].map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={filter === value ? 'active' : ''}
            >
              {value}
            </button>
          ))}
        </div>
        <label className="contact-search">
          <Search />
          <input
            aria-label="Search contacts"
            placeholder="Search name, email, VAT or address…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <p className="contact-count">
        {visible.length} {filter.toLowerCase()} contacts · {items.length} total records
      </p>
      <div className="contact-grid">
        {visible.map((item) => (
          <button
            className={`contact-card ${!item.active ? 'archived' : ''}`}
            aria-label={`Open contact ${item.name}`}
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
                {item.isCompany ? 'Company' : 'Person'}
                {item.companyName ? ` · ${item.companyName}` : ''}
              </span>
              {item.email && <span>{item.email}</span>}
              {item.phone && <span>{item.phone}</span>}
              {[item.address.city, item.address.country].filter(Boolean).length > 0 && (
                <span>{[item.address.city, item.address.country].filter(Boolean).join(', ')}</span>
              )}
              <span className="contact-tags">
                {item.customer && <em>Customer</em>}
                {item.vendor && <em>Vendor</em>}
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
          <h3>{items.length ? 'No matching contacts.' : 'Your contacts start here.'}</h3>
          <p>
            Create a contact or import your Odoo records. No sample contacts are added
            automatically.
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
                <h3>{selected.isCompany ? 'Company' : 'Person'}</h3>
                <p>{selected.companyName}</p>
              </div>
              <span className="badge">{selected.active ? 'Active' : 'Archived'}</span>
            </div>
            <dl className="contact-details">
              <dt>Email</dt>
              <dd>
                {selected.email ? (
                  <a href={`mailto:${selected.email}`}>{selected.email}</a>
                ) : (
                  'Not set'
                )}
              </dd>
              <dt>Phone</dt>
              <dd>
                {selected.phone || 'Not set'}
                {selected.mobile && (
                  <>
                    <br />
                    Mobile: {selected.mobile}
                  </>
                )}
              </dd>
              <dt>Website</dt>
              <dd>
                {selected.website ? (
                  <a href={selected.website} target="_blank" rel="noreferrer">
                    {selected.website}
                  </a>
                ) : (
                  'Not set'
                )}
              </dd>
              <dt>Address</dt>
              <dd className="postal-address">{addressText(selected) || 'Not set'}</dd>
              <dt>Address type</dt>
              <dd>{selected.type}</dd>
              <dt>VAT / tax ID</dt>
              <dd>{selected.vat || 'Not set'}</dd>
              <dt>Reference</dt>
              <dd>{selected.reference || 'Not set'}</dd>
              <dt>Relationships</dt>
              <dd>
                {[selected.customer && 'Customer', selected.vendor && 'Vendor']
                  .filter(Boolean)
                  .join(', ') || 'Contact'}
              </dd>
              <dt>Tags</dt>
              <dd>{selected.tags.join(', ') || 'None'}</dd>
              {selected.odoo && (
                <>
                  {selected.odoo.originalWebsite &&
                    selected.odoo.originalWebsite !== selected.website && (
                      <>
                        <dt>Original Odoo website</dt>
                        <dd>
                          {selected.odoo.originalWebsite}
                          <br />
                          <small>
                            Source text retained; the current website was normalized or edited.
                          </small>
                        </dd>
                      </>
                    )}
                  <dt>Odoo source</dt>
                  <dd>
                    Record #{selected.odoo.id} · {selected.odoo.origin}
                    <br />
                    Copied {new Date(selected.odoo.importedAt).toLocaleDateString()}
                    {selected.odoo.parentId > 0 && (
                      <>
                        <br />
                        Parent:{' '}
                        {parent ? (
                          <button className="text-button" onClick={() => setSelected(parent)}>
                            {parent.name}
                          </button>
                        ) : (
                          `Odoo #${selected.odoo.parentId} (not in this workspace)`
                        )}
                      </>
                    )}
                  </dd>
                </>
              )}
            </dl>
            <p className="dialog-intro">
              Changes here stay in Odee. Existing invoice and bill snapshots are not modified.
            </p>
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setSelected(null)}>
              Close
            </button>
            <button
              className="button primary"
              onClick={() => {
                setEditor(selected)
                setSelected(null)
              }}
            >
              Edit contact
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
            setNotice(
              `Odoo import finished: ${result.created} created, ${result.skipped} already present. Existing contacts were not overwritten.${result.normalizedWebsites ? ` ${result.normalizedWebsites} website links normalized; source text retained.` : ''}`,
            )
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
      ? blank()
      : {
          name: initial.name,
          isCompany: initial.isCompany,
          companyName: initial.companyName,
          email: initial.email,
          phone: initial.phone,
          mobile: initial.mobile,
          website: initial.website,
          vat: initial.vat,
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
      title={initial === 'new' ? 'New contact' : 'Edit contact'}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className="dialog-body">
            <div className="form-grid">
              <label>
                Name
                <input
                  required
                  autoFocus
                  maxLength={200}
                  value={data.name}
                  onChange={(event) => field('name', event.target.value)}
                />
              </label>
              <label>
                Contact kind
                <select
                  value={data.isCompany ? 'company' : 'person'}
                  onChange={(event) => field('isCompany', event.target.value === 'company')}
                >
                  <option value="company">Company</option>
                  <option value="person">Person</option>
                </select>
              </label>
              <label>
                Company / affiliation
                <input
                  maxLength={200}
                  value={data.companyName}
                  onChange={(event) => field('companyName', event.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  maxLength={320}
                  value={data.email}
                  onChange={(event) => field('email', event.target.value)}
                />
              </label>
              <label>
                Phone
                <input
                  maxLength={80}
                  value={data.phone}
                  onChange={(event) => field('phone', event.target.value)}
                />
              </label>
              <label>
                Mobile
                <input
                  maxLength={80}
                  value={data.mobile}
                  onChange={(event) => field('mobile', event.target.value)}
                />
              </label>
              <label>
                Website
                <input
                  maxLength={500}
                  value={data.website}
                  onChange={(event) => field('website', event.target.value)}
                  placeholder="https://example.com"
                />
              </label>
              <label>
                VAT / tax ID
                <input
                  maxLength={80}
                  value={data.vat}
                  onChange={(event) => field('vat', event.target.value)}
                />
              </label>
              <label>
                Reference
                <input
                  maxLength={100}
                  value={data.reference}
                  onChange={(event) => field('reference', event.target.value)}
                />
              </label>
              <label>
                Address type
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
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              {(['street', 'street2', 'postalCode', 'city', 'state', 'country'] as const).map(
                (key) => (
                  <label key={key}>
                    {
                      {
                        street: 'Street',
                        street2: 'Street 2',
                        postalCode: 'Postal code',
                        city: 'City',
                        state: 'State / province',
                        country: 'Country',
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
                Tags (comma separated)
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
                        customer: 'Customer',
                        vendor: 'Vendor',
                        active: 'Active (uncheck to archive)',
                      }[key]
                    }
                  </span>
                </label>
              ))}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary">
              {busy ? 'Saving…' : 'Save contact'}
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
      title="Copy contacts from Odoo"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className="dialog-body">
            <p className="dialog-intro">
              Import a normalized Odoo JSON export. Source IDs preserve companies, people and
              address relationships. No Odoo credentials are stored and nothing is written back.
              Existing source IDs are skipped, preserving local edits.
            </p>
            <label>
              Odoo contact JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => void read(event.target.files?.[0])}
              />
            </label>
            {document && (
              <div className="contact-import-summary">
                <strong>{document.contacts.length} contacts</strong>
                <p>Source: {document.source}</p>
                <p>Database identity: {document.database}</p>
              </div>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                required
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>I am authorized to copy these contacts into this company workspace.</span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary" disabled={!document || !reviewed}>
              {busy ? 'Importing…' : 'Import contacts'}
              <ArrowRight />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
