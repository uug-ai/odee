import { chromium, request, test, expect } from '@playwright/test'
import { createLocalTransport } from './local-transport.mjs'
import { nl } from '../src/locales/nl'
import type { Document, State, PublishedConfiguration } from '../src/types'

for (const locale of ['en', 'nl'] as const) {
  test(`protected ${locale}: complete configuration and frozen financial meaning lifecycle`, async () => {
    const origin = process.env.ODEE_CONFIGURATION_TEST_ORIGIN,
      token = process.env.ODEE_CONFIGURATION_TEST_TOKEN
    expect(origin, 'Owned origin is mandatory').toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(token).toBeTruthy()
    const transport = await createLocalTransport([origin!])
    const browser = await transport.launch(chromium)
    const context = await browser.newContext({
      proxy: transport.proxy,
      serviceWorkers: 'block',
      viewport: { width: 1100, height: 800 },
    })
    await context.route('https://fonts.googleapis.com/**', (r) =>
      r.fulfill({ contentType: 'text/css', body: '/* offline */' }),
    )
    const api = await request.newContext({ proxy: transport.proxy })
    const l = (key: keyof typeof nl) => (locale === 'en' ? key : nl[key])
    try {
      const call = async <T>(
        path: string,
        method = 'GET',
        data?: unknown,
        status = 200,
      ): Promise<T> => {
        const response = await transport.fetch(api, `${origin}/api/${path}`, {
          method,
          data,
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: origin!,
            'Content-Type': 'application/json',
          },
        })
        expect(response.status(), await response.text()).toBe(status)
        return response.json()
      }
      const state = () => call<State>('state')
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript((locale) => localStorage.setItem('odee.locale', locale), locale)
      await page.goto(`${origin}/accounting/accounts`)
      await page.getByLabel(l('Company access token'), { exact: true }).fill(token!)
      await page.getByRole('button', { name: l('Open workspace'), exact: true }).click()
      await expect(
        page.getByRole('heading', { name: l('Accounting configuration'), exact: true }),
      ).toBeVisible()
      const current = (await state()).configuration!
      // Start each locale from the explicit synthetic starter chart, not prior
      // test defaults. Exercise actual editable controls and normal save/publish.
      if (locale === 'nl') {
        const starter = structuredClone(current.stage.data)
        for (const a of starter.accounts) {
          if (a.code === '1010') a.code = '1000'
          if (a.code === '1110') a.code = '1100'
        }
        starter.accounts = starter.accounts.filter((a) => a.name !== 'Different V2 expense meaning')
        starter.mappings.bank = '1000'
        starter.mappings.receivable = '1100'
        await call('accounting-configuration/stage', 'PUT', {
          expectedStageVersion: current.stage.version,
          data: starter,
        })
      }
      let releaseRefresh!: () => void
      let refreshRequested!: () => void
      const heldRefresh = new Promise<void>((resolve) => (releaseRefresh = resolve))
      const refreshStarted = new Promise<void>((resolve) => (refreshRequested = resolve))
      await page.route(
        '**/api/state',
        async (route) => {
          refreshRequested()
          await heldRefresh
          await route.continue()
        },
        { times: 1 },
      )
      try {
        await page.getByRole('button', { name: l('Refresh workspace'), exact: true }).click()
        await refreshStarted
        await expect(
          page.getByRole('button', { name: l('Save stage'), exact: true }),
        ).toBeDisabled()
        await expect(
          page.getByRole('button', { name: l('Publish observed stage'), exact: true }),
        ).toBeDisabled()
        await expect(page.getByLabel(`${l('Account code')} 1`, { exact: true })).toBeDisabled()
        for (const button of await page
          .getByRole('button', { name: new RegExp(`^${l('Make default')} `) })
          .all()) {
          await expect(button).toBeDisabled()
        }
      } finally {
        releaseRefresh()
      }
      const refreshed = (await state()).configuration!
      await page.getByRole('button', { name: l('Save stage'), exact: true }).click()
      await expect(page.getByRole('status')).toContainText(l('Configuration stage saved.'))
      const saved = (await state()).configuration!
      expect(saved.stage.version).toBe(refreshed.stage.version + 1)
      expect(saved.stage.data).toEqual({
        ...refreshed.stage.data,
        journals: [...refreshed.stage.data.journals].sort((a, b) => a.code.localeCompare(b.code)),
      })
      await expect(page.getByRole('alert')).toHaveCount(0)
      await page.getByRole('button', { name: l('Publish observed stage'), exact: true }).click()
      await expect(page.getByRole('status')).toContainText(l('Configuration published.'))
      const list = await call<{ items: PublishedConfiguration[] }>(
        'accounting-configuration/versions',
      )
      const v1 = list.items[0]
      await page.getByRole('button', { name: `${l('Make default')} ${v1.id}`, exact: true }).click()
      await expect(page.getByRole('status')).toContainText(l('Default configuration changed.'))
      await page.getByRole('button', { name: new RegExp(`^${l('Invoices')}(?: \\d+)?$`) }).click()
      await page.getByRole('button', { name: l('New invoice'), exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog
        .getByLabel(l('Customer name'), { exact: true })
        .fill(`Config ${locale} V1 invoice`)
      await dialog
        .getByLabel(l('Line {n} description').replace('{n}', '1'), { exact: true })
        .fill('Synthetic net 200')
      await dialog
        .getByLabel(l('Line {n} unit price').replace('{n}', '1'), { exact: true })
        .fill(locale === 'en' ? '200.00' : '200,00')
      await dialog.getByRole('button', { name: l('Save draft'), exact: true }).click()
      await expect(dialog).toBeHidden()
      let invoice = (await state()).documents.find(
        (d) => d.partner === `Config ${locale} V1 invoice`,
      )!
      expect(invoice.configurationSelection?.versionId).toBe(v1.id)
      await page.getByRole('button', { name: l('Choose published version'), exact: true }).click()
      await page.getByLabel(l('Published target'), { exact: true }).selectOption(v1.id)
      await page.getByRole('button', { name: l('Confirm explicit rebind'), exact: true }).click()
      await expect
        .poll(async () => (await state()).documents.find((d) => d.id === invoice.id)!.version)
        .toBe(2)
      invoice = (await state()).documents.find((d) => d.id === invoice.id)!
      const bill = await call<Document>(
        'documents',
        'POST',
        {
          kind: 'bill',
          partner: `Config ${locale} V1 bill`,
          email: '',
          reference: '',
          date: invoice.date,
          dueDate: invoice.dueDate,
          lines: [
            {
              description: 'Synthetic expense',
              quantity: 1,
              unitCents: 20000,
              taxBps: 2100,
              accountCode: '5000',
            },
          ],
        },
        201,
      )
      await page.getByRole('button', { name: l('Chart of accounts'), exact: true }).click()
      const view = (await state()).configuration!
      for (const [index, a] of view.stage.data.accounts.entries()) {
        if (a.code === '1000')
          await page.getByLabel(`${l('Account code')} ${index + 1}`, { exact: true }).fill('1010')
        if (a.code === '1100')
          await page.getByLabel(`${l('Account code')} ${index + 1}`, { exact: true }).fill('1110')
        if (a.code === '4000')
          await page
            .getByLabel(`${l('Account name')} ${index + 1}`, { exact: true })
            .fill('Synthetic V2 revenue meaning')
      }
      await page.getByLabel(`${l('Mapping')}: ${l('Bank')}`, { exact: true }).selectOption('1010')
      await page
        .getByLabel(`${l('Mapping')}: ${l('Accounts receivable')}`, { exact: true })
        .selectOption('1110')
      await page.getByRole('button', { name: l('Save stage'), exact: true }).click()
      await expect(page.getByRole('status')).toContainText(l('Configuration stage saved.'))
      await page.getByRole('button', { name: l('Publish observed stage'), exact: true }).click()
      await expect(page.getByRole('status')).toContainText(l('Configuration published.'))
      const v2 = (
        await call<{ items: PublishedConfiguration[] }>('accounting-configuration/versions')
      ).items[0]
      await page.getByRole('button', { name: `${l('Make default')} ${v2.id}`, exact: true }).click()
      await expect(page.getByRole('status')).toContainText(l('Default configuration changed.'))
      for (const doc of [invoice, bill]) {
        await page
          .getByRole('button', {
            name: new RegExp(`^${l(doc.kind === 'invoice' ? 'Invoices' : 'Bills')}(?: \\d+)?$`),
          })
          .click()
        await page.getByRole('button', { name: doc.partner, exact: true }).click()
        await page.getByRole('button', { name: l('Post document'), exact: true }).click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: l('Confirm posting'), exact: true })
          .click()
        await expect(page.getByRole('dialog')).toBeHidden()
        await page.getByRole('button', { name: l('Record payment'), exact: true }).click()
        await page
          .getByRole('dialog')
          .getByLabel(l('Amount (EUR)'), { exact: true })
          .fill(locale === 'en' ? '100.00' : '100,00')
        await page
          .getByRole('dialog')
          .getByRole('button', { name: l('Record payment'), exact: true })
          .click()
        await expect(page.getByRole('dialog')).toBeHidden()
        const paid = (await state()).documents.find((d) => d.id === doc.id)!
        expect(paid.total - paid.paid).toBe(14200)
        expect(paid.financialSnapshot?.selection.versionId).toBe(v1.id)
        expect(paid.payments[0].entries).toEqual(
          doc.kind === 'invoice'
            ? [
                { accountCode: '1000', debit: 10000, credit: 0 },
                { accountCode: '1100', debit: 0, credit: 10000 },
              ]
            : [
                { accountCode: '2000', debit: 10000, credit: 0 },
                { accountCode: '1000', debit: 0, credit: 10000 },
              ],
        )
      }
      await page.getByRole('button', { name: l('Trial balance'), exact: true }).click()
      await expect(page.getByRole('table')).toContainText(v1.id)
      await page.setViewportSize({ width: 390, height: 844 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      expect(errors).toEqual([])
    } finally {
      await api.dispose()
      await context.close()
      await browser.close()
      await transport.close()
    }
  })
}
test('read-only: configuration and denied writes retain authenticated state in EN/NL', async () => {
  const origin = process.env.ODEE_CONFIGURATION_TEST_ORIGIN!,
    token = process.env.ODEE_CONFIGURATION_TEST_TOKEN!
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  const transport = await createLocalTransport([origin])
  const browser = await transport.launch(chromium)
  const api = await request.newContext({ proxy: transport.proxy })
  try {
    for (const locale of ['en', 'nl'] as const) {
      const context = await browser.newContext({ proxy: transport.proxy, serviceWorkers: 'block' })
      await context.route('https://fonts.googleapis.com/**', (r) =>
        r.fulfill({ contentType: 'text/css', body: '/* offline */' }),
      )
      const page = await context.newPage()
      await page.addInitScript((locale) => localStorage.setItem('odee.locale', locale), locale)
      const l = (key: keyof typeof nl) => (locale === 'en' ? key : nl[key])
      await page.goto(`${origin}/accounting/accounts`)
      await page.getByLabel(l('Company access token'), { exact: true }).fill(token)
      await page.getByRole('button', { name: l('Open workspace'), exact: true }).click()
      await expect(page.getByRole('button', { name: l('Save stage'), exact: true })).toBeDisabled()
      const denied = await transport.fetch(api, `${origin}/api/accounting-configuration/activate`, {
        method: 'POST',
        data: {},
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
      })
      expect(denied.status()).toBe(403)
      await page.getByRole('button', { name: l('Refresh workspace'), exact: true }).click()
      await expect(
        page.getByRole('heading', { name: l('Accounting configuration'), exact: true }),
      ).toBeVisible()
      await expect(page.getByLabel(l('Company access token'), { exact: true })).toHaveCount(0)
      await context.close()
    }
  } finally {
    await api.dispose()
    await browser.close()
    await transport.close()
  }
})
