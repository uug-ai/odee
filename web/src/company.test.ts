import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountingSummary, Company, blankContact } from './Company'
import { setLocale } from './i18n'
import type { State } from './types'

afterEach(() => setLocale('en'))

describe('company metadata display boundary', () => {
  for (const locale of ['en', 'nl'] as const) {
    it(`shows unassessed metadata in ${locale} without translating business data`, () => {
      setLocale(locale)
      const data = {
        ...blankContact(),
        name: 'Draft',
        bankAccount: 'Original bank text',
        paymentTerms: 'Sales revenue',
        taxApplicability: 'unsupported' as const,
      }
      const html = renderToStaticMarkup(createElement(AccountingSummary, { data }))
      expect(html).toContain('<dd>Draft</dd>')
      expect(html).toContain('<dd>Sales revenue</dd>')
      expect(html).toContain('<dd>Original bank text</dd>')
      expect(html).toContain(locale === 'nl' ? 'Onvolledig / onbekend' : 'Incomplete / unknown')
      expect(html).toContain(locale === 'nl' ? 'Niet ondersteund' : 'Unsupported')
    })
    it(`renders accessible read-only legal settings in ${locale} without manufacturing a profile`, () => {
      setLocale(locale)
      const state: State = {
        company: 'Environment display label',
        currency: 'EUR',
        demo: false,
        development: false,
        accounts: [],
        documents: [],
        imports: [],
        contacts: [],
        scannerReady: false,
        scannerError: '',
        companyProfile: null,
      }
      const html = renderToStaticMarkup(
        createElement(Company, {
          state,
          request: async () => {
            throw new Error('Rendering must not send requests')
          },
          onRefresh: async () => {},
          onStateChange: () => {},
          canAdmin: false,
        }),
      )
      expect(html).toContain('<fieldset disabled="">')
      expect(html).toContain('role="status"')
      expect(html).toContain(
        locale === 'nl' ? 'lees- en beheerdersrechten' : 'read and admin capabilities',
      )
      expect(html).toContain('value=""')
      expect(html).not.toContain('value="Environment display label"')
    })
  }
})
