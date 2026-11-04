import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { nl } from '../src/locales/nl'
import type { Document, Draft, State } from '../src/types'

for (const locale of ['en', 'nl'] as const) {
  const l = (key: keyof typeof nl, values: Record<string, string | number> = {}) => {
    const text = locale === 'en' ? key : nl[key]
    return text.replace(/\{([^}]+)\}/g, (_match, name: string) => String(values[name]))
  }
  const decimal = (en: string, dutch: string) => (locale === 'en' ? en : dutch)
  const money = (en: string, dutch: string) => (locale === 'en' ? en : dutch)

  test(`${locale}: orphaned policy lines and server meaning errors remain unresolved`, async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('An isolated fixture origin is required')
    const partner = `Unresolved ${locale} ${randomUUID()}`
    const created = await page.request.post('/api/documents', {
      headers: { Origin: new URL(baseURL).origin },
      data: {
        kind: 'invoice',
        partner,
        email: '',
        reference: '',
        date: '2026-11-03',
        dueDate: '2026-12-03',
        calculationPolicy: {
          policyId: 'exact-fixed-v1',
          schemaVersion: 1,
          currency: 'EUR',
          currencyExponent: 2,
        },
        lines: [
          {
            description: 'Preserved policy line',
            accountCode: '4000',
            calculation: {
              quantityUnits: '3334',
              unitPriceUnits: '15000',
              fixedDiscountUnits: '0',
              percentageDiscountBps: [],
              taxRateBps: '2100',
            },
          },
        ],
      },
    })
    expect(created.status()).toBe(201)
    const draft: Document = await created.json()
    const postedResponse = await page.request.post(`/api/documents/${draft.id}/post`, {
      headers: { Origin: new URL(baseURL).origin },
      data: { version: draft.version },
    })
    expect(postedResponse.status()).toBe(200)
    const posted: Document = await postedResponse.json()
    const before: State = await (await page.request.get('/api/state')).json()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes(`/api/documents/${draft.id}`))
        writes.push(request.url())
    })
    await page.addInitScript((value) => localStorage.setItem('odee.locale', value), locale)

    for (const source of [draft, posted]) {
      for (const history of ['orphaned-lines', 'server-error', 'meaning-error-only'] as const) {
        const malformed = structuredClone(source)
        if (history === 'orphaned-lines') {
          delete malformed.calculationPolicy
          delete malformed.calculation
          expect(malformed.lines[0].calculation).toBeDefined()
        } else {
          malformed.meaningError = 'calculation policy history is unresolved'
          if (history === 'meaning-error-only') {
            delete malformed.calculationPolicy
            delete malformed.calculation
            malformed.lines.forEach((line) => delete line.calculation)
          }
        }
        await page.route('**/api/state', async (route) => {
          const response = await route.fetch()
          const state: State = await response.json()
          state.documents = state.documents.map((doc) =>
            doc.id === malformed.id ? malformed : doc,
          )
          await route.fulfill({ response, json: state })
        })
        await page.goto('/accounting/invoices')
        await page.getByRole('button', { name: partner, exact: true }).click()
        await expect(page.getByRole('alert')).toContainText(
          l('Calculation policy history is unresolved.'),
        )
        const cells = page.getByRole('table').first().locator('tbody td.numeric')
        await expect(cells).toHaveText(['—', '—', '—', '—'])
        const totals = page.locator('.detail-totals strong')
        await expect(totals.nth(0)).toHaveText('—')
        await expect(totals.nth(1)).toHaveText('—')
        await expect(totals.nth(2)).toHaveText('—')
        if (source.status === 'draft') {
          await expect(
            page.getByRole('button', { name: l('Edit draft'), exact: true }),
          ).toBeDisabled()
          await expect(
            page.getByRole('button', { name: l('Post document'), exact: true }),
          ).toBeDisabled()
        } else {
          await expect(totals.nth(4)).toHaveText('—')
          await expect(
            page.getByRole('button', { name: l('Record payment'), exact: true }),
          ).toBeDisabled()
        }
        await page.unroute('**/api/state')
      }
    }
    expect(writes).toEqual([])
    expect(errors).toEqual([])
    const after: State = await (await page.request.get('/api/state')).json()
    expect(after.documents.find((doc) => doc.id === draft.id)).toEqual(
      before.documents.find((doc) => doc.id === draft.id),
    )
  })

  test(`${locale}: exact-policy save, reload, post, payment, and legacy compatibility`, async ({
    page,
  }) => {
    const runId = randomUUID()
    const exactName = `Exact ${locale} ${runId}`
    const legacyName = `Legacy ${locale} ${runId}`
    const readOnlyName = `Read-only ${locale} ${runId}`
    const updates: Array<Draft & { version: number }> = []
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      if (request.method() === 'PUT' && /\/api\/documents\/[^/]+$/.test(request.url())) {
        const body: unknown = request.postDataJSON()
        if (typeof body === 'object' && body !== null && 'lines' in body)
          updates.push(body as Draft & { version: number })
      }
    })
    await page.addInitScript((value) => localStorage.setItem('odee.locale', value), locale)
    await page.goto('/')
    await page.getByRole('button', { name: new RegExp(l('Open accounting')) }).click()
    await expect(page.getByRole('heading', { name: l('Dashboard'), exact: true })).toBeVisible()
    await page
      .getByRole('navigation', { name: l('Accounting navigation') })
      .getByRole('button', { name: new RegExp(`^${l('Invoices')}`) })
      .click()
    await page.getByRole('button', { name: l('New invoice'), exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(l('Use exact fixed calculation policy')).check()
    await dialog.getByLabel(l('Customer name')).fill(exactName)
    await dialog.getByLabel(l('Line {n} description', { n: 1 })).fill('Fractional service')
    await dialog.getByLabel(l('Line {n} quantity', { n: 1 })).fill(decimal('0.3334', '0,3334'))
    await dialog.getByLabel(l('Line {n} unit price', { n: 1 })).fill(decimal('1.5000', '1,5000'))
    await dialog
      .getByLabel(l('Line {n} fixed discount', { n: 1 }))
      .fill(decimal('0.1000', '0,1000'))
    await dialog.getByLabel(l('Line {n} VAT', { n: 1 })).fill('21')
    await dialog.getByRole('button', { name: l('Add percentage discount') }).click()
    await dialog
      .getByLabel(l('Line {n} percentage discount {m}', { n: 1, m: 1 }))
      .fill(decimal('10.0000', '10,0000'))
    await dialog.getByRole('button', { name: l('Add percentage discount') }).click()
    await dialog
      .getByLabel(l('Line {n} percentage discount {m}', { n: 1, m: 2 }))
      .fill(decimal('5.0000', '5,0000'))
    await expect(dialog.getByText(money('€0.41', '€ 0,41'), { exact: true })).toBeVisible()
    await expect(dialog.getByText(money('€0.34', '€ 0,34'), { exact: true })).toBeVisible()
    await expect(dialog.getByText(money('€0.07', '€ 0,07'), { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: l('Save draft'), exact: true }).click()
    await expect(dialog).toHaveCount(0)

    async function storedDocument() {
      const response = await page.request.get('/api/state')
      expect(response.status()).toBe(200)
      const state: State = await response.json()
      return state.documents.find((item) => item.partner === exactName)!
    }

    let document = await storedDocument()
    expect(document.calculationPolicy).toEqual({
      policyId: 'exact-fixed-v1',
      schemaVersion: 1,
      currency: 'EUR',
      currencyExponent: 2,
    })
    expect(document.calculation).toMatchObject({
      netMinor: '34',
      taxMinor: '7',
      grossMinor: '41',
      lines: [
        {
          netMinor: '34',
          taxMinor: '7',
          grossMinor: '41',
          netRoundingResidue: { numerator: '-4171', denominator: '20000' },
        },
      ],
    })
    const lineId = document.lines[0].calculation?.lineId
    expect(lineId).toMatch(/^[a-f\d]{24}$/)

    await page.getByRole('button', { name: l('Edit draft'), exact: true }).click()
    const edit = page.getByRole('dialog')
    await expect(edit.getByLabel(l('Line {n} quantity', { n: 1 }))).toHaveValue(
      decimal('0.3334', '0,3334'),
    )
    await edit.getByRole('button', { name: l('Save draft'), exact: true }).click()
    await expect(edit).toHaveCount(0)
    expect(updates.at(-1)?.lines[0].calculation?.lineId).toBe(lineId)
    document = await storedDocument()
    expect(document.lines[0].calculation?.lineId).toBe(lineId)

    await page.getByRole('button', { name: l('Post document'), exact: true }).click()
    await page.getByRole('button', { name: l('Confirm posting'), exact: true }).click()
    await expect(page.getByText(l('Posted'), { exact: true })).toBeVisible()
    await page.getByRole('button', { name: l('Record payment'), exact: true }).click()
    const payment = page.getByRole('dialog')
    await expect(payment.getByLabel(l('Amount (EUR)'))).toHaveValue(decimal('0.41', '0,41'))
    await payment.getByRole('button', { name: l('Record payment'), exact: true }).click()
    await expect(payment).toHaveCount(0)
    document = await storedDocument()
    expect(document.status).toBe('paid')
    expect(document.paid).toBe(41)
    expect(document.payments[0].amount).toBe('41')

    await page.reload()
    await page.getByRole('button', { name: exactName, exact: true }).click()
    await expect(page.getByRole('heading', { name: exactName })).toBeVisible()
    await expect(page.getByRole('table').first()).toContainText(money('€0.41', '€ 0,41'))
    expect(pageErrors).toEqual([])

    await page
      .getByRole('navigation', { name: l('Accounting navigation') })
      .getByRole('button', { name: new RegExp(`^${l('Invoices')}`) })
      .click()
    await page.getByRole('button', { name: l('New invoice'), exact: true }).click()
    const legacy = page.getByRole('dialog')
    await legacy.getByLabel(l('Customer name')).fill(legacyName)
    await legacy.getByLabel(l('Line {n} description', { n: 1 })).fill('Legacy service')
    await legacy.getByLabel(l('Line {n} unit price', { n: 1 })).fill(decimal('12.34', '12,34'))
    await legacy.getByRole('button', { name: l('Save draft'), exact: true }).click()
    await expect(legacy).toHaveCount(0)
    const legacyDocument = await storedDocument()
    expect(legacyDocument.partner).toBe(exactName)
    const response = await page.request.get('/api/state')
    const state: State = await response.json()
    const savedLegacy = state.documents.find((item: Document) => item.partner === legacyName)!
    expect(savedLegacy.calculationPolicy).toBeUndefined()
    expect(savedLegacy.lines[0]).toMatchObject({ quantity: 1, unitCents: 1234, taxBps: 2100 })

    await page
      .getByRole('navigation', { name: l('Accounting navigation') })
      .getByRole('button', { name: new RegExp(`^${l('Invoices')}`) })
      .click()
    await page.getByRole('button', { name: l('New invoice'), exact: true }).click()
    const readOnlyDraft = page.getByRole('dialog')
    await readOnlyDraft.getByLabel(l('Use exact fixed calculation policy')).check()
    await readOnlyDraft.getByLabel(l('Customer name')).fill(readOnlyName)
    await readOnlyDraft.getByLabel(l('Line {n} description', { n: 1 })).fill('Policy service')
    await readOnlyDraft
      .getByLabel(l('Line {n} unit price', { n: 1 }))
      .fill(decimal('10.00', '10,00'))
    await readOnlyDraft.getByRole('button', { name: l('Save draft'), exact: true }).click()
    await expect(readOnlyDraft).toHaveCount(0)
    await page.route('**/api/session', async (route) => {
      const response = await route.fetch()
      const session = await response.json()
      session.authenticated = true
      session.access = {
        principal: 'token:synthetic',
        authorizationMode: 'enforced',
        companyId: 'synthetic',
        member: true,
        capabilities: ['read'],
      }
      await route.fulfill({ response, json: session })
    })
    await page.reload()
    await page.getByRole('button', { name: readOnlyName, exact: true }).click()
    await expect(page.getByRole('heading', { name: readOnlyName })).toBeVisible()
    await expect(page.getByRole('button', { name: l('Edit draft'), exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: l('Post document'), exact: true })).toBeDisabled()
  })
}
