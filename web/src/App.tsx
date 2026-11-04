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
  csvCell,
  dueInDays,
  journals,
  label,
  lineTotals,
  money,
  overdue,
  today,
  entryMeaning,
  financialMeaningConflicts,
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
  FinancialEvent,
} from './types'
import { BillImports, OriginalPreview } from './BillImports'
import { Modal } from './Modal'
import { AccountingSummary } from './Company'
import { Configuration, DraftBinding } from './Configuration'
import { AppLauncher } from './AppLauncher'
import { createAPIRequest, responseStatus } from './api'
import { can } from './permissions'
import { defaultView, moduleForView, navigation, views } from './modules'
import { githubSignInPath, useWorkspaceRoute } from './routing'
import { RouteNotFound } from './RouteNotFound'
import { messageText, requestMessage, statusText, t, useLocale } from './i18n'
import { LocaleSwitch } from './LocaleSwitch'
import { localizedValidation } from './form-validation'
import {
  formatDate,
  formatBasisPointPercent,
  formatScaledDecimal,
  moneyEdit,
  moneyEditCents,
  parseBasisPointPercent,
  parseScaledDecimal,
  scaledDecimalEdit,
  switchMoneyEdit,
  switchScaledDecimalEdit,
  localePercent,
  type ScaledDecimalEdit,
} from './locale-formats'
import { calculatePolicyPreview } from './calculation-policy'
import type { CalculationPolicyMetadata, PolicyLineData } from './types'

const errorMessage = (error: unknown) => requestMessage(error, responseStatus(error))
const exactPolicy: CalculationPolicyMetadata = {
  policyId: 'exact-fixed-v1',
  schemaVersion: 1,
  currency: 'EUR',
  currencyExponent: 2,
}

interface PolicyLineEditor {
  quantity: ScaledDecimalEdit
  unitPrice: ScaledDecimalEdit
  fixedDiscount: ScaledDecimalEdit
  percentageDiscounts: ScaledDecimalEdit[]
  taxRate: ScaledDecimalEdit
}

function blankPolicyLine(locale: 'en' | 'nl'): PolicyLineEditor {
  return {
    quantity: scaledDecimalEdit('10000', locale),
    unitPrice: scaledDecimalEdit('0', locale),
    fixedDiscount: scaledDecimalEdit('0', locale),
    percentageDiscounts: [],
    taxRate: { text: '21', locale },
  }
}

function policyLineEditor(line: Line, locale: 'en' | 'nl'): PolicyLineEditor {
  const calculation = line.calculation
  if (!calculation)
    return {
      quantity: scaledDecimalEdit((BigInt(line.quantity) * 10_000n).toString(), locale),
      unitPrice: scaledDecimalEdit((BigInt(line.unitCents) * 100n).toString(), locale),
      fixedDiscount: scaledDecimalEdit('0', locale),
      percentageDiscounts: [],
      taxRate: {
        text: formatBasisPointPercent(String(line.taxBps), locale),
        locale,
      },
    }
  return {
    quantity: scaledDecimalEdit(calculation.quantityUnits, locale),
    unitPrice: scaledDecimalEdit(calculation.unitPriceUnits, locale),
    fixedDiscount: scaledDecimalEdit(calculation.fixedDiscountUnits, locale),
    percentageDiscounts: calculation.percentageDiscountBps.map((rate) =>
      scaledDecimalEdit((BigInt(rate) * 100n).toString(), locale),
    ),
    taxRate: {
      text: formatBasisPointPercent(calculation.taxRateBps, locale),
      locale,
    },
  }
}

function policyLineData(editor: PolicyLineEditor, existing?: PolicyLineData): PolicyLineData {
  return {
    ...(existing?.lineId ? { lineId: existing.lineId } : {}),
    quantityUnits: parseScaledDecimal(editor.quantity.text, editor.quantity.locale),
    unitPriceUnits: parseScaledDecimal(editor.unitPrice.text, editor.unitPrice.locale),
    fixedDiscountUnits: parseScaledDecimal(editor.fixedDiscount.text, editor.fixedDiscount.locale),
    percentageDiscountBps: editor.percentageDiscounts.map((rate) =>
      parseBasisPointPercent(rate.text, rate.locale),
    ),
    taxRateBps: parseBasisPointPercent(editor.taxRate.text, editor.taxRate.locale),
  }
}

function knownCalculationPolicy(doc: Document) {
  const metadata = doc.calculationPolicy
  const result = doc.calculation
  if (
    metadata?.policyId !== exactPolicy.policyId ||
    metadata.schemaVersion !== exactPolicy.schemaVersion ||
    metadata.currency !== exactPolicy.currency ||
    metadata.currencyExponent !== exactPolicy.currencyExponent ||
    result?.policyId !== exactPolicy.policyId ||
    result.schemaVersion !== exactPolicy.schemaVersion ||
    result.currency !== exactPolicy.currency ||
    result.currencyExponent !== exactPolicy.currencyExponent ||
    result.lines.length !== doc.lines.length
  )
    return false
  try {
    const preview = calculatePolicyPreview(
      doc.lines.map((line) => {
        if (!line.calculation) throw new Error('calculation policy history is unresolved')
        return line.calculation
      }),
    )
    return (
      result.netMinor === preview.netMinor &&
      result.taxMinor === preview.taxMinor &&
      result.grossMinor === preview.grossMinor &&
      result.lines.every((line, index) => {
        const calculated = preview.lines[index]
        return (
          line.lineId === calculated.lineId &&
          line.netMinor === calculated.netMinor &&
          line.taxMinor === calculated.taxMinor &&
          line.grossMinor === calculated.grossMinor &&
          line.netRoundingResidue.numerator === calculated.netRoundingResidue.numerator &&
          line.netRoundingResidue.denominator === calculated.netRoundingResidue.denominator
        )
      }) &&
      result.taxGroups.length === preview.taxGroups.length &&
      result.taxGroups.every((group, index) => {
        const calculated = preview.taxGroups[index]
        return (
          group.taxRateBps === calculated.taxRateBps &&
          group.netMinor === calculated.netMinor &&
          group.taxMinor === calculated.taxMinor &&
          group.independentLineTax === calculated.independentLineTax &&
          group.roundingAdjustment === calculated.roundingAdjustment
        )
      })
    )
  } catch {
    return false
  }
}

function Badge({ doc }: { doc: Document }) {
  return <span className={`badge ${label(doc).toLowerCase()}`}>{statusText(label(doc))}</span>
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
  const locale = useLocale()
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const [state, setState] = useState<State | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const csrf = useRef('')
  const generation = useRef(0)
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
  const [forbidden, setForbidden] = useState(false)
  const [audit, setAudit] = useState<FinancialEvent[] | null>(null)
  const canWrite = can(session, 'read', 'write')
  const canPost = can(session, 'read', 'post')
  const canAudit = can(session, 'read', 'admin')

  const clearTransient = useCallback(() => {
    setSelected(null)
    setEditor(null)
    setReview(null)
    setOriginal(null)
    setPayment(null)
    setPosting(null)
    setNotice('')
    setQuery('')
    setFilter('All')
    setAudit(null)
  }, [])
  const { view, navigate, routeKey, routeVersion } = useWorkspaceRoute(clearTransient)
  useEffect(() => {
    const title =
      view === null ? t('Page not found') : view === 'apps' ? t('Workspace') : t(views[view].title)
    document.title = t('Odee · {view}', { view: title })
  }, [view, locale])

  const clearWorkspace = useCallback(() => {
    setState(null)
    clearTransient()
  }, [clearTransient])

  const expireSession = useCallback(() => {
    generation.current++
    csrf.current = ''
    clearWorkspace()
    setLoading(false)
    setNeedsToken(true)
    setForbidden(false)
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
    setForbidden(false)
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
      if (requestID === generation.current) {
        setError(errorMessage(error))
        if (responseStatus(error) === 403) {
          clearWorkspace()
          setNeedsToken(false)
          setForbidden(true)
        }
      }
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

  async function mutate(action: () => Promise<Document>, message: string) {
    const mutationRoute = routeVersion.current
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
      if (mutationRoute !== routeVersion.current) return true
      setSelected(doc.id)
      setEditor(null)
      setReview(null)
      setPayment(null)
      setPosting(null)
      setNotice(message)
      return true
    } catch (error) {
      if (mutationRoute === routeVersion.current) setError(errorMessage(error))
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
  const meaningConflicts = financialMeaningConflicts(documents)
  const accountBalance = (role: string) =>
    [...ledger.values()]
      .filter((row) => row.currency === 'EUR' && row.role.includes(role))
      .reduce((sum, row) => sum + row.debit - row.credit, 0n)
  const filtered = documents
    .filter((d) => d.kind === (view === 'bills' ? 'bill' : 'invoice'))
    .filter((d) =>
      `${d.partner} ${d.number} ${d.reference}`.toLowerCase().includes(query.toLowerCase()),
    )
    .filter((d) => filter === 'All' || label(d) === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const currentModule = view === null ? undefined : moduleForView(view)
  const ModuleIcon = currentModule?.icon
  const RegisteredView = view === null || view === 'apps' ? undefined : views[view].component

  function downloadReport() {
    if (!state) return
    const rows = [
      [
        t('Configuration version'),
        t('Code'),
        t('Account'),
        t('Type'),
        t('Resolution'),
        t('Currency'),
        t('Debit EUR'),
        t('Credit EUR'),
      ],
      ...[...ledger.values()].map((value) => {
        return [
          value.version,
          value.code,
          value.name,
          value.type,
          value.known ? 'resolved' : 'unresolved',
          value.currency,
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
        {t('Skip to content')}
      </a>
      <header className="topbar">
        <div className="topbar-left">
          <button
            className="brand"
            onClick={() => navigate('apps')}
            aria-label={t('Odee app launcher')}
          >
            odee<span>.</span>
          </button>
          <span className="brand-divider" />
          <button
            className="app-switch"
            onClick={() => navigate(view === 'apps' ? defaultView : 'apps')}
          >
            <Apps />
            {currentModule ? t(currentModule.name) : t('Workspace')}
          </button>
        </div>
        <div className="topbar-right">
          <LocaleSwitch />
          <span className="open-source">
            <span />
            {t('Open source')}
          </span>
          <span className="company">
            <Building />
            {state?.company ?? 'Odee'}
          </span>
          <span
            className="avatar"
            aria-label={
              session?.user
                ? t('Signed in as {login}', { login: session.user.login })
                : t('Company workspace')
            }
          >
            {session?.user?.login.slice(0, 1).toUpperCase() ?? 'O'}
          </span>
          {session?.authMode === 'github' && session.authenticated && (
            <button className="button secondary" onClick={() => void logout()} disabled={busy}>
              {t('Sign out')}
            </button>
          )}
        </div>
      </header>
      {state && (state.demo || state.development) && (
        <div className="dev-banner">
          <ShieldCheck />
          {state.demo
            ? t('Demo workspace · temporary storage · data is lost on restart')
            : t('Local development · MongoDB connected · authentication disabled')}
        </div>
      )}
      <div className={`layout ${view === null || view === 'apps' ? 'launcher-layout' : ''}`}>
        {currentModule && (
          <aside className="sidebar">
            <div className="sidebar-app">
              <div className="app-icon small">{ModuleIcon && <ModuleIcon />}</div>
              <div>
                <strong>{t(currentModule.name)}</strong>
                <span>{t(currentModule.workspaceDescription)}</span>
              </div>
            </div>
            <nav aria-label={t(currentModule.navigationLabel)}>
              {navigation.map((item) => {
                const Container = item.standalone ? Fragment : 'div'
                return (
                  <Container key={item.view}>
                    {item.group && <div className="nav-group">{t(item.group)}</div>}
                    <button
                      className={view === item.view ? 'nav-item active' : 'nav-item'}
                      aria-current={!item.standalone && view === item.view ? 'page' : undefined}
                      onClick={() => navigate(item.view)}
                    >
                      <item.icon />
                      {t(item.label)}
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
                  ? t('Temporary demo store')
                  : state
                    ? t('MongoDB workspace')
                    : t('Not connected')}
              </span>
              <small>{t('EUR · Single company')}</small>
            </div>
          </aside>
        )}
        <main id="main" className="main">
          {error && (
            <div className="alert error" role="alert">
              <span>{messageText(error)}</span>
              <button
                className="icon-button"
                onClick={() => setError('')}
                aria-label={t('Dismiss error')}
              >
                <Xmark />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <CheckCircle />
              {messageText(notice)}
            </div>
          )}
          {view === null ? (
            <RouteNotFound onLauncher={() => navigate('apps')} />
          ) : session?.authMode === 'github' && !session.authenticated ? (
            <div className="login panel">
              <ShieldCheck />
              <h1>{t('Your workspace, protected.')}</h1>
              <p>
                {t('Sign in with GitHub. Access is limited to active members of {organization}.', {
                  organization: `${session.organisation}/${session.team}`,
                })}
              </p>
              <a className="button primary" href={githubSignInPath(view)}>
                {t('Sign in with GitHub')} <ArrowRight />
              </a>
            </div>
          ) : needsToken ? (
            <div className="login panel">
              <ShieldCheck />
              <h1>{t('Your books, protected.')}</h1>
              <p>
                {t(
                  'Enter the company access token provided by your administrator. It stays in memory for this tab only.',
                )}
              </p>
              <form
                {...localizedValidation}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (tokenInput === token) void refresh()
                  else setToken(tokenInput)
                }}
              >
                <label>
                  {t('Company access token')}
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(event) => setTokenInput(event.target.value)}
                    autoComplete="off"
                    required
                  />
                </label>
                <button className="button primary" disabled={loading}>
                  {t('Open workspace')} <ArrowRight />
                </button>
              </form>
            </div>
          ) : forbidden ? (
            <section className="empty" aria-labelledby="forbidden-heading">
              <ShieldCheck />
              <h1 id="forbidden-heading">{t('Access forbidden')}</h1>
              <p>
                {t(
                  'You are still signed in. Ask your administrator for company membership and read access.',
                )}
              </p>
              <button className="button secondary" onClick={() => void refresh()}>
                {t('Refresh permissions')}
              </button>
            </section>
          ) : !state ? (
            <div className="empty">
              <h1>{loading ? t('Opening your workspace…') : t('Unable to open workspace')}</h1>
              <p>
                {loading
                  ? t('Connecting to Accounting.')
                  : t('Check the server and MongoDB connection, then retry.')}
              </p>
              {!loading && (
                <button className="button secondary" onClick={() => void refresh()}>
                  <RefreshDouble />
                  {t('Retry')}
                </button>
              )}
            </div>
          ) : view === 'apps' ? (
            <AppLauncher onNavigate={navigate} />
          ) : RegisteredView ? (
            <RegisteredView
              key={routeKey}
              state={state}
              request={request}
              onRefresh={refresh}
              onStateChange={setState}
              canWrite={canWrite}
              canAdmin={canAudit}
            />
          ) : (
            <>
              <div className="breadcrumb">
                <button onClick={() => navigate('apps')}>{t('Workspace')}</button>
                <span>/</span>
                <span>{t('Accounting')}</span>
                <span>/</span>
                <span>{doc ? doc.partner : t(views[view].title)}</span>
              </div>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {doc
                      ? doc.kind === 'invoice'
                        ? t('CUSTOMER INVOICE')
                        : t('VENDOR BILL')
                      : t('ACCOUNTING')}
                  </div>
                  <h1>{doc ? doc.partner : t(views[view].title)}</h1>
                  <p>
                    {doc
                      ? doc.number
                      : view === 'dashboard'
                        ? t('A clear view of your money. A good place to start.')
                        : view === 'reports'
                          ? t('All posted activity · EUR · since workspace creation')
                          : view === 'accounts'
                            ? t('Your starter chart. A foundation for balanced books.')
                            : t('Keep the details in order. Let the numbers add up.')}
                  </p>
                </div>
                <div className="heading-actions">
                  <button
                    className="icon-button"
                    title={t('Refresh workspace')}
                    aria-label={t('Refresh workspace')}
                    disabled={loading || busy}
                    onClick={() => void refresh()}
                  >
                    <RefreshDouble className={loading ? 'spin' : ''} />
                  </button>
                  {doc ? (
                    <button className="button secondary" onClick={() => setSelected(null)}>
                      <ArrowLeft />
                      {t('Back')}
                    </button>
                  ) : view === 'reports' ? (
                    <button className="button secondary" onClick={downloadReport}>
                      <Download />
                      {t('Export CSV')}
                    </button>
                  ) : (
                    (view === 'dashboard' || view === 'invoices' || view === 'bills') && (
                      <button
                        className="button primary"
                        disabled={!canWrite}
                        onClick={() => setEditor(view === 'bills' ? 'bill' : 'invoice')}
                      >
                        <Plus />
                        {view === 'bills' ? t('New bill') : t('New invoice')}
                      </button>
                    )
                  )}
                </div>
              </div>
              {doc ? (
                <DocumentDetail
                  binding={
                    <DraftBinding
                      key={doc.id}
                      doc={doc}
                      request={request}
                      onRefresh={refresh}
                      canWrite={canWrite}
                    />
                  }
                  doc={doc}
                  busy={busy}
                  canWrite={canWrite}
                  canPost={canPost}
                  onAudit={
                    canAudit
                      ? () => {
                          const auditGeneration = generation.current
                          const auditRoute = routeVersion.current
                          void request<{ events: FinancialEvent[] }>(`documents/${doc.id}/audit`)
                            .then((result) => {
                              if (
                                auditGeneration === generation.current &&
                                auditRoute === routeVersion.current
                              )
                                setAudit(result.events)
                            })
                            .catch((error) => {
                              if (
                                auditGeneration === generation.current &&
                                auditRoute === routeVersion.current
                              )
                                setError(errorMessage(error))
                            })
                        }
                      : undefined
                  }
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
                      {t('YOUR BOOKS AT A GLANCE')}
                    </span>
                    <span>
                      {new Date().toLocaleDateString(locale === 'nl' ? 'nl-BE' : 'en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="dashboard-grid">
                    <JournalCard
                      title={t('Customer invoices')}
                      kind="invoice"
                      icon={<CreditCard />}
                      amount={sumOpen(invoices)}
                      caption={t('Outstanding receivables')}
                      count={invoices.filter((d) => d.status === 'posted').length}
                      countLabel={t('awaiting payment')}
                      extra={t('{count} overdue', { count: invoices.filter(overdue).length })}
                      onOpen={() => navigate('invoices')}
                      onNew={() => setEditor('invoice')}
                      canWrite={canWrite}
                    />
                    <JournalCard
                      title={t('Vendor bills')}
                      kind="bill"
                      icon={<Wallet />}
                      amount={sumOpen(bills)}
                      caption={t('Outstanding payables')}
                      count={bills.filter((d) => d.status === 'posted').length}
                      countLabel={t('to pay')}
                      extra={t('{count} drafts to review', {
                        count: bills.filter((d) => d.status === 'draft').length,
                      })}
                      onOpen={() => navigate('bills')}
                      onNew={() => setEditor('bill')}
                      canWrite={canWrite}
                    />
                    <div className="panel journal-card">
                      <div className="card-top">
                        <span className="card-icon mint">
                          <Building />
                        </span>
                        <span className="badge">{t('Manual ledger')}</span>
                      </div>
                      <h2>{t('Bank account')}</h2>
                      <div className="metric">{money(accountBalance('bank'))}</div>
                      <p className="metric-caption">{t('Recorded payment movements')}</p>
                      <div className="card-facts">
                        <span>{t('Bank feed')}</span>
                        <span>{t('Not connected')}</span>
                      </div>
                      <button className="card-action" onClick={() => navigate('journal')}>
                        {t('View payment entries')} <ArrowRight />
                      </button>
                    </div>
                    <div className="panel journal-card">
                      <div className="card-top">
                        <span className="card-icon peach">
                          <GraphUp />
                        </span>
                        <span className="badge">{t('Indicative only')}</span>
                      </div>
                      <h2>{t('VAT position')}</h2>
                      <div className="metric">
                        {money(-accountBalance('vatPayable') - accountBalance('vatRecoverable'))}
                      </div>
                      <p className="metric-caption">{t('Output VAT less recoverable VAT')}</p>
                      <div className="card-facts">
                        <span>{t('Tax filing')}</span>
                        <span>{t('Not configured')}</span>
                      </div>
                      <button className="card-action" onClick={() => navigate('reports')}>
                        {t('View trial balance')} <ArrowRight />
                      </button>
                    </div>
                  </div>
                  <div className="dashboard-lower">
                    <section className="panel activity">
                      <div className="section-heading">
                        <div>
                          <h2>{t('Recent documents')}</h2>
                          <p>{t('A little order goes a long way.')}</p>
                        </div>
                        <button className="text-button" onClick={() => navigate('invoices')}>
                          {t('View invoices')} <ArrowRight />
                        </button>
                      </div>
                      {documents.length === 0 ? (
                        <Empty title={t('Your books start with a first entry.')}>
                          {t(
                            'Create an invoice or vendor bill. Save it as a draft, review it, then post it to the ledger.',
                          )}
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
                                  navigate(d.kind === 'bill' ? 'bills' : 'invoices')
                                  setSelected(d.id)
                                }}
                              >
                                <span className={`document-icon ${d.kind}`}>
                                  <Book />
                                </span>
                                <span className="recent-partner">
                                  <strong>{d.partner}</strong>
                                  <small>
                                    {statusText(d.kind)} · {formatDate(d.date)}
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
                      <div className="eyebrow">{t('MAKE YOURSELF AT HOME')}</div>
                      <h2>
                        {t('Good books.')}
                        <br />
                        {t('Better decisions.')}
                      </h2>
                      <p>
                        {t(
                          'Start simple. Every posted document creates a balanced journal, and every payment keeps a trace.',
                        )}
                      </p>
                      <div className="setup-item">
                        <CheckCircle />
                        <span>{t('Starter chart of accounts')}</span>
                        <Check />
                      </div>
                      <div className={`setup-item ${documents.length ? '' : 'pending'}`}>
                        <Book />
                        <span>{t('Create your first document')}</span>
                        {documents.length ? <Check /> : <span>01</span>}
                      </div>
                      <div className={`setup-item ${posted.length ? '' : 'pending'}`}>
                        <ShieldCheck />
                        <span>{t('Post a balanced entry')}</span>
                        {posted.length ? <Check /> : <span>02</span>}
                      </div>
                      <button className="text-button" onClick={() => navigate('accounts')}>
                        {t('Explore your accounts')} <ArrowRight />
                      </button>
                    </section>
                  </div>
                  <div className="info-note">
                    <ShieldCheck />
                    <p>
                      {t(
                        'This first release is a bookkeeping foundation. Bank feeds, statutory tax filing, reconciliation, and country-specific compliance are not yet implemented.',
                      )}
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
                      canWrite={canWrite}
                    />
                  )}
                  <section className="panel document-table">
                    <div className="table-toolbar">
                      <div className="tabs" role="group" aria-label={t('Document status filter')}>
                        {['All', 'Draft', 'Posted', 'Partial', 'Paid', 'Overdue'].map((option) => (
                          <button
                            key={option}
                            className={filter === option ? 'active' : ''}
                            onClick={() => setFilter(option)}
                            aria-pressed={filter === option}
                          >
                            {statusText(option)}
                          </button>
                        ))}
                      </div>
                      <label className="search">
                        <Search />
                        <input
                          aria-label={t('Search documents')}
                          placeholder={t('Search name or reference…')}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{view === 'bills' ? t('Vendor') : t('Customer')}</th>
                            <th>{t('Reference')}</th>
                            <th>{t('Date')}</th>
                            <th>{t('Due date')}</th>
                            <th>{t('Status')}</th>
                            <th className="numeric">{t('Total')}</th>
                            <th className="numeric">{t('Due')}</th>
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
                              <td>{formatDate(d.date)}</td>
                              <td className={overdue(d) ? 'late-text' : ''}>
                                {formatDate(d.dueDate)}
                              </td>
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
                            ? t('No matching documents.')
                            : view === 'bills'
                              ? t('No bills yet.')
                              : t('No invoices yet.')
                        }
                      >
                        {view === 'bills'
                          ? t('Use New bill to get started, or adjust your search and filters.')
                          : t('Use New invoice to get started, or adjust your search and filters.')}
                      </Empty>
                    )}
                    <div className="table-footer">
                      {t('{count} documents', { count: filtered.length })}{' '}
                      <span>{t('EUR · Drafts do not affect the ledger')}</span>
                    </div>
                  </section>
                </>
              ) : view === 'journal' ? (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>{t('General journal')}</h2>
                      <p>
                        {t(
                          'Posted documents and their payment entries. Debits always equal credits.',
                        )}
                      </p>
                    </div>
                    <span className="badge posted">
                      {t('{count} entries', { count: journals(documents).length })}
                    </span>
                  </div>
                  {journals(documents).length === 0 ? (
                    <Empty title={t('A balanced beginning.')}>
                      {t('Post your first invoice or bill to see its journal entries here.')}
                    </Empty>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('Date')}</th>
                            <th>{t('Document / entry')}</th>
                            <th>{t('Account')}</th>
                            <th className="numeric">{t('Debit')}</th>
                            <th className="numeric">{t('Credit')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journals(documents).flatMap((journal) =>
                            journal.entries.map((entry, index) => (
                              <tr key={`${journal.key}/${index}`}>
                                <td>{index === 0 ? formatDate(journal.date) : ''}</td>
                                <td>
                                  {index === 0 && (
                                    <button
                                      className="table-link"
                                      onClick={() => setSelected(journal.document.id)}
                                    >
                                      {journal.document.partner}
                                      <small>
                                        {journal.payment
                                          ? t('Payment')
                                          : statusText(journal.document.kind)}{' '}
                                        ·{' '}
                                        {journal.payment &&
                                        !journal.document.payments.find(
                                          (p) => `${journal.document.id}/${p.id}` === journal.key,
                                        )?.reference
                                          ? t('Payment')
                                          : journal.reference}
                                      </small>
                                    </button>
                                  )}
                                </td>
                                <td>
                                  <span className="account-code">{entry.accountCode}</span>
                                  {
                                    entryMeaning(
                                      journal.document,
                                      entry,
                                      `${journal.key}/${index}`,
                                      meaningConflicts,
                                    ).name
                                  }
                                  <small>
                                    {
                                      entryMeaning(
                                        journal.document,
                                        entry,
                                        `${journal.key}/${index}`,
                                        meaningConflicts,
                                      ).version
                                    }
                                  </small>
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
              ) : view === 'accounts' && state.configuration ? (
                <Configuration
                  view={state.configuration}
                  request={request}
                  onRefresh={refresh}
                  canAdmin={canAudit}
                  refreshing={loading}
                />
              ) : (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>{view === 'reports' ? t('Trial balance') : t('Starter accounts')}</h2>
                      <p>
                        {view === 'reports'
                          ? t(
                              'Cumulative posted debits and credits. No opening balances have been imported.',
                            )
                          : t(
                              'A minimal, fixed chart for this release. Country-specific charts will follow.',
                            )}
                      </p>
                    </div>
                    <span className="badge posted">
                      <CheckCircle />
                      {view === 'reports' ? t('Double-entry') : t('8 accounts')}
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('Code')}</th>
                          <th>{t('Account')}</th>
                          <th>{t('Type')}</th>
                          <th className="numeric">{t('Debit')}</th>
                          <th className="numeric">{t('Credit')}</th>
                          <th className="numeric">{t('Net balance')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...ledger.values()].map((value) => {
                          return (
                            <tr key={value.key}>
                              <td className="account-code">
                                {value.code}
                                <small>
                                  {value.version} · {value.currency}
                                </small>
                              </td>
                              <td>
                                <strong>{value.name}</strong>
                              </td>
                              <td>
                                <span className="badge account-type">
                                  {value.known
                                    ? statusText(value.type)
                                    : t('Financial meaning unknown')}
                                </span>
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
                          <td colSpan={3}>{t('Total · EUR')}</td>
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
                <span>{t('odee. / Open accounting')}</span>
                <span>{t('Built for clarity. Yours to shape.')}</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {editor && (
        <DraftEditor
          defaultAccount={
            state?.configuration?.defaultData?.mappings[editor === 'bill' ? 'expense' : 'revenue']
          }
          onSessionExpired={expireSession}
          contacts={state?.contacts ?? []}
          companyProfile={state?.companyProfile}
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
          companyProfile={state?.companyProfile}
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
        <Modal title={t('Original bill document')} wide onClose={() => setOriginal(null)}>
          <div className="dialog-body">
            <OriginalPreview item={original} token={token} onSessionExpired={expireSession} />
          </div>
        </Modal>
      )}
      {posting && (
        <Modal
          title={t('Post to the ledger?')}
          onClose={() => {
            if (!busy) setPosting(null)
          }}
        >
          <div className="dialog-body">
            <p>
              {t('Post')} <strong>{posting.partner}</strong> {t('for')}{' '}
              <strong>{money(posting.total)}</strong>?{' '}
              {t(
                'This creates balanced journal entries. Posted documents cannot be edited in this release.',
              )}
            </p>
            <div className="info-note">
              <ShieldCheck />
              {t('Review the date, amounts, partner, and VAT before confirming.')}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {messageText(error)}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button className="button secondary" disabled={busy} onClick={() => setPosting(null)}>
              {t('Cancel')}
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
              {busy ? t('Posting…') : t('Confirm posting')}
            </button>
          </div>
        </Modal>
      )}
      {audit !== null && (
        <Modal title={t('Financial audit')} onClose={() => setAudit(null)}>
          <p>
            {t('Only new posting and manual payments. Shared credentials do not identify a human.')}
          </p>
          {audit.length === 0 ? (
            <p>{t('No attributed financial actions.')}</p>
          ) : (
            <ul>
              {audit.map((event) => (
                <li key={event.id}>
                  {event.time} · {messageText(event.action)} · {event.principal} (
                  {messageText(event.actorType)}) · v{event.version} · {messageText(event.outcome)}
                </li>
              ))}
            </ul>
          )}
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
  kind,
  icon,
  amount,
  caption,
  count,
  countLabel,
  extra,
  onOpen,
  onNew,
  canWrite,
}: {
  title: string
  kind: Kind
  icon: ReactNode
  amount: bigint
  caption: string
  count: number
  countLabel: string
  extra: string
  onOpen: () => void
  onNew: () => void
  canWrite: boolean
}) {
  return (
    <div className="panel journal-card">
      <div className="card-top">
        <span className="card-icon">{icon}</span>
        <button
          className="icon-button"
          aria-label={kind === 'bill' ? t('Create bill') : t('Create invoice')}
          disabled={!canWrite}
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
        {kind === 'bill' ? t('View bills') : t('View invoices')} <ArrowRight />
      </button>
    </div>
  )
}

function DocumentDetail({
  binding,
  doc,
  busy,
  onEdit,
  onPost,
  onPay,
  onOriginal,
  canWrite,
  canPost,
  onAudit,
}: {
  binding: ReactNode
  doc: Document
  busy: boolean
  onEdit: () => void
  onPost: () => void
  onPay: () => void
  onOriginal?: () => void
  canWrite: boolean
  canPost: boolean
  onAudit?: () => void
}) {
  const resolvedPolicy = knownCalculationPolicy(doc)
  const unresolvedPolicy = Boolean(doc.calculationPolicy || doc.calculation) && !resolvedPolicy
  return (
    <div className="detail">
      <section className="panel">
        {binding}
        <div className="section-heading">
          <div className="detail-status">
            <Badge doc={doc} />
            <span>{t('EUR · Version {version}', { version: doc.version })}</span>
          </div>
          <div className="heading-actions">
            {onAudit && (
              <button className="button secondary" onClick={onAudit}>
                {t('Financial audit')}
              </button>
            )}
            {onOriginal && (
              <button type="button" className="button secondary" onClick={onOriginal}>
                <Book />
                {t('View original')}
              </button>
            )}
            {doc.status === 'draft' ? (
              <>
                <button
                  className="button secondary"
                  disabled={busy || !canWrite || unresolvedPolicy}
                  onClick={onEdit}
                >
                  {t('Edit draft')}
                </button>
                <button
                  className="button primary"
                  disabled={busy || !canPost || unresolvedPolicy}
                  onClick={onPost}
                >
                  <Check />
                  {t('Post document')}
                </button>
              </>
            ) : doc.status === 'posted' ? (
              <button
                className="button primary"
                disabled={busy || !canPost || unresolvedPolicy}
                onClick={onPay}
              >
                <Wallet />
                {t('Record payment')}
              </button>
            ) : (
              <span className="paid-note">
                <CheckCircle />
                {t('Fully paid')}
              </span>
            )}
          </div>
        </div>
        <div className="detail-meta">
          <div>
            <span>{doc.kind === 'bill' ? t('VENDOR') : t('CUSTOMER')}</span>
            <strong>{doc.partner}</strong>
            <small>{doc.email || t('No email supplied')}</small>
          </div>
          <div>
            <span>{t('DOCUMENT DATE')}</span>
            <strong>{formatDate(doc.date)}</strong>
          </div>
          <div>
            <span>{t('DUE DATE')}</span>
            <strong className={overdue(doc) ? 'late-text' : ''}>{formatDate(doc.dueDate)}</strong>
          </div>
          <div>
            <span>{t('REFERENCE')}</span>
            <strong>{doc.reference || '—'}</strong>
          </div>
        </div>
        <section aria-label={t('Accounting captures')}>
          {resolvedPolicy ? (
            <p role="status">
              {t(
                'Calculation policy {policy} · schema {version} · {currency} exponent {exponent}',
                {
                  policy: doc.calculationPolicy!.policyId,
                  version: doc.calculationPolicy!.schemaVersion,
                  currency: doc.calculationPolicy!.currency,
                  exponent: doc.calculationPolicy!.currencyExponent,
                },
              )}
            </p>
          ) : unresolvedPolicy ? (
            <p role="alert">{t('Calculation policy history is unresolved.')}</p>
          ) : null}
          <h3>{t('Partner capture')}</h3>
          <p>
            {doc.partnerSnapshot?.sourceVersion
              ? t('Captured version {version}', { version: doc.partnerSnapshot.sourceVersion })
              : t('Manual / incomplete history')}
          </p>
          {doc.partnerSnapshot && <AccountingSummary data={doc.partnerSnapshot.data} />}
          <h3>{t('Own company capture')}</h3>
          <p>
            {doc.ownCompanySnapshot
              ? `${doc.ownCompanySnapshot.role === 'seller' ? t('Seller') : t('Buyer')} · ${t('Captured version {version}', { version: doc.ownCompanySnapshot.sourceVersion })}`
              : t('Incomplete / unknown')}
          </p>
          {doc.ownCompanySnapshot && <AccountingSummary data={doc.ownCompanySnapshot.data} />}
        </section>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Description')}</th>
                <th className="numeric">{t('Quantity')}</th>
                <th className="numeric">{t('Unit price')}</th>
                <th className="numeric">{t('VAT')}</th>
                <th className="numeric">{t('Total incl. VAT')}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line, i) => (
                <tr key={i}>
                  <td>
                    {line.description}
                    <small>
                      {line.accountCode} ·{' '}
                      {(doc.financialSnapshot ?? doc.financialMeaning)?.accounts.find(
                        (a) => a.code === line.accountCode,
                      )?.name ?? t('Selected accounting configuration')}
                    </small>
                    {resolvedPolicy && line.calculation && (
                      <small>
                        {t('Fixed line discount (up to 4 decimals)')}:{' '}
                        {formatScaledDecimal(line.calculation.fixedDiscountUnits)}
                        {line.calculation.percentageDiscountBps.map((rate, index) => (
                          <span key={index}>
                            {' · '}
                            {t('Percentage discount {n}', { n: index + 1 })}:{' '}
                            {formatBasisPointPercent(rate)}%
                          </span>
                        ))}
                      </small>
                    )}
                  </td>
                  {resolvedPolicy && line.calculation ? (
                    (() => {
                      const calculated = doc.calculation!.lines.find(
                        (item) => item.lineId === line.calculation!.lineId,
                      )!
                      return (
                        <>
                          <td className="numeric">
                            {formatScaledDecimal(line.calculation.quantityUnits)}
                            <small>
                              {t('Net rounding residue {fraction}', {
                                fraction: `${calculated.netRoundingResidue.numerator}/${calculated.netRoundingResidue.denominator}`,
                              })}
                            </small>
                          </td>
                          <td className="numeric">
                            {formatScaledDecimal(line.calculation.unitPriceUnits)}
                          </td>
                          <td className="numeric">
                            {formatBasisPointPercent(line.calculation.taxRateBps)}%
                          </td>
                          <td className="numeric">{money(calculated.grossMinor)}</td>
                        </>
                      )
                    })()
                  ) : unresolvedPolicy ? (
                    <>
                      <td className="numeric">—</td>
                      <td className="numeric">—</td>
                      <td className="numeric">—</td>
                      <td className="numeric">—</td>
                    </>
                  ) : (
                    <>
                      <td className="numeric">{line.quantity}</td>
                      <td className="numeric">{money(line.unitCents)}</td>
                      <td className="numeric">{localePercent(line.taxBps)}</td>
                      <td className="numeric">{money(lineTotals(line).total)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detail-totals">
          <div>
            <span>{t('Subtotal')}</span>
            <strong>{money(resolvedPolicy ? doc.calculation!.netMinor : doc.subtotal)}</strong>
          </div>
          <div>
            <span>{t('VAT')}</span>
            <strong>{money(resolvedPolicy ? doc.calculation!.taxMinor : doc.tax)}</strong>
          </div>
          <div className="grand-total">
            <span>{t('Total')}</span>
            <strong>{money(resolvedPolicy ? doc.calculation!.grossMinor : doc.total)}</strong>
          </div>
          {resolvedPolicy &&
            doc.calculation!.taxGroups.map((group) => (
              <div key={group.taxRateBps}>
                <span>
                  {t('Tax rounding adjustment')} · {formatBasisPointPercent(group.taxRateBps)}%
                </span>
                <strong>{money(group.roundingAdjustment)}</strong>
                <small>
                  {t('Independent line tax')}: {money(group.independentLineTax)}
                </small>
              </div>
            ))}
          {doc.status !== 'draft' && (
            <>
              <div>
                <span>{t('Paid')}</span>
                <strong>{money(doc.paid)}</strong>
              </div>
              <div className="grand-total">
                <span>{t('Amount due')}</span>
                <strong>
                  {money(
                    resolvedPolicy
                      ? BigInt(doc.calculation!.grossMinor) - BigInt(doc.paid)
                      : doc.total - doc.paid,
                  )}
                </strong>
              </div>
            </>
          )}
        </div>
      </section>
      {doc.payments.length > 0 && (
        <section className="panel">
          <div className="section-heading">
            <h2>{t('Payment history')}</h2>
            <span className="badge posted">
              <ShieldCheck />
              {t('Recorded in ledger')}
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Reference')}</th>
                  <th className="numeric">{t('Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {doc.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td>
                    <td>{p.reference || t('Payment')}</td>
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
  defaultAccount,
  initial,
  busy,
  error,
  onClose,
  onSave,
  review,
  token = '',
  contacts = [],
  companyProfile,
  onSessionExpired,
}: {
  defaultAccount?: string
  initial: Kind | Draft
  busy: boolean
  error: string
  onClose: () => void
  onSave: (input: Draft, options?: ReviewOptions) => Promise<boolean>
  review?: BillImport
  token?: string
  contacts?: Contact[]
  companyProfile?: import('./types').CompanyProfile | null
  onSessionExpired: () => void
}) {
  const kind = typeof initial === 'string' ? initial : initial.kind
  const captured = typeof initial === 'string' ? undefined : (initial as Document).partnerSnapshot
  const ownCapture =
    typeof initial === 'string' ? undefined : (initial as Document).ownCompanySnapshot
  const blank: Line = {
    description: '',
    quantity: 1,
    unitCents: 0,
    taxBps: 2100,
    accountCode:
      typeof initial === 'string'
        ? (defaultAccount ?? (kind === 'bill' ? '5000' : '4000'))
        : (initial.lines[0]?.accountCode ?? ''),
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
          calculationPolicy: initial.calculationPolicy,
        },
  )
  const locale = useLocale()
  const [policyLines, setPolicyLines] = useState(() =>
    draft.lines.map((line) => policyLineEditor(line, locale)),
  )
  const [prices, setPrices] = useState(() =>
    draft.lines.map((line) => moneyEdit(line.unitCents, locale)),
  )
  useEffect(() => {
    setPrices((values) => values.map((value) => switchMoneyEdit(value, locale)))
    setPolicyLines((values) =>
      values.map((line) => ({
        quantity: switchScaledDecimalEdit(line.quantity, locale),
        unitPrice: switchScaledDecimalEdit(line.unitPrice, locale),
        fixedDiscount: switchScaledDecimalEdit(line.fixedDiscount, locale),
        percentageDiscounts: line.percentageDiscounts.map((rate) =>
          switchScaledDecimalEdit(rate, locale),
        ),
        taxRate: switchScaledDecimalEdit(line.taxRate, locale),
      })),
    )
  }, [locale])
  const [localError, setLocalError] = useState('')
  const savedSelection =
    draft.partnerAction === 'manual' ? undefined : (draft.contactId ?? captured?.contactId)
  const isCaptured = Boolean(savedSelection && savedSelection !== '000000000000000000000000')
  const [reviewed, setReviewed] = useState(false)
  const [acceptMismatch, setAcceptMismatch] = useState(false)
  const setField = (key: 'partner' | 'email' | 'reference' | 'date' | 'dueDate', value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const setLine = (index: number, patch: Partial<Line>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  const setPolicyLine = (index: number, patch: Partial<PolicyLineEditor>) =>
    setPolicyLines((values) =>
      values.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    )
  let total = 0n
  let previewValid = true
  let policyPreview: ReturnType<typeof calculatePolicyPreview> | undefined
  let previewError = ''
  if (draft.calculationPolicy) {
    try {
      policyPreview = calculatePolicyPreview(
        draft.lines.map((line, index) => policyLineData(policyLines[index], line.calculation)),
      )
      total = BigInt(policyPreview.grossMinor)
    } catch (error) {
      previewValid = false
      previewError = error instanceof Error ? error.message : 'Check exact calculation inputs.'
    }
  } else {
    try {
      total = draft.lines.reduce(
        (sum, line, index) =>
          sum + lineTotals({ ...line, unitCents: moneyEditCents(prices[index]) }).total,
        0n,
      )
    } catch {
      previewValid = false
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setLocalError('')
    try {
      await onSave(
        {
          ...draft,
          lines: draft.calculationPolicy
            ? draft.lines.map((line, index) => ({
                ...line,
                quantity: 0,
                unitCents: 0,
                taxBps: 0,
                calculation: policyLineData(policyLines[index], line.calculation),
              }))
            : draft.lines.map((line, index) => ({
                ...line,
                unitCents: moneyEditCents(prices[index]),
              })),
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
          ? t('Review scanned bill')
          : typeof initial === 'string'
            ? kind === 'bill'
              ? t('New vendor bill')
              : t('New customer invoice')
            : kind === 'bill'
              ? t('Edit vendor bill')
              : t('Edit customer invoice')
      }
      onClose={onClose}
      wide={Boolean(review)}
    >
      <form {...localizedValidation} onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className={review ? 'dialog-body review-layout' : 'dialog-body'}>
            {review && (
              <OriginalPreview item={review} token={token} onSessionExpired={onSessionExpired} />
            )}
            <div className="draft-form">
              {review && (
                <div className="scan-warnings" role="status">
                  <strong>{t('Review required')}</strong>
                  <span>{t('Scan diagnostics')}</span>
                  <ul>
                    {review.scan.warnings.map((warning, index) => (
                      <li key={index}>{messageText(warning)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="dialog-intro">
                {t('Start with a draft. You can review and edit it before posting.')}
              </p>
              {typeof initial === 'string' && !review && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.calculationPolicy)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        calculationPolicy: event.target.checked ? exactPolicy : undefined,
                      }))
                    }
                  />
                  <span>{t('Use exact fixed calculation policy')}</span>
                </label>
              )}
              {draft.calculationPolicy && (
                <p role="status">
                  {t(
                    'This is an explicit opt-in for new drafts. Existing drafts keep their recognized calculation policy.',
                  )}
                </p>
              )}
              <p role="status">
                {t('Partner capture')}:{' '}
                {captured?.sourceVersion
                  ? t('Captured version {version}', { version: captured.sourceVersion })
                  : t('Manual / incomplete history')}
              </p>
              {captured && <AccountingSummary data={captured.data} />}
              <p role="status">
                {t('Own company capture')}:{' '}
                {ownCapture
                  ? `${ownCapture.data.name} · ${t('Captured version {version}', { version: ownCapture.sourceVersion })}`
                  : companyProfile && (typeof initial === 'string' || !('id' in initial))
                    ? `${companyProfile.data.name} · ${t('Current profile will be captured on creation.')}`
                    : t('Incomplete / unknown')}
              </p>
              <p>
                {t(
                  'Posting freezes existing captures; it does not fetch current contact or company data.',
                )}
              </p>
              {companyProfile && typeof initial !== 'string' && 'id' in initial && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      ownCompanyAction: 'refresh',
                      expectedCompanyVersion: companyProfile.version,
                    }))
                  }
                >
                  {t('Refresh own company capture')}
                </button>
              )}
              {draft.ownCompanyAction && <p role="status">{t('Refresh will apply on save.')}</p>}
              <div className="form-grid">
                <label>
                  {t('Choose a saved contact')}
                  <select
                    aria-label={t('Choose a saved contact')}
                    value={isCaptured ? savedSelection : ''}
                    onChange={(event) => {
                      const contact = contacts.find((item) => item.id === event.target.value)
                      if (contact)
                        setDraft((current) => ({
                          ...current,
                          partner: contact.name,
                          email: contact.email,
                          partnerAction: 'select',
                          contactId: contact.id,
                          expectedContactVersion: contact.version,
                        }))
                    }}
                  >
                    <option value="" disabled={isCaptured}>
                      {t('Enter details manually')}
                    </option>
                    {isCaptured && !contacts.some((c) => c.active && c.id === savedSelection) && (
                      <option value={savedSelection}>{captured?.data.name ?? draft.partner}</option>
                    )}
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
                {isCaptured && (
                  <>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        const contact = contacts.find((c) => c.id === savedSelection)
                        setDraft((d) => ({
                          ...d,
                          partnerAction:
                            captured?.contactId === savedSelection ? 'refresh' : 'select',
                          contactId: savedSelection,
                          expectedContactVersion: contact?.version ?? captured?.sourceVersion,
                        }))
                      }}
                    >
                      {t('Refresh saved contact')}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          partnerAction: 'manual',
                          contactId: undefined,
                          expectedContactVersion: undefined,
                        }))
                      }
                    >
                      {t('Convert to manual entry')}
                    </button>
                  </>
                )}
                {draft.partnerAction && (
                  <p role="status">{t('Selection or conversion will apply on save.')}</p>
                )}
                <label>
                  {kind === 'bill' ? t('Vendor name') : t('Customer name')}
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={draft.partner}
                    readOnly={isCaptured}
                    onChange={(e) => setField('partner', e.target.value)}
                    placeholder={t('Company or person')}
                  />
                </label>
                <label>
                  {t('Email')} <span className="optional">{t('optional')}</span>
                  <input
                    type="email"
                    maxLength={254}
                    value={draft.email}
                    readOnly={isCaptured}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="finance@example.com"
                  />
                </label>
                <label>
                  {t('Document date')}
                  <input
                    required
                    type="date"
                    min="2000-01-01"
                    value={draft.date}
                    onChange={(e) => setField('date', e.target.value)}
                  />
                </label>
                <label>
                  {t('Due date')}
                  <input
                    required
                    type="date"
                    min={draft.date}
                    value={draft.dueDate}
                    onChange={(e) => setField('dueDate', e.target.value)}
                  />
                </label>
                <label className="full-width">
                  {t('Reference')} <span className="optional">{t('optional')}</span>
                  <input
                    maxLength={300}
                    value={draft.reference}
                    onChange={(e) => setField('reference', e.target.value)}
                    placeholder={t('Purchase order, project, or supplier reference')}
                  />
                </label>
              </div>
              <div className="line-heading">
                <h3>{kind === 'bill' ? t('Bill lines') : t('Invoice lines')}</h3>
                <span>
                  {draft.calculationPolicy
                    ? t('EUR · exact fixed policy')
                    : t('EUR · VAT rounded per line')}
                </span>
              </div>
              <div className="editor-lines">
                {draft.lines.map((line, index) => (
                  <div
                    className={
                      draft.calculationPolicy ? 'editor-line policy-editor-line' : 'editor-line'
                    }
                    key={line.calculation?.lineId ?? index}
                  >
                    <label>
                      {t('Description')}
                      <input
                        aria-label={t('Line {n} description', { n: index + 1 })}
                        required
                        maxLength={500}
                        value={line.description}
                        onChange={(e) => setLine(index, { description: e.target.value })}
                        placeholder={t('What is this for?')}
                      />
                    </label>
                    <label>
                      {t('Account code')}
                      <input
                        aria-label={`${t('Line account')} ${index + 1}`}
                        required
                        maxLength={12}
                        value={line.accountCode}
                        onChange={(event) => setLine(index, { accountCode: event.target.value })}
                      />
                    </label>
                    {draft.calculationPolicy ? (
                      <div className="form-grid" style={{ gridColumn: '1 / -2' }}>
                        <label>
                          {t('Quantity (up to 4 decimals)')}
                          <input
                            aria-label={t('Line {n} quantity', { n: index + 1 })}
                            required
                            inputMode="decimal"
                            value={policyLines[index].quantity.text}
                            onChange={(event) =>
                              setPolicyLine(index, {
                                quantity: { text: event.target.value, locale },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t('Unit price (up to 4 decimals)')}
                          <input
                            aria-label={t('Line {n} unit price', { n: index + 1 })}
                            required
                            inputMode="decimal"
                            value={policyLines[index].unitPrice.text}
                            onChange={(event) =>
                              setPolicyLine(index, {
                                unitPrice: { text: event.target.value, locale },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t('Fixed line discount (up to 4 decimals)')}
                          <input
                            aria-label={t('Line {n} fixed discount', { n: index + 1 })}
                            required
                            inputMode="decimal"
                            value={policyLines[index].fixedDiscount.text}
                            onChange={(event) =>
                              setPolicyLine(index, {
                                fixedDiscount: { text: event.target.value, locale },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t('Tax rate (%)')}
                          <input
                            aria-label={t('Line {n} VAT', { n: index + 1 })}
                            required
                            inputMode="decimal"
                            value={policyLines[index].taxRate.text}
                            onChange={(event) =>
                              setPolicyLine(index, {
                                taxRate: { text: event.target.value, locale },
                              })
                            }
                          />
                          <small>
                            {t('Rates accept exact basis-point values; no rounding is applied.')}
                          </small>
                        </label>
                        {policyLines[index].percentageDiscounts.map((rate, rateIndex) => (
                          <label key={rateIndex}>
                            {t('Percentage discount {n}', { n: rateIndex + 1 })}
                            <span className="input-suffix">
                              <input
                                aria-label={t('Line {n} percentage discount {m}', {
                                  n: index + 1,
                                  m: rateIndex + 1,
                                })}
                                required
                                inputMode="decimal"
                                value={rate.text}
                                onChange={(event) =>
                                  setPolicyLine(index, {
                                    percentageDiscounts: policyLines[index].percentageDiscounts.map(
                                      (value, i) =>
                                        i === rateIndex
                                          ? { text: event.target.value, locale }
                                          : value,
                                    ),
                                  })
                                }
                              />
                              <span>%</span>
                            </span>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                setPolicyLine(index, {
                                  percentageDiscounts: policyLines[
                                    index
                                  ].percentageDiscounts.filter((_, i) => i !== rateIndex),
                                })
                              }
                            >
                              {t('Remove percentage discount {n}', { n: rateIndex + 1 })}
                            </button>
                          </label>
                        ))}
                        <button
                          type="button"
                          className="text-button"
                          disabled={policyLines[index].percentageDiscounts.length >= 4}
                          onClick={() =>
                            setPolicyLine(index, {
                              percentageDiscounts: [
                                ...policyLines[index].percentageDiscounts,
                                scaledDecimalEdit('0', locale),
                              ],
                            })
                          }
                        >
                          {t('Add percentage discount')}
                        </button>
                      </div>
                    ) : (
                      <>
                        <label>
                          {t('Qty')}
                          <input
                            aria-label={t('Line {n} quantity', { n: index + 1 })}
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
                          {t('Unit price')}
                          <input
                            aria-label={t('Line {n} unit price', { n: index + 1 })}
                            required
                            inputMode="decimal"
                            value={prices[index].text}
                            onChange={(e) =>
                              setPrices((values) =>
                                values.map((value, i) =>
                                  i === index ? { text: e.target.value, locale } : value,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          {t('VAT')}
                          <select
                            aria-label={t('Line {n} VAT', { n: index + 1 })}
                            value={line.taxBps}
                            onChange={(e) => setLine(index, { taxBps: Number(e.target.value) })}
                          >
                            {[...new Set([0, 600, 1200, 2100, line.taxBps])]
                              .sort((a, b) => a - b)
                              .map((rate) => (
                                <option key={rate} value={rate}>
                                  {localePercent(rate)}
                                </option>
                              ))}
                          </select>
                        </label>
                      </>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      disabled={draft.lines.length === 1}
                      aria-label={t('Remove line {n}', { n: index + 1 })}
                      onClick={() => {
                        setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }))
                        setPrices((p) => p.filter((_, i) => i !== index))
                        setPolicyLines((values) => values.filter((_, i) => i !== index))
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
                  setPrices((p) => [...p, moneyEdit(0, locale)])
                  setPolicyLines((values) => [...values, blankPolicyLine(locale)])
                }}
              >
                <Plus />
                {t('Add a line')}
              </button>
              <div className="editor-total">
                <span>{t('Total including VAT')}</span>
                <strong>{previewValid ? money(total) : t('Check line amounts')}</strong>
              </div>
              {draft.calculationPolicy && policyPreview && (
                <>
                  <div className="editor-total">
                    <span>{t('Subtotal')}</span>
                    <strong>{money(policyPreview.netMinor)}</strong>
                  </div>
                  <div className="editor-total">
                    <span>{t('VAT')}</span>
                    <strong>{money(policyPreview.taxMinor)}</strong>
                  </div>
                  {policyPreview.taxGroups.map((group) => (
                    <p key={group.taxRateBps}>
                      {t('Tax rounding adjustment')} · {formatBasisPointPercent(group.taxRateBps)}%:{' '}
                      {money(group.roundingAdjustment)} · {t('Independent line tax')}:{' '}
                      {money(group.independentLineTax)}
                    </p>
                  ))}
                  <p>
                    {t('Line tax allocation is assigned after saving the draft.')}{' '}
                    {t('The server assigns stable line IDs when the draft is saved.')}
                  </p>
                </>
              )}
              {draft.calculationPolicy && !previewValid && (
                <p className="form-error" role="alert">
                  {messageText(previewError)}
                </p>
              )}
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
                        {t(
                          'My entered total differs from the detected total. I checked the original and confirm my entered amounts are correct.',
                        )}
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
                      {t(
                        'I checked the original, supplier, dates, EUR currency, line amounts and VAT. Save only a draft.',
                      )}
                    </span>
                  </label>
                  {review.scan.currency && review.scan.currency !== 'EUR' && (
                    <p className="form-error">
                      {t(
                        'This original uses {currency}. Multi-currency bills are not supported; do not enter its amounts as EUR.',
                        { currency: review.scan.currency },
                      )}
                    </p>
                  )}
                </>
              )}
              {(localError || error) && (
                <p className="form-error" role="alert">
                  {messageText(localError || error)}
                </p>
              )}
            </div>
          </div>
          <div className="dialog-actions">
            <span>
              <Clock />
              {t('Saved as a draft')}
            </span>
            <button type="button" className="button secondary" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={
                (Boolean(review) &&
                  (!reviewed ||
                    Boolean(review?.scan.currency && review.scan.currency !== 'EUR'))) ||
                (Boolean(draft.calculationPolicy) && !previewValid)
              }
            >
              {busy ? t('Saving…') : t('Save draft')}
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
    amount: number | string
    date: string
    reference: string
  }) => Promise<boolean>
}) {
  const [id] = useState(() => crypto.randomUUID())
  const locale = useLocale()
  const outstanding = () => BigInt(doc.calculation?.grossMinor ?? doc.total) - BigInt(doc.paid)
  const [amount, setAmount] = useState(() => moneyEdit(Number(outstanding()), locale))
  useEffect(() => {
    setAmount((value) => switchMoneyEdit(value, locale))
  }, [locale])
  const [date, setDate] = useState(today() < doc.date ? doc.date : today())
  const [reference, setReference] = useState('')
  const [localError, setLocalError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setLocalError('')
    try {
      const cents = moneyEditCents(amount)
      await onSave({
        id,
        amount: doc.calculationPolicy ? String(cents) : cents,
        date,
        reference,
      })
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }
  return (
    <Modal
      title={doc.kind === 'bill' ? t('Record vendor payment') : t('Record customer payment')}
      onClose={onClose}
    >
      <form {...localizedValidation} onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className="dialog-body">
            <p className="dialog-intro">
              {t('Outstanding for')} <strong>{doc.partner}</strong>:{' '}
              <strong>{money(outstanding())}</strong>
            </p>
            <div className="form-grid">
              <label>
                {t('Amount (EUR)')}
                <input
                  autoFocus
                  required
                  inputMode="decimal"
                  value={amount.text}
                  onChange={(e) => setAmount({ text: e.target.value, locale })}
                />
              </label>
              <label>
                {t('Payment date')}
                <input
                  required
                  type="date"
                  min={doc.date}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="full-width">
                {t('Payment reference')}
                <input
                  maxLength={300}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={t('Bank transfer reference')}
                />
              </label>
            </div>
            <div className="info-note">
              <ShieldCheck />
              {t('This records a payment in your books. It does not initiate a bank transfer.')}
            </div>
            {(localError || error) && (
              <p className="form-error" role="alert">
                {messageText(localError || error)}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button type="submit" className="button primary">
              {busy ? t('Recording…') : t('Record payment')}
              <Check />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
