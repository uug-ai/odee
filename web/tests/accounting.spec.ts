import { expect, test, type Page } from '@playwright/test'

async function create(
  page: Page,
  kind: 'invoice' | 'bill',
  partner: string,
  price: string,
  quantity = '1',
) {
  await page
    .getByRole('navigation', { name: 'Accounting navigation' })
    .getByRole('button', { name: kind === 'bill' ? /^Bills$/ : /^Invoices/ })
    .click()
  await page
    .getByRole('button', { name: kind === 'bill' ? 'New bill' : 'New invoice', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(kind === 'bill' ? 'Vendor name' : 'Customer name').fill(partner)
  await dialog.getByLabel('Line 1 description').fill('Example services')
  await dialog.getByLabel('Line 1 quantity').fill(quantity)
  await dialog.getByLabel('Line 1 unit price').fill(price)
  await dialog.getByRole('button', { name: 'Save draft' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: partner })).toBeVisible()
  await expect(page.getByText('Draft', { exact: true })).toBeVisible()
}

test('create, edit, post, pay, report, and refresh invoices and bills', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: /Open accounting/ }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await create(page, 'invoice', 'Example customer', '100.00', '2')
  await page.getByRole('button', { name: 'Edit draft' }).click()
  await page.getByRole('dialog').getByLabel('Reference', { exact: false }).fill('PO-TEST-001')
  await page.getByRole('dialog').getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('PO-TEST-001')).toBeVisible()
  await page.getByRole('button', { name: 'Post document' }).click()
  await page.getByRole('button', { name: 'Confirm posting' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Posted', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit draft' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Record payment', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Amount (EUR)').fill('300.00')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record payment', exact: true })
    .click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('cannot exceed')
  await page.getByRole('dialog').getByLabel('Amount (EUR)').fill('100.00')
  await page.getByRole('dialog').getByLabel('Payment reference').fill('EXAMPLE-TRANSFER')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record payment', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Partial', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Record payment', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record payment', exact: true })
    .click()
  await expect(page.getByText('Fully paid')).toBeVisible()
  await create(page, 'bill', 'Example vendor', '50.00')
  await page.getByRole('button', { name: 'Post document' }).click()
  await page.getByRole('button', { name: 'Confirm posting' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Record payment', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record payment', exact: true })
    .click()
  await expect(page.getByText('Fully paid')).toBeVisible()
  await page.getByRole('button', { name: 'Journal entries', exact: true }).click()
  await expect(page.getByRole('table')).toContainText('EXAMPLE-TRANSFER')
  await page.getByRole('button', { name: 'Trial balance', exact: true }).click()
  await expect(page.locator('tfoot')).toContainText('€605.00')
  await expect(page.locator('tfoot td').last()).toHaveText('€0.00')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toContain('odee-trial-balance')
  await page.reload()
  await expect(page).toHaveURL('/accounting/reports')
  await expect(page.getByRole('heading', { level: 1, name: 'Trial balance' })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Accounting navigation' })
    .getByRole('button', { name: /^Invoices/ })
    .click()
  await page.getByRole('textbox', { name: 'Search documents' }).fill('Example customer')
  await expect(page.getByRole('table')).toContainText('Paid')
  await page.getByRole('button', { name: 'Paid', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Example customer', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('mobile launcher, navigation, draft dialog and keyboard dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: /Open accounting/ }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'New invoice', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Chart of accounts', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Chart of accounts' })).toBeVisible()
})

test('editing an API-created draft preserves a custom VAT rate', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The accounting browser suite requires an isolated baseURL.')
  const response = await page.request.post('/api/documents', {
    headers: { Origin: new URL(baseURL).origin },
    data: {
      kind: 'invoice',
      partner: 'Custom VAT example',
      email: '',
      reference: '',
      date: '2026-11-03',
      dueDate: '2026-12-03',
      lines: [
        {
          description: 'Custom rate',
          quantity: 1,
          unitCents: 5000,
          taxBps: 700,
          accountCode: '4000',
        },
      ],
    },
  })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await page.getByRole('button', { name: /Open accounting/ }).click()
  await page
    .getByRole('navigation', { name: 'Accounting navigation' })
    .getByRole('button', { name: /^Invoices/ })
    .click()
  await page.getByRole('button', { name: 'Custom VAT example', exact: true }).click()
  await page.getByRole('button', { name: 'Edit draft' }).click()
  await expect(page.getByRole('dialog').getByLabel('Line 1 VAT')).toHaveValue('700')
  await page.getByRole('dialog').getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('table')).toContainText('7%')
  await expect(page.getByRole('table')).toContainText('€53.50')
})
