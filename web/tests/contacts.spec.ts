import { expect, test } from '@playwright/test'

const company = {
  name: 'Imported Example Company',
  isCompany: true,
  companyName: '',
  email: 'shared@example.invalid',
  phone: '+32 2 000 00 00',
  mobile: '',
  website: 'https://example.invalid',
  vat: 'BE-EXAMPLE',
  reference: 'TEST',
  type: 'contact',
  address: {
    street: '1 Test Street',
    street2: '',
    postalCode: '1000',
    city: 'Brussels',
    state: '',
    country: 'Belgium',
  },
  tags: ['Synthetic'],
  customer: true,
  vendor: true,
  active: true,
  externalId: 11,
  parentId: 0,
  companyId: 1,
}
const imported = {
  source: 'https://odoo.example.invalid',
  database: 'playwright',
  contacts: [
    company,
    {
      ...company,
      externalId: 12,
      parentId: 11,
      name: 'Imported Example Person',
      isCompany: false,
      companyName: company.name,
    },
  ],
}

test('create and edit a contact, use an accounting snapshot, and archive without changing the invoice', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Open contacts/ }).click()
  await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New contact' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', { exact: true }).fill('Saved Contact Example')
  await dialog.getByLabel('Email', { exact: true }).fill('saved@example.invalid')
  await dialog.getByRole('checkbox', { name: 'Customer', exact: true }).check()
  await dialog.getByRole('button', { name: 'Save contact' }).click()
  await expect(dialog.getByRole('heading', { name: 'Saved Contact Example' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Invoices/ })
    .click()
  await page.getByRole('button', { name: 'New invoice', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Choose a saved contact')
    .selectOption({ label: 'Saved Contact Example · saved@example.invalid' })
  await expect(dialog.getByLabel('Customer name')).toHaveValue('Saved Contact Example')
  await expect(dialog.getByLabel('Email', { exact: false })).toHaveValue('saved@example.invalid')
  await dialog.getByLabel('Line 1 description').fill('Contact snapshot test')
  await dialog.getByLabel('Line 1 unit price').fill('10.00')
  await dialog.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Saved Contact Example' })).toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: 'Contacts', exact: true }).click()
  await page.getByRole('button', { name: /Saved Contact Example/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Edit contact' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', { exact: true }).fill('Updated Contact Example')
  await dialog.getByRole('checkbox', { name: /Active \(uncheck to archive\)/ }).uncheck()
  await dialog.getByRole('button', { name: 'Save contact' }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Archived', exact: true }).click()
  await expect(page.getByRole('button', { name: /Updated Contact Example/ })).toBeVisible()
  const state = await (await page.request.get('/api/state')).json()
  expect(
    state.documents.find(
      (item: { reference: string; partner: string }) => item.partner === 'Saved Contact Example',
    ).email,
  ).toBe('saved@example.invalid')
})

test('review Odoo JSON import, preserve source relationships and skip repeat copies', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Open contacts/ }).click()
  async function importFile() {
    await page.getByRole('button', { name: 'Import Odoo JSON' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Odoo contact JSON').setInputFiles({
      name: 'synthetic-contacts.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    })
    await expect(dialog.getByText('2 contacts', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Import contacts' })).toBeDisabled()
    await dialog.getByRole('checkbox', { name: /I am authorized/ }).check()
    await dialog.getByRole('button', { name: 'Import contacts' }).click()
    await expect(dialog).toHaveCount(0)
  }
  await importFile()
  await expect(page.getByRole('status')).toContainText('2 created, 0 already present')
  await page.getByRole('button', { name: /Imported Example Person/ }).click()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Imported Example Company', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Imported Example Company', exact: true })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: 'Edit contact' }).click()
  await page.getByRole('dialog').getByLabel('Phone', { exact: true }).fill('+32 2 111 11 11')
  await page.getByRole('dialog').getByRole('button', { name: 'Save contact' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await importFile()
  await expect(page.getByRole('status')).toContainText('0 created, 2 already present')
  await page.getByLabel('Search contacts').fill('+32 2 111 11 11')
  await expect(page.getByRole('button', { name: /Imported Example Company/ })).toHaveCount(1)
  await page.reload()
  await expect(page).toHaveURL('/contacts')
  await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Imported Example Company/ }).click()
  await expect(page.getByRole('dialog')).toContainText('+32 2 111 11 11')
})

test('contacts search, creation and dialog dismissal fit mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: /Open contacts/ }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByLabel('Search contacts').fill('Imported Example')
  await expect(page.getByRole('button', { name: /Imported Example Company/ })).toBeVisible()
  await page.getByRole('button', { name: 'New contact' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
