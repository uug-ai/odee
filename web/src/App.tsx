import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  ViewGrid as Apps,
  ArrowLeft,
  ArrowRight,
  Book,
  Building,
  Check,
  CheckCircle,
  Clock,
  CreditCard,
  Download,
  GraphUp,
  Plus,
  RefreshDouble,
  Search,
  ShieldCheck,
  Wallet,
  Xmark,
} from 'iconoir-react'
import {
  balances,
  cents,
  csvCell,
  decimal,
  dueInDays,
  journals,
  label,
  lineTotals,
  money,
  overdue,
  today,
} from './accounting'
import type {
  BillImport,
  Contact,
  Document,
  Draft,
  Kind,
  Line,
  ReviewOptions,
  Session,
  State,
  View,
} from './types'
import { BillImports, OriginalPreview } from './BillImports'
import { Modal } from './Modal'
import { AppLauncher } from './AppLauncher'
import { createAPIRequest } from './api'
import { defaultView, moduleForView, navigation, views } from './modules'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'An unexpected error occurred.'

function Badge({ doc }: { doc: Document }) {
  return <span className={`badge ${label(doc).toLowerCase()}`}>{label(doc)}</span>
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Book />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const csrf = useRef('')
  const generation = useRef(0)
  const [view, setView] = useState<View>('apps')
  const [selected, setSelected] = useState<string | null>(null)
  const [editor, setEditor] = useState<Kind | Document | null>(null)
  const [review, setReview] = useState<BillImport | null>(null)
  const [original, setOriginal] = useState<BillImport | null>(null)
  const [payment, setPayment] = useState<Document | null>(null)
  const [posting, setPosting] = useState<Document | null>(null)
  const [token, setToken] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [needsToken, setNeedsToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')

  const clearWorkspace = useCallback(() => {
    setState(null)
    setSelected(null)
    setEditor(null)
    setReview(null)
    setOriginal(null)
    setPayment(null)
    setPosting(null)
    setNotice('')
    setView('apps')
  }, [])

  const expireSession = useCallback(() => {
    generation.current++
    csrf.current = ''
    clearWorkspace()
    setLoading(false)
    setNeedsToken(true)
    setSession((current) =>
      current ? { ...current, authenticated: false, user: undefined, csrfToken: undefined } : null,
    )
  }, [clearWorkspace])

  const request = useMemo(
    () =>
      createAPIRequest({
        token,
        csrfToken: () => csrf.current,
        generation: () => generation.current,
        onUnauthorized: expireSession,
        onUnauthorizedError: setError,
      }),
    [token, expireSession],
  )

  const refresh = useCallback(async () => {
    const requestID = ++generation.current
    setLoading(true)
    setError('')
    try {
      const current = await request<Session>('session')
      if (requestID !== generation.current) return
      setSession(current)
      csrf.current = current.csrfToken ?? ''
      if (current.authMode === 'github' && !current.authenticated) {
        clearWorkspace()
        setNeedsToken(false)
        return
      }
      const loaded = await request<State>('state')
      if (requestID !== generation.current) return
      setState(loaded)
      setNeedsToken(false)
    } catch (error) {
      if (requestID === generation.current) setError(errorMessage(error))
    } finally {
      if (requestID === generation.current) setLoading(false)
    }
  }, [request, clearWorkspace])
  useEffect(() => {
    void refresh()
    return () => {
      generation.current++
    }
  }, [refresh])

  async function logout() {
    generation.current++
    setBusy(true)
    setError('')
    try {
      await request<void>('logout', {})
      expireSession()
      setNeedsToken(false)
    } catch (error) {
      setError(`Sign-out was not confirmed. ${errorMessage(error)}`)
    } finally {
      setBusy(false)
      setLoading(false)
    }
  }

  function navigate(next: View) {
    setView(next)
    setSelected(null)
    setQuery('')
    setFilter('All')
    setNotice('')
  }
  async function mutate(action: () => Promise<Document>, message: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const doc = await action()
      setState(
        (current) =>
          current && {
            ...current,
            documents: [...current.documents.filter((d) => d.id !== doc.id), doc],
          },
      )
      setSelected(doc.id)
      setEditor(null)
      setReview(null)
      setPayment(null)
      setPosting(null)
      setNotice(message)
      return true
    } catch (error) {
      setError(errorMessage(error))
      return false
    } finally {
      setBusy(false)
    }
  }
  const doc = state?.documents.find((d) => d.id === selected)
  const rememberImport = (item: BillImport) =>
    setState(
      (current) =>
        current && {
          ...current,
          imports: [...(current.imports ?? []).filter((existing) => existing.id !== item.id), item],
        },
    )
  const documents = state?.documents ?? []
  const posted = documents.filter((d) => d.status !== 'draft')
  const invoices = documents.filter((d) => d.kind === 'invoice')
  const bills = documents.filter((d) => d.kind === 'bill')
  const sumOpen = (docs: Document[]) =>
    docs.filter((d) => d.status === 'posted').reduce((sum, d) => sum + BigInt(d.total - d.paid), 0n)
  const ledger = balances(documents)
  const accountBalance = (code: string) => {
    const value = ledger.get(code)
    return value ? value.debit - value.credit : 0n
  }
  const filtered = documents
    .filter((d) => d.kind === (view === 'bills' ? 'bill' : 'invoice'))
    .filter((d) =>
      `${d.partner} ${d.number} ${d.reference}`.toLowerCase().includes(query.toLowerCase()),
    )
    .filter((d) => filter === 'All' || label(d) === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const currentModule = moduleForView(view)
  const ModuleIcon = currentModule?.icon
  const RegisteredView = view === 'apps' ? undefined : views[view].component

  function downloadReport() {
    if (!state) return
    const rows = [
      ['Code', 'Account', 'Debit EUR', 'Credit EUR'],
      ...state.accounts.map((account) => {
        const value = ledger.get(account.code)
        return [
          account.code,
          account.name,
          ((value?.debit ?? 0n) / 100n).toString() +
            '.' +
            String((value?.debit ?? 0n) % 100n).padStart(2, '0'),
          ((value?.credit ?? 0n) / 100n).toString() +
            '.' +
            String((value?.credit ?? 0n) % 100n).padStart(2, '0'),
        ]
      }),
    ]
    const url = URL.createObjectURL(
      new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `odee-trial-balance-${today()}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-left">
          <button className="brand" onClick={() => navigate('apps')} aria-label="Odee app launcher">
            odee<span>.</span>
          </button>
          <span className="brand-divider" />
          <button
            className="app-switch"
            onClick={() => navigate(view === 'apps' ? defaultView : 'apps')}
          >
            <Apps />
            {currentModule?.name ?? 'Workspace'}
          </button>
        </div>
        <div className="topbar-right">
          <span className="open-source">
            <span />
            Open source
          </span>
          <span className="company">
            <Building />
            {state?.company ?? 'Odee'}
          </span>
          <span
            className="avatar"
            aria-label={session?.user ? `Signed in as ${session.user.login}` : 'Company workspace'}
          >
            {session?.user?.login.slice(0, 1).toUpperCase() ?? 'O'}
          </span>
          {session?.authMode === 'github' && session.authenticated && (
            <button className="button secondary" onClick={() => void logout()} disabled={busy}>
              Sign out
            </button>
          )}
        </div>
      </header>
      {state && (state.demo || state.development) && (
        <div className="dev-banner">
          <ShieldCheck />
          {state.demo
            ? 'Demo workspace · temporary storage · data is lost on restart'
            : 'Local development · MongoDB connected · authentication disabled'}
        </div>
      )}
      <div className={`layout ${view === 'apps' ? 'launcher-layout' : ''}`}>
        {view !== 'apps' && (
          <aside className="sidebar">
            <div className="sidebar-app">
              <div className="app-icon small">{ModuleIcon && <ModuleIcon />}</div>
              <div>
                <strong>{currentModule?.name}</strong>
                <span>{currentModule?.workspaceDescription}</span>
              </div>
            </div>
            <nav aria-label={currentModule?.navigationLabel}>
              {navigation.map((item) => {
                const Container = item.standalone ? Fragment : 'div'
                return (
                  <Container key={item.view}>
                    {item.group && <div className="nav-group">{item.group}</div>}
                    <button
                      className={view === item.view ? 'nav-item active' : 'nav-item'}
                      aria-current={!item.standalone && view === item.view ? 'page' : undefined}
                      onClick={() => navigate(item.view)}
                    >
                      <item.icon />
                      {item.label}
                      {item.view === 'invoices' && (
                        <span className="nav-count">{invoices.length}</span>
                      )}
                    </button>
                  </Container>
                )
              })}
            </nav>
            <div className="sidebar-footer">
              <div className="status-dot" />
              <span>
                {state?.demo
                  ? 'Temporary demo store'
                  : state
                    ? 'MongoDB workspace'
                    : 'Not connected'}
              </span>
              <small>EUR · Single company</small>
            </div>
          </aside>
        )}
        <main id="main" className="main">
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError('')}
                aria-label="Dismiss error"
              >
                <Xmark />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <CheckCircle />
              {notice}
            </div>
          )}
          {session?.authMode === 'github' && !session.authenticated ? (
            <div className="login panel">
              <ShieldCheck />
              <h1>Your workspace, protected.</h1>
              <p>
                Sign in with GitHub. Access is limited to active members of{' '}
                <strong>
                  {session.organisation}/{session.team}
                </strong>
                .
              </p>
              <a className="button primary" href="/auth/github">
                Sign in with GitHub <ArrowRight />
              </a>
            </div>
          ) : needsToken ? (
            <div className="login panel">
              <ShieldCheck />
              <h1>Your books, protected.</h1>
              <p>
                Enter the company access token provided by your administrator. It stays in memory
                for this tab only.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (tokenInput === token) void refresh()
                  else setToken(tokenInput)
                }}
              >
                <label>
                  Company access token
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(event) => setTokenInput(event.target.value)}
                    autoComplete="off"
                    required
                  />
                </label>
                <button className="button primary" disabled={loading}>
                  Open workspace <ArrowRight />
                </button>
              </form>
            </div>
          ) : !state ? (
            <div className="empty">
              <h1>{loading ? 'Opening your workspace…' : 'Unable to open workspace'}</h1>
              <p>
                {loading
                  ? 'Connecting to Accounting.'
                  : 'Check the server and MongoDB connection, then retry.'}
              </p>
              {!loading && (
                <button className="button secondary" onClick={() => void refresh()}>
                  <RefreshDouble />
                  Retry
                </button>
              )}
            </div>
          ) : view === 'apps' ? (
            <AppLauncher onNavigate={navigate} />
          ) : RegisteredView ? (
            <RegisteredView
              state={state}
              request={request}
              onRefresh={refresh}
              onStateChange={setState}
            />
          ) : (
            <>
              <div className="breadcrumb">
                <button onClick={() => navigate('apps')}>Workspace</button>
                <span>/</span>
                <span>Accounting</span>
                <span>/</span>
                <span>{doc ? doc.partner : views[view].title}</span>
              </div>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {doc
                      ? doc.kind === 'invoice'
                        ? 'CUSTOMER INVOICE'
                        : 'VENDOR BILL'
                      : 'ACCOUNTING'}
                  </div>
                  <h1>{doc ? doc.partner : views[view].title}</h1>
                  <p>
                    {doc
                      ? doc.number
                      : view === 'dashboard'
                        ? 'A clear view of your money. A good place to start.'
                        : view === 'reports'
                          ? 'All posted activity · EUR · since workspace creation'
                          : view === 'accounts'
                            ? 'Your starter chart. A foundation for balanced books.'
                            : 'Keep the details in order. Let the numbers add up.'}
                  </p>
                </div>
                <div className="heading-actions">
                  <button
                    className="icon-button"
                    title="Refresh workspace"
                    aria-label="Refresh workspace"
                    disabled={loading || busy}
                    onClick={() => void refresh()}
                  >
                    <RefreshDouble className={loading ? 'spin' : ''} />
                  </button>
                  {doc ? (
                    <button className="button secondary" onClick={() => setSelected(null)}>
                      <ArrowLeft />
                      Back
                    </button>
                  ) : view === 'reports' ? (
                    <button className="button secondary" onClick={downloadReport}>
                      <Download />
                      Export CSV
                    </button>
                  ) : (
                    (view === 'dashboard' || view === 'invoices' || view === 'bills') && (
                      <button
                        className="button primary"
                        onClick={() => setEditor(view === 'bills' ? 'bill' : 'invoice')}
                      >
                        <Plus />
                        {view === 'bills' ? 'New bill' : 'New invoice'}
                      </button>
                    )
                  )}
                </div>
              </div>
              {doc ? (
                <DocumentDetail
                  doc={doc}
                  busy={busy}
                  onEdit={() => setEditor(doc)}
                  onPost={() => setPosting(doc)}
                  onPay={() => setPayment(doc)}
                  onOriginal={
                    doc.sourceId
                      ? () => {
                          void request<BillImport>(`imports/${doc.sourceId}`)
                            .then(setOriginal)
                            .catch((error) => setError(errorMessage(error)))
                        }
                      : undefined
                  }
                />
              ) : view === 'dashboard' ? (
                <>
                  <div className="overview-strip">
                    <span>
                      <span className="status-dot" />
                      YOUR BOOKS AT A GLANCE
                    </span>
                    <span>
                      {new Date().toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="dashboard-grid">
                    <JournalCard
                      title="Customer invoices"
                      icon={<CreditCard />}
                      amount={sumOpen(invoices)}
                      caption="Outstanding receivables"
                      count={invoices.filter((d) => d.status === 'posted').length}
                      countLabel="awaiting payment"
                      extra={`${invoices.filter(overdue).length} overdue`}
                      onOpen={() => navigate('invoices')}
                      onNew={() => setEditor('invoice')}
                    />
                    <JournalCard
                      title="Vendor bills"
                      icon={<Wallet />}
                      amount={sumOpen(bills)}
                      caption="Outstanding payables"
                      count={bills.filter((d) => d.status === 'posted').length}
                      countLabel="to pay"
                      extra={`${bills.filter((d) => d.status === 'draft').length} drafts to review`}
                      onOpen={() => navigate('bills')}
                      onNew={() => setEditor('bill')}
                    />
                    <div className="panel journal-card">
                      <div className="card-top">
                        <span className="card-icon mint">
                          <Building />
                        </span>
                        <span className="badge">Manual ledger</span>
                      </div>
                      <h2>Bank account</h2>
                      <div className="metric">{money(accountBalance('1000'))}</div>
                      <p className="metric-caption">Recorded payment movements</p>
                      <div className="card-facts">
                        <span>Bank feed</span>
                        <span>Not connected</span>
                      </div>
                      <button className="card-action" onClick={() => navigate('journal')}>
                        View payment entries <ArrowRight />
                      </button>
                    </div>
                    <div className="panel journal-card">
                      <div className="card-top">
                        <span className="card-icon peach">
                          <GraphUp />
                        </span>
                        <span className="badge">Indicative only</span>
                      </div>
                      <h2>VAT position</h2>
                      <div className="metric">
                        {money(-accountBalance('2100') - accountBalance('1200'))}
                      </div>
                      <p className="metric-caption">Output VAT less recoverable VAT</p>
                      <div className="card-facts">
                        <span>Tax filing</span>
                        <span>Not configured</span>
                      </div>
                      <button className="card-action" onClick={() => navigate('reports')}>
                        View trial balance <ArrowRight />
                      </button>
                    </div>
                  </div>
                  <div className="dashboard-lower">
                    <section className="panel activity">
                      <div className="section-heading">
                        <div>
                          <h2>Recent documents</h2>
                          <p>A little order goes a long way.</p>
                        </div>
                        <button className="text-button" onClick={() => navigate('invoices')}>
                          View invoices <ArrowRight />
                        </button>
                      </div>
                      {documents.length === 0 ? (
                        <Empty title="Your books start with a first entry.">
                          Create an invoice or vendor bill. Save it as a draft, review it, then post
                          it to the ledger.
                        </Empty>
                      ) : (
                        <div className="recent-list">
                          {[...documents]
                            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                            .slice(0, 5)
                            .map((d) => (
                              <button
                                key={d.id}
                                className="recent-row"
                                onClick={() => {
                                  setView(d.kind === 'bill' ? 'bills' : 'invoices')
                                  setSelected(d.id)
                                }}
                              >
                                <span className={`document-icon ${d.kind}`}>
                                  <Book />
                                </span>
                                <span className="recent-partner">
                                  <strong>{d.partner}</strong>
                                  <small>
                                    {d.kind === 'invoice' ? 'Invoice' : 'Bill'} · {d.date}
                                  </small>
                                </span>
                                <Badge doc={d} />
                                <strong>{money(d.total)}</strong>
                                <ArrowRight />
                              </button>
                            ))}
                        </div>
                      )}
                    </section>
                    <section className="panel getting-started">
                      <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                      <h2>
                        Good books.
                        <br />
                        Better decisions.
                      </h2>
                      <p>
                        Start simple. Every posted document creates a balanced journal, and every
                        payment keeps a trace.
                      </p>
                      <div className="setup-item">
                        <CheckCircle />
                        <span>Starter chart of accounts</span>
                        <Check />
                      </div>
                      <div className={`setup-item ${documents.length ? '' : 'pending'}`}>
                        <Book />
                        <span>Create your first document</span>
                        {documents.length ? <Check /> : <span>01</span>}
                      </div>
                      <div className={`setup-item ${posted.length ? '' : 'pending'}`}>
                        <ShieldCheck />
                        <span>Post a balanced entry</span>
                        {posted.length ? <Check /> : <span>02</span>}
                      </div>
                      <button className="text-button" onClick={() => navigate('accounts')}>
                        Explore your accounts <ArrowRight />
                      </button>
                    </section>
                  </div>
                  <div className="info-note">
                    <ShieldCheck />
                    <p>
                      This first release is a bookkeeping foundation. Bank feeds, statutory tax
                      filing, reconciliation, and country-specific compliance are not yet
                      implemented.
                    </p>
                  </div>
                </>
              ) : view === 'invoices' || view === 'bills' ? (
                <>
                  {view === 'bills' && (
                    <BillImports
                      items={state.imports ?? []}
                      scannerReady={state.scannerReady}
                      scannerError={state.scannerError}
                      request={request}
                      onImport={rememberImport}
                      onReview={setReview}
                      onOpen={setSelected}
                    />
                  )}
                  <section className="panel document-table">
                    <div className="table-toolbar">
                      <div className="tabs" role="group" aria-label="Document status filter">
                        {['All', 'Draft', 'Posted', 'Partial', 'Paid', 'Overdue'].map((option) => (
                          <button
                            key={option}
                            className={filter === option ? 'active' : ''}
                            onClick={() => setFilter(option)}
                            aria-pressed={filter === option}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                      <label className="search">
                        <Search />
                        <input
                          aria-label="Search documents"
                          placeholder="Search name or reference…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{view === 'bills' ? 'Vendor' : 'Customer'}</th>
                            <th>Reference</th>
                            <th>Date</th>
                            <th>Due date</th>
                            <th>Status</th>
                            <th className="numeric">Total</th>
                            <th className="numeric">Due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((d) => (
                            <tr key={d.id}>
                              <td>
                                <button className="table-link" onClick={() => setSelected(d.id)}>
                                  {d.partner}
                                </button>
                                <small>{d.email}</small>
                              </td>
                              <td className="reference" title={d.number}>
                                {d.reference || d.number}
                              </td>
                              <td>{d.date}</td>
                              <td className={overdue(d) ? 'late-text' : ''}>{d.dueDate}</td>
                              <td>
                                <Badge doc={d} />
                              </td>
                              <td className="numeric">{money(d.total)}</td>
                              <td className="numeric">
                                {d.status === 'draft' ? '—' : money(d.total - d.paid)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!filtered.length && (
                      <Empty
                        title={
                          documents.length
                            ? 'No matching documents.'
                            : `No ${view === 'bills' ? 'bills' : 'invoices'} yet.`
                        }
                      >
                        Use New {view === 'bills' ? 'bill' : 'invoice'} to get started, or adjust
                        your search and filters.
                      </Empty>
                    )}
                    <div className="table-footer">
                      {filtered.length} documents <span>EUR · Drafts do not affect the ledger</span>
                    </div>
                  </section>
                </>
              ) : view === 'journal' ? (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>General journal</h2>
                      <p>
                        Posted documents and their payment entries. Debits always equal credits.
                      </p>
                    </div>
                    <span className="badge posted">{journals(documents).length} entries</span>
                  </div>
                  {journals(documents).length === 0 ? (
                    <Empty title="A balanced beginning.">
                      Post your first invoice or bill to see its journal entries here.
                    </Empty>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Document / entry</th>
                            <th>Account</th>
                            <th className="numeric">Debit</th>
                            <th className="numeric">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journals(documents).flatMap((journal) =>
                            journal.entries.map((entry, index) => (
                              <tr key={`${journal.key}/${index}`}>
                                <td>{index === 0 ? journal.date : ''}</td>
                                <td>
                                  {index === 0 && (
                                    <button
                                      className="table-link"
                                      onClick={() => setSelected(journal.document.id)}
                                    >
                                      {journal.document.partner}
                                      <small>
                                        {journal.payment ? 'Payment' : journal.document.kind} ·{' '}
                                        {journal.reference}
                                      </small>
                                    </button>
                                  )}
                                </td>
                                <td>
                                  <span className="account-code">{entry.accountCode}</span>
                                  {state.accounts.find((a) => a.code === entry.accountCode)?.name}
                                </td>
                                <td className="numeric">
                                  {entry.debit ? money(entry.debit) : '—'}
                                </td>
                                <td className="numeric">
                                  {entry.credit ? money(entry.credit) : '—'}
                                </td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ) : (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>{view === 'reports' ? 'Trial balance' : 'Starter accounts'}</h2>
                      <p>
                        {view === 'reports'
                          ? 'Cumulative posted debits and credits. No opening balances have been imported.'
                          : 'A minimal, fixed chart for this release. Country-specific charts will follow.'}
                      </p>
                    </div>
                    <span className="badge posted">
                      <CheckCircle />
                      {view === 'reports' ? 'Double-entry' : '8 accounts'}
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Account</th>
                          <th>Type</th>
                          <th className="numeric">Debit</th>
                          <th className="numeric">Credit</th>
                          <th className="numeric">Net balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.accounts.map((account) => {
                          const value = ledger.get(account.code) ?? { debit: 0n, credit: 0n }
                          return (
                            <tr key={account.code}>
                              <td className="account-code">{account.code}</td>
                              <td>
                                <strong>{account.name}</strong>
                              </td>
                              <td>
                                <span className="badge account-type">{account.type}</span>
                              </td>
                              <td className="numeric">{money(value.debit)}</td>
                              <td className="numeric">{money(value.credit)}</td>
                              <td className="numeric">{money(value.debit - value.credit)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3}>Total · EUR</td>
                          <td className="numeric">
                            {money([...ledger.values()].reduce((sum, b) => sum + b.debit, 0n))}
                          </td>
                          <td className="numeric">
                            {money([...ledger.values()].reduce((sum, b) => sum + b.credit, 0n))}
                          </td>
                          <td className="numeric">
                            {money(
                              [...ledger.values()].reduce((sum, b) => sum + b.debit - b.credit, 0n),
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              )}
              <footer className="workspace-footer">
                <span>odee. / Open accounting</span>
                <span>Built for clarity. Yours to shape.</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {editor && (
        <DraftEditor
          onSessionExpired={expireSession}
          contacts={state?.contacts ?? []}
          initial={editor}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) {
              setEditor(null)
              setError('')
            }
          }}
          onSave={(input) =>
            mutate(
              () =>
                typeof editor === 'string'
                  ? request<Document>('documents', input)
                  : request<Document>(
                      `documents/${editor.id}`,
                      { ...input, version: editor.version },
                      'PUT',
                    ),
              'Draft saved. Review the details before posting.',
            )
          }
        />
      )}
      {review && (
        <DraftEditor
          onSessionExpired={expireSession}
          contacts={state?.contacts ?? []}
          initial={review.scan.draft}
          review={review}
          token={token}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) {
              setReview(null)
              setError('')
            }
          }}
          onSave={(input, options) =>
            mutate(async () => {
              const doc = await request<Document>(`imports/${review.id}/draft`, {
                ...input,
                reviewed: options?.reviewed ?? false,
                acceptMismatch: options?.acceptMismatch ?? false,
              })
              rememberImport({ ...review, documentId: doc.id, status: 'draft' })
              return doc
            }, 'Reviewed bill saved as a draft. The original remains attached; nothing has been posted.')
          }
        />
      )}
      {original && (
        <Modal title="Original bill document" wide onClose={() => setOriginal(null)}>
          <div className="dialog-body">
            <OriginalPreview item={original} token={token} onSessionExpired={expireSession} />
          </div>
        </Modal>
      )}
      {posting && (
        <Modal
          title="Post to the ledger?"
          onClose={() => {
            if (!busy) setPosting(null)
          }}
        >
          <div className="dialog-body">
            <p>
              Post <strong>{posting.partner}</strong> for <strong>{money(posting.total)}</strong>?
              This creates balanced journal entries. Posted documents cannot be edited in this
              release.
            </p>
            <div className="info-note">
              <ShieldCheck />
              Review the date, amounts, partner, and VAT before confirming.
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button className="button secondary" disabled={busy} onClick={() => setPosting(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void mutate(
                  () =>
                    request<Document>(`documents/${posting.id}/post`, { version: posting.version }),
                  'Document posted. Your journal is balanced.',
                )
              }
            >
              <Check />
              {busy ? 'Posting…' : 'Confirm posting'}
            </button>
          </div>
        </Modal>
      )}
      {payment && (
        <PaymentEditor
          doc={payment}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) {
              setPayment(null)
              setError('')
            }
          }}
          onSave={(input) =>
            mutate(
              () =>
                request<Document>(`documents/${payment.id}/payments`, {
                  ...input,
                  version: payment.version,
                }),
              'Payment recorded in the ledger.',
            )
          }
        />
      )}
    </>
  )
}

function JournalCard({
  title,
  icon,
  amount,
  caption,
  count,
  countLabel,
  extra,
  onOpen,
  onNew,
}: {
  title: string
  icon: ReactNode
  amount: bigint
  caption: string
  count: number
  countLabel: string
  extra: string
  onOpen: () => void
  onNew: () => void
}) {
  return (
    <div className="panel journal-card">
      <div className="card-top">
        <span className="card-icon">{icon}</span>
        <button
          className="icon-button"
          aria-label={`Create ${title === 'Vendor bills' ? 'bill' : 'invoice'}`}
          onClick={onNew}
        >
          <Plus />
        </button>
      </div>
      <h2>
        <button onClick={onOpen}>{title}</button>
      </h2>
      <div className="metric">{money(amount)}</div>
      <p className="metric-caption">{caption}</p>
      <div className="card-facts">
        <span>
          <strong>{count}</strong> {countLabel}
        </span>
        <span>{extra}</span>
      </div>
      <button className="card-action" onClick={onOpen}>
        View {title === 'Vendor bills' ? 'bills' : 'invoices'} <ArrowRight />
      </button>
    </div>
  )
}

function DocumentDetail({
  doc,
  busy,
  onEdit,
  onPost,
  onPay,
  onOriginal,
}: {
  doc: Document
  busy: boolean
  onEdit: () => void
  onPost: () => void
  onPay: () => void
  onOriginal?: () => void
}) {
  return (
    <div className="detail">
      <section className="panel">
        <div className="section-heading">
          <div className="detail-status">
            <Badge doc={doc} />
            <span>EUR · Version {doc.version}</span>
          </div>
          <div className="heading-actions">
            {onOriginal && (
              <button type="button" className="button secondary" onClick={onOriginal}>
                <Book />
                View original
              </button>
            )}
            {doc.status === 'draft' ? (
              <>
                <button className="button secondary" disabled={busy} onClick={onEdit}>
                  Edit draft
                </button>
                <button className="button primary" disabled={busy} onClick={onPost}>
                  <Check />
                  Post document
                </button>
              </>
            ) : doc.status === 'posted' ? (
              <button className="button primary" disabled={busy} onClick={onPay}>
                <Wallet />
                Record payment
              </button>
            ) : (
              <span className="paid-note">
                <CheckCircle />
                Fully paid
              </span>
            )}
          </div>
        </div>
        <div className="detail-meta">
          <div>
            <span>{doc.kind === 'bill' ? 'VENDOR' : 'CUSTOMER'}</span>
            <strong>{doc.partner}</strong>
            <small>{doc.email || 'No email supplied'}</small>
          </div>
          <div>
            <span>DOCUMENT DATE</span>
            <strong>{doc.date}</strong>
          </div>
          <div>
            <span>DUE DATE</span>
            <strong className={overdue(doc) ? 'late-text' : ''}>{doc.dueDate}</strong>
          </div>
          <div>
            <span>REFERENCE</span>
            <strong>{doc.reference || '—'}</strong>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th className="numeric">Quantity</th>
                <th className="numeric">Unit price</th>
                <th className="numeric">VAT</th>
                <th className="numeric">Total incl. VAT</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line, i) => (
                <tr key={i}>
                  <td>
                    {line.description}
                    <small>
                      {line.accountCode} ·{' '}
                      {doc.kind === 'bill' ? 'Operating expenses' : 'Sales revenue'}
                    </small>
                  </td>
                  <td className="numeric">{line.quantity}</td>
                  <td className="numeric">{money(line.unitCents)}</td>
                  <td className="numeric">{line.taxBps / 100}%</td>
                  <td className="numeric">{money(lineTotals(line).total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detail-totals">
          <div>
            <span>Subtotal</span>
            <strong>{money(doc.subtotal)}</strong>
          </div>
          <div>
            <span>VAT</span>
            <strong>{money(doc.tax)}</strong>
          </div>
          <div className="grand-total">
            <span>Total</span>
            <strong>{money(doc.total)}</strong>
          </div>
          {doc.status !== 'draft' && (
            <>
              <div>
                <span>Paid</span>
                <strong>{money(doc.paid)}</strong>
              </div>
              <div className="grand-total">
                <span>Amount due</span>
                <strong>{money(doc.total - doc.paid)}</strong>
              </div>
            </>
          )}
        </div>
      </section>
      {doc.payments.length > 0 && (
        <section className="panel">
          <div className="section-heading">
            <h2>Payment history</h2>
            <span className="badge posted">
              <ShieldCheck />
              Recorded in ledger
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th className="numeric">Amount</th>
                </tr>
              </thead>
              <tbody>
                {doc.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.date}</td>
                    <td>{p.reference || 'Payment'}</td>
                    <td className="numeric">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function DraftEditor({
  initial,
  busy,
  error,
  onClose,
  onSave,
  review,
  token = '',
  contacts = [],
  onSessionExpired,
}: {
  initial: Kind | Draft
  busy: boolean
  error: string
  onClose: () => void
  onSave: (input: Draft, options?: ReviewOptions) => Promise<boolean>
  review?: BillImport
  token?: string
  contacts?: Contact[]
  onSessionExpired: () => void
}) {
  const kind = typeof initial === 'string' ? initial : initial.kind
  const blank: Line = {
    description: '',
    quantity: 1,
    unitCents: 0,
    taxBps: 2100,
    accountCode: kind === 'bill' ? '5000' : '4000',
  }
  const [draft, setDraft] = useState<Draft>(() =>
    typeof initial === 'string'
      ? {
          kind,
          partner: '',
          email: '',
          reference: '',
          date: today(),
          dueDate: dueInDays(30),
          lines: [blank],
        }
      : {
          kind,
          partner: initial.partner,
          email: initial.email,
          reference: initial.reference,
          date: initial.date,
          dueDate: initial.dueDate,
          lines: initial.lines.map((line) => ({ ...line })),
        },
  )
  const [prices, setPrices] = useState(() => draft.lines.map((line) => decimal(line.unitCents)))
  const [localError, setLocalError] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [acceptMismatch, setAcceptMismatch] = useState(false)
  const setField = (key: 'partner' | 'email' | 'reference' | 'date' | 'dueDate', value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const setLine = (index: number, patch: Partial<Line>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  let total = 0n
  let previewValid = true
  try {
    total = draft.lines.reduce(
      (sum, line, index) => sum + lineTotals({ ...line, unitCents: cents(prices[index]) }).total,
      0n,
    )
  } catch {
    previewValid = false
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setLocalError('')
    try {
      await onSave(
        {
          ...draft,
          lines: draft.lines.map((line, index) => ({ ...line, unitCents: cents(prices[index]) })),
        },
        review ? { reviewed, acceptMismatch } : undefined,
      )
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }
  return (
    <Modal
      title={
        review
          ? 'Review scanned bill'
          : `${typeof initial === 'string' ? 'New' : 'Edit'} ${kind === 'bill' ? 'vendor bill' : 'customer invoice'}`
      }
      onClose={onClose}
      wide={Boolean(review)}
    >
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className={review ? 'dialog-body review-layout' : 'dialog-body'}>
            {review && (
              <OriginalPreview item={review} token={token} onSessionExpired={onSessionExpired} />
            )}
            <div className="draft-form">
              {review && (
                <div className="scan-warnings" role="status">
                  <strong>Review required</strong>
                  <ul>
                    {review.scan.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="dialog-intro">
                Start with a draft. You can review and edit it before posting.
              </p>
              <div className="form-grid">
                <label>
                  Choose a saved contact
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const contact = contacts.find((item) => item.id === event.target.value)
                      if (contact)
                        setDraft((current) => ({
                          ...current,
                          partner: contact.name,
                          email: contact.email,
                        }))
                    }}
                  >
                    <option value="">Enter details manually</option>
                    {contacts
                      .filter((contact) => contact.active)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                          {contact.email ? ` · ${contact.email}` : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {kind === 'bill' ? 'Vendor name' : 'Customer name'}
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={draft.partner}
                    onChange={(e) => setField('partner', e.target.value)}
                    placeholder="Company or person"
                  />
                </label>
                <label>
                  Email <span className="optional">optional</span>
                  <input
                    type="email"
                    maxLength={254}
                    value={draft.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="finance@example.com"
                  />
                </label>
                <label>
                  Document date
                  <input
                    required
                    type="date"
                    min="2000-01-01"
                    value={draft.date}
                    onChange={(e) => setField('date', e.target.value)}
                  />
                </label>
                <label>
                  Due date
                  <input
                    required
                    type="date"
                    min={draft.date}
                    value={draft.dueDate}
                    onChange={(e) => setField('dueDate', e.target.value)}
                  />
                </label>
                <label className="full-width">
                  Reference <span className="optional">optional</span>
                  <input
                    maxLength={300}
                    value={draft.reference}
                    onChange={(e) => setField('reference', e.target.value)}
                    placeholder="Purchase order, project, or supplier reference"
                  />
                </label>
              </div>
              <div className="line-heading">
                <h3>{kind === 'bill' ? 'Bill lines' : 'Invoice lines'}</h3>
                <span>EUR · VAT rounded per line</span>
              </div>
              <div className="editor-lines">
                {draft.lines.map((line, index) => (
                  <div className="editor-line" key={index}>
                    <label>
                      Description
                      <input
                        aria-label={`Line ${index + 1} description`}
                        required
                        maxLength={500}
                        value={line.description}
                        onChange={(e) => setLine(index, { description: e.target.value })}
                        placeholder="What is this for?"
                      />
                    </label>
                    <label>
                      Qty
                      <input
                        aria-label={`Line ${index + 1} quantity`}
                        required
                        type="number"
                        min="1"
                        max="10000"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => setLine(index, { quantity: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Unit price
                      <input
                        aria-label={`Line ${index + 1} unit price`}
                        required
                        inputMode="decimal"
                        value={prices[index]}
                        onChange={(e) =>
                          setPrices((values) =>
                            values.map((value, i) => (i === index ? e.target.value : value)),
                          )
                        }
                      />
                    </label>
                    <label>
                      VAT
                      <select
                        aria-label={`Line ${index + 1} VAT`}
                        value={line.taxBps}
                        onChange={(e) => setLine(index, { taxBps: Number(e.target.value) })}
                      >
                        {[...new Set([0, 600, 1200, 2100, line.taxBps])]
                          .sort((a, b) => a - b)
                          .map((rate) => (
                            <option key={rate} value={rate}>
                              {rate / 100}%
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={draft.lines.length === 1}
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() => {
                        setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }))
                        setPrices((p) => p.filter((_, i) => i !== index))
                      }}
                    >
                      <Xmark />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="text-button add-line"
                disabled={draft.lines.length >= 100}
                onClick={() => {
                  setDraft((d) => ({ ...d, lines: [...d.lines, { ...blank }] }))
                  setPrices((p) => [...p, '0.00'])
                }}
              >
                <Plus />
                Add a line
              </button>
              <div className="editor-total">
                <span>Total including VAT</span>
                <strong>{previewValid ? money(total) : 'Check line amounts'}</strong>
              </div>
              {review && (
                <>
                  {review.scan.total > 0 && previewValid && total !== BigInt(review.scan.total) && (
                    <label className="checkbox discrepancy">
                      <input
                        type="checkbox"
                        checked={acceptMismatch}
                        onChange={(event) => setAcceptMismatch(event.target.checked)}
                      />
                      <span>
                        My entered total differs from the detected total. I checked the original and
                        confirm my entered amounts are correct.
                      </span>
                    </label>
                  )}
                  <label className="checkbox">
                    <input
                      required
                      type="checkbox"
                      checked={reviewed}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    <span>
                      I checked the original, supplier, dates, EUR currency, line amounts and VAT.
                      Save only a draft.
                    </span>
                  </label>
                  {review.scan.currency && review.scan.currency !== 'EUR' && (
                    <p className="form-error">
                      This original uses {review.scan.currency}. Multi-currency bills are not
                      supported; do not enter its amounts as EUR.
                    </p>
                  )}
                </>
              )}
              {(localError || error) && (
                <p className="form-error" role="alert">
                  {localError || error}
                </p>
              )}
            </div>
          </div>
          <div className="dialog-actions">
            <span>
              <Clock />
              Saved as a draft
            </span>
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={
                Boolean(review) &&
                (!reviewed || Boolean(review?.scan.currency && review.scan.currency !== 'EUR'))
              }
            >
              {busy ? 'Saving…' : 'Save draft'}
              <ArrowRight />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}

function PaymentEditor({
  doc,
  busy,
  error,
  onClose,
  onSave,
}: {
  doc: Document
  busy: boolean
  error: string
  onClose: () => void
  onSave: (input: {
    id: string
    amount: number
    date: string
    reference: string
  }) => Promise<boolean>
}) {
  const [id] = useState(() => crypto.randomUUID())
  const [amount, setAmount] = useState(decimal(doc.total - doc.paid))
  const [date, setDate] = useState(today() < doc.date ? doc.date : today())
  const [reference, setReference] = useState('')
  const [localError, setLocalError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setLocalError('')
    try {
      await onSave({ id, amount: cents(amount), date, reference })
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }
  return (
    <Modal
      title={doc.kind === 'bill' ? 'Record vendor payment' : 'Record customer payment'}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className="dialog-body">
            <p className="dialog-intro">
              Outstanding for <strong>{doc.partner}</strong>:{' '}
              <strong>{money(doc.total - doc.paid)}</strong>
            </p>
            <div className="form-grid">
              <label>
                Amount (EUR)
                <input
                  autoFocus
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Payment date
                <input
                  required
                  type="date"
                  min={doc.date}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="full-width">
                Payment reference
                <input
                  maxLength={300}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Bank transfer reference"
                />
              </label>
            </div>
            <div className="info-note">
              <ShieldCheck />
              This records a payment in your books. It does not initiate a bank transfer.
            </div>
            {(localError || error) && (
              <p className="form-error" role="alert">
                {localError || error}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary">
              {busy ? 'Recording…' : 'Record payment'}
              <Check />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
