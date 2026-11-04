import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const origin = process.env.ODEE_TEST_ORIGIN
assert.ok(origin, 'Run using npm run test:oauth')
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  assert.equal((await context.request.get(`${origin}/api/contacts`)).status(), 401)
  await page.goto(origin)
  await page.getByRole('link', { name: 'Sign in with GitHub' }).waitFor()
  const alias = origin.replace('127.0.0.1', 'localhost')
  const callback = await page.goto(`${alias}/auth/github`)
  assert.equal(callback?.status(), 200, await page.locator('body').innerText())
  assert.equal(new URL(page.url()).origin, origin)
  await page.getByLabel('Signed in as browser-member').waitFor()
  assert.equal(new URL(page.url()).origin, origin)
  const cookies = await context.cookies(origin)
  const sessionCookie = cookies.find((cookie) => cookie.name === 'odee_session')
  assert.ok(sessionCookie?.httpOnly)
  assert.equal(sessionCookie.sameSite, 'Lax')
  assert.equal(sessionCookie.domain, '127.0.0.1')
  assert.ok(!cookies.some((cookie) => cookie.name === 'odee_oauth'))
  assert.ok(!(await page.evaluate(() => document.cookie)).includes('odee_session'))
  assert.equal((await context.request.get(`${origin}/api/state`)).status(), 200)
  const session = await (await context.request.get(`${origin}/api/session`)).json()
  assert.equal(session.user.login, 'browser-member')
  assert.ok(session.csrfToken)
  const unverifiedWrite = await context.request.post(`${origin}/api/contacts`, {
    headers: { Origin: origin },
    data: { name: 'Unverified Example', type: 'contact', active: true },
  })
  assert.equal(unverifiedWrite.status(), 403)
  await page.getByRole('button', { name: /Open contacts/ }).click()
  await page.getByRole('button', { name: 'New contact' }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('OAuth Verified Example')
  await page.getByRole('dialog').getByRole('button', { name: 'Save contact' }).click()
  await page.getByRole('dialog').getByRole('heading', { name: 'OAuth Verified Example' }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  const contacts = await (await context.request.get(`${origin}/api/contacts`)).json()
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].name, 'OAuth Verified Example')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('link', { name: 'Sign in with GitHub' }).waitFor()
  assert.ok(!(await context.cookies(origin)).some((cookie) => cookie.name === 'odee_session'))
  assert.equal((await context.request.get(`${origin}/api/state`)).status(), 401)
  assert.equal((await context.request.get(`${origin}/api/contacts`)).status(), 401)
  assert.deepEqual(errors, [])
  console.log(
    'OAuth browser round-trip passed: canonical host, PKCE, HttpOnly cookie, team access, CSRF, contact write and logout',
  )
} finally {
  await browser.close()
}
