import { expect, test, type APIRequestContext } from '@playwright/test'
import type { State } from '../src/types'

test.use({ locale: 'en-GB' })

const destinations = [
  ['/accounting', 'Dashboard'],
  ['/accounting/invoices', 'Customer invoices'],
  ['/accounting/bills', 'Vendor bills'],
  ['/accounting/journal', 'Journal entries'],
  ['/accounting/accounts', 'Chart of accounts'],
  ['/accounting/reports', 'Trial balance'],
  ['/contacts', 'Contacts'],
] as const
const session = {
  authMode: 'github',
  access: {
    principal: 'github:42',
    authorizationMode: 'compatibility',
    member: true,
    companyId: '000000000000000000000001',
    capabilities: ['read', 'write', 'post'],
  },
  authenticated: true,
  organisation: 'uug-ai',
  team: 'engineering',
  csrfToken: 'route-test-csrf',
  user: { id: 42, login: 'route-member', name: 'Synthetic Route Member' },
}
const signedOut = { ...session, authenticated: false, csrfToken: undefined, user: undefined }

async function workspaceSnapshot(request: APIRequestContext) {
  const response = await request.get('/api/state')
  expect(response.status()).toBe(200)
  const state: State = await response.json()
  // Memory-store map iteration order is not a record mutation.
  return {
    ...state,
    documents: state.documents && [...state.documents].sort((a, b) => a.id.localeCompare(b.id)),
    contacts: state.contacts && [...state.contacts].sort((a, b) => a.id.localeCompare(b.id)),
    imports: state.imports && [...state.imports].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

test('every authenticated cold deep link and reload renders its registered view without writes', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET')
      writes.push(request.method())
  })
  await page.route('**/api/session', (route) => route.fulfill({ json: session }))
  const before = await workspaceSnapshot(page.request)
  for (const [path, title] of destinations) {
    expect((await page.goto(path))?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
    await expect(page).toHaveURL(path)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
    await expect(page).toHaveURL(path)
  }
  expect(writes).toEqual([])
  expect(await workspaceSnapshot(page.request)).toEqual(before)
})

test('protected GitHub deep links disclose no data and return only to the registered path through offline sign-in', async ({
  page,
}) => {
  let authenticated = false
  let workspaceReads = 0
  let returnTo = '/'
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: authenticated ? session : signedOut }),
  )
  await page.route('**/api/state', async (route) => {
    workspaceReads++
    await route.continue()
  })
  for (const [path] of destinations) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Your workspace, protected.' })).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByLabel('Signed in as route-member')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
      'href',
      `/auth/github?returnTo=${encodeURIComponent(path)}`,
    )
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Your workspace, protected.' })).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
  }
  expect(workspaceReads).toBe(0)
  // An untrusted URL query must never become the sign-in destination.
  await page.goto('/contacts?returnTo=https://evil.example/accounting')
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
    'href',
    '/auth/github?returnTo=%2Fcontacts',
  )
  await page.route('**/auth/github?returnTo=*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('returnTo')
    expect(destinations.some(([path]) => path === target)).toBe(true)
    returnTo = target ?? '/'
    await route.fulfill({
      contentType: 'text/html',
      body: '<a href="/auth/github/callback?code=offline&state=offline">Continue offline sign-in</a>',
    })
  })
  await page.route('**/auth/github/callback?*', async (route) => {
    authenticated = true
    await route.fulfill({ status: 303, headers: { Location: returnTo } })
  })
  await page.getByRole('link', { name: 'Sign in with GitHub' }).click()
  await page.getByRole('link', { name: 'Continue offline sign-in' }).click()
  await expect(page).toHaveURL('/contacts')
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible()
  await expect(page).toHaveURL('/contacts')
})

test('token sign-in and reload retain the deep link without storing the token', async ({
  page,
}) => {
  const token = 'synthetic-route-token'.repeat(2)
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { authMode: 'token', authenticated: false } }),
  )
  await page.route('**/api/state', (route) =>
    route.request().headers().authorization === `Bearer ${token}`
      ? route.continue()
      : route.fulfill({ status: 401, json: { error: 'Incorrect company access token.' } }),
  )
  await page.goto('/accounting/bills')
  await expect(page.getByLabel('Company access token')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.getByLabel('Company access token').fill('invalid-synthetic-token')
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await expect(page.getByRole('alert')).toContainText('Incorrect company access token.')
  await expect(page).toHaveURL('/accounting/bills')
  await page.getByLabel('Company access token').fill(token)
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Vendor bills' })).toBeVisible()
  expect(
    await page.evaluate(
      (value) =>
        [localStorage, sessionStorage].some((storage) => Object.values(storage).includes(value)),
      token,
    ),
  ).toBe(false)
  await page.reload()
  await expect(page.getByLabel('Company access token')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page).toHaveURL('/accounting/bills')
  await page.getByLabel('Company access token').fill(token)
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Vendor bills' })).toBeVisible()
})

test('Back and Forward close accounting selections and all module dialogs without writes or new entries', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Routing tests require the isolated server.')
  const created = await page.request.post('/api/documents', {
    headers: { Origin: new URL(baseURL).origin },
    data: {
      kind: 'invoice',
      partner: 'Route selection example',
      email: '',
      reference: '',
      date: '2026-11-03',
      dueDate: '2026-12-03',
      lines: [
        {
          description: 'Synthetic route fixture',
          quantity: 1,
          unitCents: 100,
          taxBps: 0,
          accountCode: '4000',
        },
      ],
    },
  })
  expect(created.status()).toBe(201)
  const before = await workspaceSnapshot(page.request)
  const writes: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET')
      writes.push(request.method())
  })
  await page.goto('/')
  await page.getByRole('button', { name: /Open accounting/ }).click()
  await expect(page).toHaveURL('/accounting')
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Invoices/ })
    .click()
  await expect(page).toHaveURL('/accounting/invoices')
  await page.getByRole('button', { name: 'Route selection example', exact: true }).click()
  await page.getByRole('button', { name: 'Edit draft' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const entries = await page.evaluate(() => history.length)
  await page.goBack()
  await expect(page).toHaveURL('/accounting')
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goForward()
  await expect(page).toHaveURL('/accounting/invoices')
  await expect(page.getByRole('heading', { level: 1, name: 'Customer invoices' })).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(entries)
  await page.getByRole('navigation').getByRole('button', { name: 'Bills', exact: true }).click()
  await page.getByRole('button', { name: 'New bill', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Vendor name').fill('Unsaved history example')
  await page.goBack()
  await expect(page).toHaveURL('/accounting/invoices')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goForward()
  await expect(page).toHaveURL('/accounting/bills')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('navigation').getByRole('button', { name: 'Contacts', exact: true }).click()
  await page.getByRole('button', { name: 'New contact' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const lastEntries = await page.evaluate(() => history.length)
  await page.goBack()
  await expect(page).toHaveURL('/accounting/bills')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goForward()
  await expect(page).toHaveURL('/contacts')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => history.length)).toBe(lastEntries)
  await page.getByRole('button', { name: 'New contact' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes).toEqual([])
  expect(await workspaceSnapshot(page.request)).toEqual(before)
})

test('a completed draft request cannot reopen a selection after history navigation', async ({
  page,
}) => {
  let release: () => void = () => {}
  let started: () => void = () => {}
  let writes = 0
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const requested = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('**/api/documents', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    writes++
    const response = await route.fetch()
    started()
    await pending
    await route.fulfill({ response })
  })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: /Open accounting/ }).click()
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /^Invoices/ })
      .click()
    await page.getByRole('button', { name: 'New invoice', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Customer name').fill('Delayed route fixture')
    await page.getByRole('dialog').getByLabel('Line 1 description').fill('Synthetic delayed draft')
    await page.getByRole('dialog').getByLabel('Line 1 unit price').fill('1.00')
    await page.getByRole('dialog').getByRole('button', { name: 'Save draft' }).click()
    await requested
    await page.goBack()
    await expect(page).toHaveURL('/accounting')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const response = page.waitForResponse('**/api/documents')
    release()
    await response
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL('/accounting')
    expect(writes).toBe(1)
  } finally {
    release()
  }
})

test('expiry clears a deep-linked workspace and retains its safe GitHub return destination', async ({
  page,
}) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: session }))
  await page.goto('/accounting')
  await page.getByRole('navigation').getByRole('button', { name: 'Contacts', exact: true }).click()
  await page.getByRole('button', { name: 'New contact' }).click()
  await page.route('**/api/contacts', (route) =>
    route.fulfill({ status: 401, json: { error: 'Sign in with GitHub to continue.' } }),
  )
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Expired route fixture')
  await page.getByRole('dialog').getByRole('button', { name: 'Save contact' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Signed in as route-member')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
    'href',
    '/auth/github?returnTo=%2Fcontacts',
  )
  await expect(page.getByLabel('Company access token')).toHaveCount(0)
  await expect(page).toHaveURL('/contacts')
  await page.goBack()
  await expect(page).toHaveURL('/accounting')
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
    'href',
    '/auth/github?returnTo=%2Faccounting',
  )
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.goForward()
  await expect(page).toHaveURL('/contacts')
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible()
})

test('unknown and planned paths show an explicit not-found page with a keyboard launcher link', async ({
  page,
}) => {
  for (const path of [
    '/missing',
    '/index.html',
    '/sales',
    '/projects',
    '/inventory',
    '/accounting/missing',
    '/contacts/missing',
  ]) {
    expect((await page.goto(path))?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeFocused()
    await expect(page.getByRole('link', { name: 'Back to workspace' })).toHaveAttribute('href', '/')
    await expect(page.getByRole('button', { name: /Open accounting/ })).toHaveCount(0)
    await expect(page).toHaveURL(path)
  }
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Back to workspace' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('button', { name: /Open accounting/ })).toBeVisible()
  await expect(page.locator('.tile.planned')).toHaveCount(3)
})

test('reserved server namespaces and unsupported methods never receive a SPA shell', async ({
  request,
}) => {
  for (const path of [
    '/api/unknown',
    '/auth/unknown',
    '/auth/github/callback',
    '/assets/missing.js',
    '/healthz/missing',
  ]) {
    const response = await request.get(path)
    expect(response.status()).toBe(404)
    expect(await response.text()).not.toContain('id="root"')
  }
  const health = await request.get('/healthz')
  expect(health.status()).toBe(200)
  expect(await health.text()).toBe('ok')
  const post = await request.post('/accounting')
  expect(post.status()).toBe(405)
  expect(await post.text()).not.toContain('id="root"')
})

test.describe('Dutch new route messages', () => {
  test.use({ locale: 'nl-BE', viewport: { width: 390, height: 844 } })
  test('not-found text, language and launcher link work on mobile', async ({ page }) => {
    await page.goto('/sales')
    await expect(page.getByRole('heading', { name: 'Pagina niet gevonden' })).toBeVisible()
    await expect(page.getByRole('region')).toHaveAttribute('lang', 'nl')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('link', { name: 'Terug naar de werkruimte' }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: /Boekhouding openen/ })).toBeVisible()
  })
})
