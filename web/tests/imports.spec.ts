import { expect, test } from '@playwright/test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { billFixtures } from './fixtures.mjs'

let directory: string
test.beforeAll(async () => {
  directory = await billFixtures()
})
test.afterAll(async () => {
  await rm(directory, { recursive: true })
})

test('drop a PDF, review beside original, save draft, deduplicate and retain after posting', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Open accounting/ }).click()
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bills$/ })
    .click()
  const data = (await readFile(join(directory, 'digital.pdf'))).toString('base64')
  const transfer = await page.evaluateHandle((base64) => {
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], 'digital.pdf', {
        type: 'application/pdf',
      }),
    )
    return transfer
  }, data)
  await page
    .getByRole('region', { name: 'Drop bill documents' })
    .dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.getByText('Ready for review', { exact: true })).toBeVisible()
  await page
    .getByRole('row')
    .filter({ hasText: 'digital.pdf' })
    .getByRole('button', { name: 'Review original' })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Vendor name')).toHaveValue('Example Supplies Ltd')
  await expect(dialog.getByLabel('Line 1 quantity')).toHaveValue('2')
  await expect(dialog.getByLabel('Line 1 unit price')).toHaveValue('100.00')
  await expect(dialog.getByRole('img', { name: /^Original bill/ })).toBeVisible()
  expect(
    await dialog
      .getByRole('img', { name: /^Original bill/ })
      .evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0)
  await expect(dialog.getByRole('button', { name: 'Save draft' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /I checked the original, supplier/ }).check()
  await dialog.getByRole('button', { name: 'Save draft' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Example Supplies Ltd' })).toBeVisible()
  await expect(page.getByText('Draft', { exact: true })).toBeVisible()
  const state = await (await page.request.get('/api/state')).json()
  const draft = state.documents.find(
    (doc: { partner: string }) => doc.partner === 'Example Supplies Ltd',
  )
  expect(draft.entries).toEqual([])
  expect(draft.payments).toEqual([])
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bills$/ })
    .click()
  await page.getByLabel('Upload bills').setInputFiles(join(directory, 'digital.pdf'))
  await expect(page.getByText('Duplicate - original already stored')).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'digital.pdf' })).toHaveCount(1)
  await page
    .getByRole('row')
    .filter({ hasText: 'digital.pdf' })
    .getByRole('button', { name: 'Open bill' })
    .click()
  await page.getByRole('button', { name: 'Post document' }).click()
  await page.getByRole('button', { name: 'Confirm posting' }).click()
  await expect(page.getByText('Posted', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View original' }).click()
  await expect(page.getByRole('dialog').getByRole('img', { name: /^Original bill/ })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download original' }).click()
  const downloaded = await download
  expect(downloaded.suggestedFilename()).toBe('digital.pdf')
  const downloadedPath = await downloaded.path()
  expect(await readFile(downloadedPath!)).toEqual(await readFile(join(directory, 'digital.pdf')))
})

test('browse an image batch, surface failures, and keep mobile review usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: /Open accounting/ }).click()
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bills$/ })
    .click()
  await page
    .getByLabel('Upload bills')
    .setInputFiles([join(directory, 'bill.png'), join(directory, 'bill.jpg')])
  await expect(page.getByText('Ready for review', { exact: true })).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page
    .getByRole('row')
    .filter({ hasText: 'bill.png' })
    .getByRole('button', { name: 'Review original' })
    .click()
  await expect(page.getByRole('dialog').getByRole('img', { name: /^Original bill/ })).toBeVisible()
  await expect(page.getByRole('dialog').getByLabel('Vendor name')).toHaveValue(
    'Example Supplies Ltd',
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByLabel('Upload bills').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-invalid'),
  })
  await expect(page.getByText('Stored - scan needs attention')).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: 'broken.pdf' })
  await row.getByRole('button', { name: 'Review original' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText('could not be previewed')
  await dialog.getByLabel('Vendor name').fill('Manual review supplier')
  await dialog.getByLabel('Document date').fill('2026-11-03')
  await dialog.getByLabel('Due date').fill('2026-12-03')
  await dialog.getByLabel('Line 1 unit price').fill('10.00')
  await dialog.getByRole('checkbox', { name: /I checked the original, supplier/ }).check()
  await dialog.getByRole('button', { name: 'Save draft' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Manual review supplier' })).toBeVisible()
  await expect(page.getByText('Draft', { exact: true })).toBeVisible()
})
