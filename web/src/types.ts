export type Kind = 'invoice' | 'bill'
export type { View } from './modules'
export interface Line {
  description: string
  quantity: number
  unitCents: number
  taxBps: number
  accountCode: string
  calculation?: PolicyLineData
}
export interface CalculationPolicyMetadata {
  policyId: string
  schemaVersion: number
  currency: string
  currencyExponent: number
}
export interface PolicyLineData {
  lineId?: string
  quantityUnits: string
  unitPriceUnits: string
  fixedDiscountUnits: string
  percentageDiscountBps: string[]
  taxRateBps: string
}
export interface CalculationLineResult {
  lineId: string
  netMinor: string
  taxMinor: string
  grossMinor: string
  netRoundingResidue: { numerator: string; denominator: string }
}
export interface CalculationTaxGroup {
  taxRateBps: string
  netMinor: string
  taxMinor: string
  independentLineTax: string
  roundingAdjustment: string
}
export interface CalculationResult {
  policyId: string
  schemaVersion: number
  currency: string
  currencyExponent: number
  netMinor: string
  taxMinor: string
  grossMinor: string
  lines: CalculationLineResult[]
  taxGroups: CalculationTaxGroup[]
}
export interface Entry {
  accountCode: string
  debit: number
  credit: number
}
export interface Payment {
  id: string
  date: string
  amount: number | string
  reference: string
  entries: Entry[]
}
export interface Draft {
  partnerAction?: 'select' | 'refresh' | 'manual'
  contactId?: string
  expectedContactVersion?: number
  ownCompanyAction?: 'refresh'
  expectedCompanyVersion?: number
  kind: Kind
  partner: string
  email: string
  reference: string
  date: string
  dueDate: string
  lines: Line[]
  calculationPolicy?: CalculationPolicyMetadata
}
export interface Document extends Draft {
  calculation?: CalculationResult
  configurationSelection?: ConfigurationSelection
  journalCode?: string
  financialSnapshot?: FinancialSnapshot
  financialMeaning?: FinancialSnapshot
  meaningError?: string
  organisationId?: string
  projectId?: string
  partnerSnapshot?: PartnerSnapshot
  ownCompanySnapshot?: CompanySnapshot
  id: string
  number: string
  version: number
  currency: string
  status: 'draft' | 'posted' | 'paid'
  subtotal: number
  tax: number
  total: number
  paid: number
  entries: Entry[]
  payments: Payment[]
  createdAt: string
  updatedAt: string
  sourceId?: string
}
export interface Account {
  code: string
  name: string
  type: string
}
export interface State {
  configuration?: ConfigurationView
  companyProfile?: CompanyProfile | null
  company: string
  currency: string
  demo: boolean
  development: boolean
  accounts: Account[]
  documents: Document[]
  imports: BillImport[]
  scannerReady: boolean
  scannerError: string
  contacts: Contact[]
}
export interface ConfigAccount extends Account {
  active: boolean
}
export interface ConfigJournal {
  code: string
  name: string
  kind: string
  active: boolean
}
export interface FiscalPeriod {
  start: string
  end: string
  active: boolean
}
export interface ConfigurationData {
  accounts: ConfigAccount[]
  mappings: Record<string, string>
  journals: ConfigJournal[]
  years: { start: string; end: string; periods: FiscalPeriod[] }[]
  note: string
}
export interface ConfigurationSelection {
  policy?: string
  versionId?: string
  digest: string
}
export interface FinancialSnapshot {
  schemaVersion: number
  selection: ConfigurationSelection
  accounts: ConfigAccount[]
  mappings: Record<string, string>
  journals: ConfigJournal[]
  period: FiscalPeriod
}
export interface PublishedConfiguration {
  id: string
  payload: {
    schemaVersion: number
    sourceStageId: string
    sourceStageVersion: number
    digest: string
    publishedAt: string
    data: ConfigurationData
  }
}
export interface ConfigurationView {
  stage: { version: number; publicationId: string; data: ConfigurationData; digest: string }
  default: { revision: number; versionId: string | null }
  readiness: Record<string, string[]>
  defaultData: ConfigurationData | null
  defaultError?: string
}
export interface Session {
  authMode: 'github' | 'token' | 'development'
  authenticated: boolean
  access?: {
    principal: string
    authorizationMode: 'compatibility' | 'enforced'
    companyId: string
    member: boolean
    capabilities: Capability[]
  }
  organisation?: string
  team?: string
  csrfToken?: string
  user?: { id: number; login: string; name: string }
}
export type Capability = 'read' | 'write' | 'post' | 'admin'
export interface FinancialEvent {
  id: string
  time: string
  actorType: 'github' | 'token' | 'development'
  principal: string
  action: 'document.post' | 'manual-payment.record'
  targetId: string
  version: number
  outcome: 'committed'
}
export interface BillImport {
  id: string
  filename: string
  contentType: string
  size: number
  sha256: string
  status: 'pending' | 'scanning' | 'ready' | 'failed' | 'draft'
  error: string
  version: number
  documentId?: string
  createdAt: string
  updatedAt: string
  scan: {
    method: string
    pages: number
    text: string
    currency: string
    subtotal: number
    tax: number
    taxKnown: boolean
    total: number
    draft: Draft
    warnings: string[]
  }
}
export interface ReviewOptions {
  reviewed: boolean
  acceptMismatch: boolean
}
export type APIRequest = <T>(path: string, body?: unknown, method?: string) => Promise<T>
export interface Journal {
  key: string
  document: Document
  date: string
  reference: string
  entries: Entry[]
  payment: boolean
}

export interface ContactData {
  enterpriseId?: string
  bankAccount?: string
  bic?: string
  paymentTerms?: string
  taxApplicability?: '' | 'unknown' | 'unsupported'
  name: string
  isCompany: boolean
  companyName: string
  email: string
  phone: string
  mobile: string
  website: string
  vat: string
  reference: string
  type: 'contact' | 'invoice' | 'delivery' | 'other' | 'private'
  address: {
    street: string
    street2: string
    postalCode: string
    city: string
    state: string
    country: string
  }
  tags: string[]
  customer: boolean
  vendor: boolean
  active: boolean
}
export interface CompanyProfile {
  id: string
  data: ContactData
  version: number
  updatedAt: string
}
export interface PartnerSnapshot {
  contactId?: string
  sourceVersion: number
  schemaVersion: number
  data: ContactData
}
export interface CompanySnapshot {
  profileId: string
  sourceVersion: number
  schemaVersion: number
  role: 'seller' | 'buyer'
  data: ContactData
}
export interface Contact extends ContactData {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  odoo?: {
    originalWebsite?: string
    origin: string
    database: string
    id: number
    parentId: number
    companyId: number
    importedAt: string
  }
}
export interface OdooContactImport {
  source: string
  database: string
  contacts: (ContactData & { externalId: number; parentId: number; companyId: number })[]
}
