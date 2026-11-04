import { expect, test } from '@playwright/test'

test.use({ locale: 'en-GB' })

const session = {
  authMode: 'github',
  authenticated: true,
  organisation: 'uug-ai',
  team: 'engineering',
  csrfToken: 'browser-test-csrf',
  user: { id: 42, login: 'example-member', name: 'Example Member' },
  access: {
    principal: 'github:42',
    authorizationMode: 'compatibility',
    member: true,
    companyId: '000000000000000000000001',
    capabilities: ['read', 'write', 'post'],
  },
}
const signedOut = { ...session, authenticated: false, csrfToken: undefined, user: undefined }

test('GitHub login gates workspace reads and fits a mobile viewport', async ({ page }) => {
  let workspaceReads = 0
  await page.route('**/api/session', (route) => route.fulfill({ json: signedOut }))
  await page.route('**/api/state', async (route) => {
    workspaceReads++
    await route.continue()
  })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your workspace, protected.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
    'href',
    '/auth/github',
  )
  await expect(
    page.getByText(
      'Sign in with GitHub. Access is limited to active members of uug-ai/engineering.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(page.getByLabel('Company access token')).toHaveCount(0)
  expect(workspaceReads).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('GitHub sessions send CSRF on writes and clear contacts on logout', async ({ page }) => {
  let authenticated = true
  let verifiedWrites = 0
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: authenticated ? session : signedOut }),
  )
  await page.route('**/api/contacts', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-csrf-token']).toBe(session.csrfToken)
      expect(route.request().headers().authorization).toBeUndefined()
      verifiedWrites++
    }
    await route.continue()
  })
  await page.route('**/api/logout', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe(session.csrfToken)
    authenticated = false
    await route.fulfill({ status: 204 })
  })
  await page.goto('/')
  await expect(page.getByLabel('Signed in as example-member')).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: /Open contacts/ }).click()
  await page.getByRole('button', { name: 'New contact' }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Auth Session Example')
  await page.getByRole('dialog').getByRole('button', { name: 'Save contact' }).click()
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Auth Session Example' }),
  ).toBeVisible()
  expect(verifiedWrites).toBe(1)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Open contact Auth Session Example' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your workspace, protected.' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Auth Session Example', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Signed in as example-member')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible()
})

test('expired sessions clear the workspace instead of falling back to a company token', async ({
  page,
}) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: session }))
  await page.goto('/')
  await page.getByRole('button', { name: /Open contacts/ }).click()
  await page.getByRole('button', { name: 'New contact' }).click()
  await page.route('**/api/contacts', (route) =>
    route.fulfill({ status: 401, json: { error: 'Sign in with GitHub to continue.' } }),
  )
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Expired Session Example')
  await page.getByRole('dialog').getByRole('button', { name: 'Save contact' }).click()
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Company access token')).toHaveCount(0)
  await expect(page.getByLabel('Signed in as example-member')).toHaveCount(0)
})

test('a pending workspace response cannot restore private data after logout', async ({ page }) => {
  let release: () => void = () => {}
  let started: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const requested = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('**/api/session', (route) => route.fulfill({ json: session }))
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch()
    started()
    await pending
    await route.fulfill({ response })
  })
  await page.route('**/api/logout', (route) => route.fulfill({ status: 204 }))
  await page.goto('/')
  await requested
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible()
  const response = page.waitForResponse('**/api/state')
  release()
  await response
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Open contacts/ })).toHaveCount(0)
})

test('explicit legacy token mode still reports invalid credentials and accepts a valid token', async ({
  page,
}) => {
  const token = 'valid-browser-test-token'.repeat(2)
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { authMode: 'token', authenticated: false } }),
  )
  await page.route('**/api/state', (route) =>
    route.request().headers().authorization === `Bearer ${token}`
      ? route.continue()
      : route.fulfill({ status: 401, json: { error: 'Incorrect company access token.' } }),
  )
  await page.goto('/')
  const input = page.getByLabel('Company access token')
  await expect(input).toBeVisible()
  await input.fill('wrong-token')
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await expect(page.getByRole('alert')).toContainText('Incorrect company access token.')
  await input.fill(token)
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await expect(page.getByRole('button', { name: /Open accounting/ })).toBeVisible()
})

test('authenticated 403 keeps a valid session and never retries a contact write', async ({
  page,
}) => {
  let writes = 0
  await page.route('**/api/session', (route) => route.fulfill({ json: session }))
  await page.route('**/api/contacts', async (route) => {
    if (route.request().method() === 'POST') {
      writes++
      await route.fulfill({
        status: 403,
        json: { error: 'Access forbidden. Ask your workspace administrator for write capability.' },
      })
    } else await route.continue()
  })
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'New contact' }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Name', { exact: true })
    .fill('Denied synthetic contact')
  await page.getByRole('dialog').getByRole('button', { name: 'Save contact' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('administrator')
  await expect(page.getByLabel('Signed in as example-member')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await expect(page.getByLabel('Company access token')).toHaveCount(0)
  expect(writes).toBe(1)
})

test('authenticated business-read 403 is an actionable forbidden page, not expiry', async ({
  page,
}) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: session }))
  await page.route('**/api/state', (route) =>
    route.fulfill({
      status: 403,
      json: { error: 'Access forbidden. Ask your administrator for company membership.' },
    }),
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Access forbidden', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh permissions', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Sign in with GitHub/ })).toHaveCount(0)
  await expect(page.getByLabel('Company access token')).toHaveCount(0)
})
