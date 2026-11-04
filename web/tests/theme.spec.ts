import { expect, test, type Locator } from '@playwright/test'
import type { Contact, State } from '../src/types'

test.use({ colorScheme: 'light' })

const contact: Contact = {
  id: '000000000000000000000042',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  name: 'Theme Example Company',
  isCompany: true,
  companyName: '',
  email: 'theme@example.invalid',
  phone: '',
  mobile: '',
  website: '',
  vat: '',
  reference: '',
  type: 'contact',
  address: { street: '', street2: '', postalCode: '', city: '', state: '', country: '' },
  tags: ['Synthetic'],
  customer: true,
  vendor: false,
  active: true,
}

async function expectReadable(locator: Locator) {
  const contrast = await locator.evaluate((element) => {
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
      const linear = channels.map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    let background = element
    while (
      getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)' &&
      background.parentElement
    ) {
      background = background.parentElement
    }
    const foreground = luminance(getComputedStyle(element).color)
    const behind = luminance(getComputedStyle(background).backgroundColor)
    return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
}

test('follows the system until a keyboard-selected appearance is saved', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to dark mode' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('odee.theme'))).toBe('dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('odee.theme'))).toBe('light')
})

test('synchronizes choices across tabs and resumes the system theme when storage is cleared', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const other = await context.newPage()
  await other.goto('/')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light')
  await other.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await other.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await other.evaluate(() => localStorage.clear())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await other.close()
})

test('invalid saved preferences use the system appearance with an explicit warning', async ({
  page,
}) => {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text())
  })
  await page.addInitScript(() => localStorage.setItem('odee.theme', 'invalid-theme'))
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(warnings.some((warning) => warning.includes('Invalid saved appearance preference'))).toBe(
    true,
  )
})

test('blocked browser storage still allows switching and reports that saving failed', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage blocked for this test', 'SecurityError')
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Open accounting/ })).toBeVisible()
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('alert')).toContainText('your preference could not be saved')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

for (const mode of ['light', 'dark'] as const) {
  test(`${mode} mode covers launcher, contacts, forms, accounting tables and bill uploads`, async ({
    page,
  }) => {
    const surface = mode === 'dark' ? 'rgb(27, 30, 45)' : 'rgb(255, 255, 255)'
    const inset = mode === 'dark' ? 'rgb(32, 35, 53)' : 'rgb(252, 250, 255)'
    const background = mode === 'dark' ? 'rgb(17, 19, 30)' : 'rgb(248, 249, 252)'
    await page.emulateMedia({ colorScheme: mode })
    await page.route('**/api/state', async (route) => {
      const response = await route.fetch()
      const state: State = await response.json()
      await route.fulfill({ response, json: { ...state, contacts: [contact] } })
    })
    await page.route('**/api/contacts', (route) => route.fulfill({ json: [contact] }))
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
    await expect(page.locator('html')).toHaveCSS('color-scheme', mode)
    await expect(page.locator('html')).toHaveCSS('background-color', background)
    await expect(page.locator('.topbar')).toHaveCSS('background-color', surface)
    await expect(page.locator('.tile.enabled').first()).toHaveCSS('background-color', surface)
    await expectReadable(page.locator('.tile.enabled').first())
    expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe(background)

    await page.getByRole('button', { name: /Open contacts/ }).click()
    const card = page.getByRole('button', { name: 'Open contact Theme Example Company' })
    await expect(card).toHaveCSS('background-color', surface)
    await expectReadable(card.locator('.contact-summary strong'))
    await expectReadable(card.locator('.contact-summary'))
    await page.getByRole('button', { name: 'New contact' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveCSS('background-color', surface)
    await expectReadable(dialog)
    const input = dialog.getByLabel('Name', { exact: true })
    await expect(input).toHaveCSS('background-color', surface)
    await expect(input).toHaveCSS('color-scheme', mode)
    await expectReadable(input)
    await expectReadable(dialog.getByRole('button', { name: 'Save contact' }))
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()

    await page.getByRole('button', { name: 'Odee app launcher' }).click()
    await page.getByRole('button', { name: /Open accounting/ }).click()
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', surface)
    await expect(page.locator('.journal-card').first()).toHaveCSS('background-color', surface)
    await page.getByRole('navigation').getByRole('button', { name: 'Chart of accounts' }).click()
    await expect(page.locator('th').first()).toHaveCSS('background-color', inset)
    await expectReadable(page.locator('th').first())
    await expectReadable(page.locator('td').first())
    await page.getByRole('navigation').getByRole('button', { name: 'Bills', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Drop bill documents' })).toHaveCSS(
      'background-color',
      inset,
    )
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByRole('button', { name: /Switch to .* mode/ })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
}

test('appearance switching is available before GitHub login without reading private data', async ({
  page,
}) => {
  let workspaceReads = 0
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        authMode: 'github',
        authenticated: false,
        organisation: 'example',
        team: 'members',
      },
    }),
  )
  await page.route('**/api/state', (route) => {
    workspaceReads++
    return route.continue()
  })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible()
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.login')).toHaveCSS('background-color', 'rgb(27, 30, 45)')
  await expectReadable(page.getByRole('link', { name: 'Sign in with GitHub' }))
  expect(workspaceReads).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('.login')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})
