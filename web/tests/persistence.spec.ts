import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Entry, State } from '../src/types'

const run = process.env.ODEE_TEST_PERSISTENCE_RUN
const token = process.env.ODEE_API_TOKEN
const phase = process.env.ODEE_TEST_PERSISTENCE_PHASE
const scratch = process.env.ODEE_TEST_SCRATCH_DIR
if (!run || !token || !scratch || (phase !== 'write' && phase !== 'read')) {
  throw new Error('Persistence tests require the isolated persistence runner')
}
const contactName = `Synthetic persistence ${run}`
const reference = `SYNTHETIC-${run}`
const paymentReference = `MANUAL-${run}`
const snapshotPath = resolve(scratch, 'synthetic-identities.json')

interface Identities {
  contact: string
  document: string
  payment: string
  number: string
}

async function openWorkspace(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your books, protected.' })).toBeVisible()
  // Avoid recording a fill action containing the token in failure call logs.
  await page.getByLabel('Company access token').evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) throw new Error('Password input has no native value setter')
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, token)
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await page.getByRole('button', { name: /Open contacts/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible()
}

function assertBalanced(entries: Entry[]) {
  expect(entries.length).toBeGreaterThan(1)
  for (const entry of entries) {
    expect(Number.isSafeInteger(entry.debit) && entry.debit >= 0).toBe(true)
    expect(Number.isSafeInteger(entry.credit) && entry.credit >= 0).toBe(true)
  }
  expect(entries.reduce((sum, entry) => sum + entry.debit - entry.credit, 0)).toBe(0)
}

async function storedState(baseURL: string) {
  // Native fetch does not add credential-bearing request headers to Playwright
  // failure call logs or error-context artifacts.
  return fetch(`${baseURL}/api/state`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  })
}

async function assertStoredState(baseURL: string): Promise<Identities> {
  const response = await storedState(baseURL)
  expect(response.status).toBe(200)
  const state: State = await response.json()
  expect(state.demo).toBe(false)
  expect(state.development).toBe(false)
  expect(state.currency).toBe('EUR')
  expect(state.contacts).toHaveLength(1)
  expect(state.documents).toHaveLength(1)
  const contact = state.contacts[0]
  expect(contact.name).toBe(contactName)
  expect(contact.email).toBe('persistence@example.invalid')
  expect(contact.customer).toBe(true)
  const document = state.documents[0]
  expect(document.partner).toBe(contactName)
  expect(document.reference).toBe(reference)
  expect(document.currency).toBe('EUR')
  expect(document.status).toBe('posted')
  expect(document.subtotal).toBe(20000)
  expect(document.tax).toBe(4200)
  expect(document.total).toBe(24200)
  expect(document.paid).toBe(10000)
  expect(document.total - document.paid).toBe(14200)
  expect(document.payments).toHaveLength(1)
  const payment = document.payments[0]
  expect(payment.amount).toBe(10000)
  expect(payment.reference).toBe(paymentReference)
  assertBalanced(document.entries)
  assertBalanced(payment.entries)
  const entries = [...document.entries, ...payment.entries]
  assertBalanced(entries)
  // Calculate independently from persisted entries, not the UI's ledger helper.
  expect(
    entries
      .filter((entry) => entry.accountCode === '1100')
      .reduce((sum, entry) => sum + entry.debit - entry.credit, 0),
  ).toBe(14200)
  return {
    contact: contact.id,
    document: document.id,
    payment: payment.id,
    number: document.number,
  }
}

test(`${phase}: real authenticated browser accounting survives an app restart`, async ({
  page,
  playwright,
  baseURL,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  if (!baseURL) throw new Error('Persistence requires an isolated baseURL')
  const unauthenticated = await playwright.request.newContext({ baseURL })
  try {
    for (const path of ['/api/state', '/api/contacts']) {
      expect((await unauthenticated.get(path)).status()).toBe(401)
      expect(
        (
          await unauthenticated.get(path, { headers: { Authorization: 'Bearer invalid' } })
        ).status(),
      ).toBe(401)
    }
    expect(
      (
        await unauthenticated.post('/api/documents', {
          headers: { Origin: new URL(baseURL).origin },
          data: {},
        })
      ).status(),
    ).toBe(401)
    if (phase === 'write') {
      const initial: State = await (await storedState(baseURL)).json()
      expect(initial.documents).toEqual([])
      expect(initial.contacts).toEqual([])
    }
    await openWorkspace(page)
    if (phase === 'write') {
      await page.getByRole('button', { name: 'New contact' }).click()
      let dialog = page.getByRole('dialog')
      await dialog.getByLabel('Name', { exact: true }).fill(contactName)
      await dialog.getByLabel('Email', { exact: true }).fill('persistence@example.invalid')
      await dialog.getByRole('checkbox', { name: 'Customer', exact: true }).check()
      await dialog.getByRole('button', { name: 'Save contact' }).click()
      await expect(dialog.getByRole('heading', { name: contactName })).toBeVisible()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await page
        .getByRole('navigation')
        .getByRole('button', { name: /^Invoices/ })
        .click()
      await page.getByRole('button', { name: 'New invoice', exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog
        .getByLabel('Choose a saved contact')
        .selectOption({ label: `${contactName} · persistence@example.invalid` })
      await expect(dialog.getByLabel('Customer name')).toHaveValue(contactName)
      await dialog.getByLabel('Reference', { exact: false }).fill(reference)
      await dialog.getByLabel('Line 1 description').fill('Synthetic persistence services')
      await dialog.getByLabel('Line 1 quantity').fill('2')
      await dialog.getByLabel('Line 1 unit price').fill('100.00')
      await dialog.getByLabel('Line 1 VAT').selectOption('2100')
      await dialog.getByRole('button', { name: 'Save draft' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1, name: contactName })).toBeVisible()
      await expect(page.locator('.detail-totals .grand-total')).toContainText('€242.00')
      await page.getByRole('button', { name: 'Post document' }).click()
      await page.getByRole('button', { name: 'Confirm posting' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('button', { name: 'Record payment', exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByLabel('Amount (EUR)').fill('100.00')
      await dialog.getByLabel('Payment reference').fill(paymentReference)
      await dialog.getByRole('button', { name: 'Record payment', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    } else {
      await page.getByRole('button', { name: `Open contact ${contactName}`, exact: true }).click()
      await expect(page.getByRole('dialog')).toContainText('persistence@example.invalid')
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
      await page
        .getByRole('navigation')
        .getByRole('button', { name: /^Invoices/ })
        .click()
      await page.getByRole('button', { name: contactName, exact: true }).click()
    }
    await expect(page.locator('.detail-totals').getByText('€242.00', { exact: true })).toBeVisible()
    await expect(page.locator('.detail-totals').getByText('€100.00', { exact: true })).toBeVisible()
    await expect(
      page.locator('.detail-totals .grand-total').filter({ hasText: 'Amount due' }),
    ).toContainText('€142.00')
    await expect(page.getByRole('table').filter({ hasText: paymentReference })).toContainText(
      '€100.00',
    )
    const identities = await assertStoredState(baseURL)
    if (phase === 'write') {
      await writeFile(snapshotPath, JSON.stringify(identities), { flag: 'wx', mode: 0o600 })
    } else {
      const original: Identities = JSON.parse(await readFile(snapshotPath, 'utf8'))
      expect(identities).toEqual(original)
    }
    await page.getByRole('button', { name: 'Journal entries', exact: true }).click()
    await expect(page.getByRole('table')).toContainText(paymentReference)
    await page.getByRole('button', { name: 'Trial balance', exact: true }).click()
    const receivable = page.getByRole('row').filter({ hasText: 'Accounts receivable' })
    await expect(receivable.getByRole('cell').last()).toHaveText('€142.00')
    await expect(page.locator('tfoot td').nth(1)).toHaveText('€342.00')
    await expect(page.locator('tfoot td').nth(2)).toHaveText('€342.00')
    await expect(page.locator('tfoot td').last()).toHaveText('€0.00')
    expect(errors).toEqual([])
  } finally {
    await unauthenticated.dispose()
  }
})
