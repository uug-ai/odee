import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { safeTestEnvironment, reserveTestPort } from '../../tools/agents/workspace.mjs'
import { createLocalTransport } from './local-transport.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const children = new Set()
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true
    for (const owner of children) owner.child.kill('SIGTERM')
  })
}
function run(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      logs += data
    })
  const owner = {
    child,
    logs: () => logs,
    done: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        children.delete(owner)
        resolve(code)
      })
    }),
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      let timeout
      try {
        return await Promise.race([
          owner.done,
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              child.kill('SIGKILL')
              reject(new Error('Owned fixture shutdown timed out'))
            }, 12000)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
  }
  children.add(owner)
  return owner
}
async function command(command, args, env) {
  const owner = run(command, args, env)
  if ((await owner.done) !== 0 || interrupted) throw new Error(owner.logs())
  return owner.logs()
}
async function launch() {
  const scratch = join(root, '.local-data', 'localization', randomUUID())
  const env = safeTestEnvironment({ ODEE_TEST_SCRATCH_DIR: scratch })
  try {
    const cache = join(scratch, 'mongodb-binaries')
    await mkdir(cache)
    const existing = join(homedir(), '.cache', 'mongodb-binaries')
    for (const name of await readdir(existing).catch(() => [])) {
      if (new RegExp(`^mongod-${process.arch}-[a-zA-Z0-9._-]+-8\\.0\\.16$`).test(name))
        await copyFile(join(existing, name), join(cache, name))
    }
    const owner = run(process.execPath, [fileURLToPath(import.meta.url), '--isolated'], {
      ...env,
      MONGOMS_DOWNLOAD_DIR: cache,
      MONGOMS_MAX_RETRIES: '1',
      PLAYWRIGHT_BROWSERS_PATH: join(homedir(), '.cache', 'ms-playwright'),
    })
    const code = await owner.done
    process.stdout.write(owner.logs())
    if (code !== 0) throw new Error(`Localization checks failed (${code})`)
  } finally {
    for (const owner of children) await owner.stop()
    const directories = [scratch]
    while (directories.length) {
      const directory = directories.pop()
      await chmod(directory, 0o700)
      for (const entry of await readdir(directory, { withFileTypes: true }))
        if (entry.isDirectory()) directories.push(join(directory, entry.name))
    }
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
  }
}

// Independent literal expectations: do not import the application catalog to generate assertions.
const labels = {
  en: {
    language: 'Language',
    signIn: 'Sign in with GitHub',
    signedIn: 'Signed in as renamable-login',
    contacts: 'Contacts',
    openContacts: 'Open contacts',
    newContact: 'New contact',
    name: 'Name',
    saveContact: 'Save contact',
    close: 'Close',
    launcher: 'Odee app launcher',
    openAccounting: 'Open accounting',
    invoices: 'Invoices',
    bills: 'Bills',
    newInvoice: 'New invoice',
    customer: 'Customer name',
    description: 'Line 1 description',
    quantity: 'Line 1 quantity',
    price: 'Line 1 unit price',
    date: 'Document date',
    dueDate: 'Due date',
    reference: 'Reference',
    saveDraft: 'Save draft',
    cancel: 'Cancel',
    editDraft: 'Edit draft',
    post: 'Post document',
    confirm: 'Confirm posting',
    pay: 'Record payment',
    amount: 'Amount (EUR)',
    paymentDate: 'Payment date',
    paymentReference: 'Payment reference',
    invalid: 'Enter a positive amount with at most two decimal places.',
    conflict: 'document changed; refresh before trying again',
    excessive: 'payment must be positive and cannot exceed the outstanding balance',
    refresh: 'Refresh workspace',
    partial: 'Partial',
    outstanding: '€142.00',
    choose: 'Upload bills',
    review: 'Review original',
    vendor: 'Vendor name',
    reviewed:
      'I checked the original, supplier, dates, EUR currency, line amounts and VAT. Save only a draft.',
    forbidden: 'Access forbidden',
    signOut: 'Sign out',
    token: 'Company access token',
    deny: 'Access denied. Your session is still active; ask your administrator for permission.',
    protected: 'Your workspace, protected.',
    copy: 'Import Odoo JSON',
    importTitle: 'Copy contacts from Odoo',
    authorized: 'I am authorized to copy these contacts into this company workspace.',
    importContacts: 'Import contacts',
    noMatches: 'No matching contacts.',
    searchContacts: 'Search contacts',
  },
  nl: {
    language: 'Taal',
    signIn: 'Aanmelden met GitHub',
    signedIn: 'Aangemeld als renamable-login',
    contacts: 'Contacten',
    openContacts: 'Contacten openen',
    newContact: 'Nieuw contact',
    name: 'Naam',
    saveContact: 'Contact opslaan',
    close: 'Sluiten',
    launcher: 'Odee appoverzicht',
    openAccounting: 'Boekhouding openen',
    invoices: 'Klantfacturen',
    bills: 'Leveranciersfacturen',
    newInvoice: 'Nieuwe klantfactuur',
    customer: 'Naam klant',
    description: 'Regel 1 omschrijving',
    quantity: 'Regel 1 aantal',
    price: 'Regel 1 eenheidsprijs',
    date: 'Documentdatum',
    dueDate: 'Vervaldatum',
    reference: 'Referentie',
    saveDraft: 'Concept opslaan',
    cancel: 'Annuleren',
    editDraft: 'Concept bewerken',
    post: 'Document boeken',
    confirm: 'Boeking bevestigen',
    pay: 'Betaling boeken',
    amount: 'Bedrag (EUR)',
    paymentDate: 'Betaaldatum',
    paymentReference: 'Betalingsreferentie',
    invalid: 'Voer een positief bedrag in met maximaal twee decimalen.',
    conflict: 'Document gewijzigd; vernieuw voordat je opnieuw probeert',
    excessive: 'Betaling moet positief zijn en mag het openstaande saldo niet overschrijden',
    refresh: 'Werkruimte vernieuwen',
    partial: 'Gedeeltelijk betaald',
    outstanding: '€ 142,00',
    choose: 'Facturen uploaden',
    review: 'Origineel controleren',
    vendor: 'Naam leverancier',
    reviewed:
      'Ik heb origineel, leverancier, datums, EUR-valuta, regelbedragen en btw gecontroleerd. Alleen een concept opslaan.',
    forbidden: 'Toegang geweigerd',
    signOut: 'Afmelden',
    token: 'Bedrijfstoegangstoken',
    deny: 'Toegang geweigerd. Je sessie is nog actief; vraag je beheerder om toestemming.',
    protected: 'Je werkruimte, beveiligd.',
    copy: 'Odoo JSON importeren',
    importTitle: 'Contacten uit Odoo kopiëren',
    authorized: 'Ik ben gemachtigd deze contacten naar deze bedrijfswerkruimte te kopiëren.',
    importContacts: 'Contacten importeren',
    noMatches: 'Geen overeenkomende contacten.',
    searchContacts: 'Contacten zoeken',
  },
}

async function isolated() {
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  const { chromium, expect } = await import('@playwright/test')
  const { test } = await import('node:test')
  const env = process.env
  const scratch = env.ODEE_TEST_SCRATCH_DIR
  await command(
    'npm',
    ['--prefix', 'web', 'run', 'test:e2e', '--', '--config', 'tests/local-transport.config.ts'],
    env,
  ).then((log) => process.stdout.write(log))
  const dbPath = join(scratch, 'mongo')
  await mkdir(dbPath)
  const mongo = await MongoMemoryServer.create({
    binary: {
      version: '8.0.16',
      downloadDir: env.MONGOMS_DOWNLOAD_DIR,
      ...(process.platform === 'linux' && process.arch === 'arm64'
        ? { os: { os: 'linux', dist: 'ubuntu', release: '22.04' } }
        : {}),
    },
    instance: { ip: '127.0.0.1', dbPath },
    spawn: { env },
  })
  let browser
  let transport
  try {
    const uri = mongo.getUri()
    if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Nonlocal fixture URI')
    const output = await command(
      'go',
      ['test', '-race', '-json', '-count=1', './internal/accounting', './cmd/odee'],
      { ...env, ODEE_TEST_MONGODB_URI: uri },
    )
    const events = output
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
    const summary = Object.fromEntries(
      ['pass', 'skip', 'fail'].map((action) => [
        action,
        {
          topLevel: events
            .filter((event) => event.Test && !event.Test.includes('/') && event.Action === action)
            .map((event) => `${event.Package}/${event.Test}`),
          subcases: events
            .filter((event) => event.Test?.includes('/') && event.Action === action)
            .map((event) => `${event.Package}/${event.Test}`),
        },
      ]),
    )
    await writeFile(
      join(root, '.local-data', 'odee-006-go-results.json'),
      JSON.stringify(summary, null, 2),
    )
    for (const [action, result] of Object.entries(summary))
      console.log(
        `Go ${action}: ${result.topLevel.length} top-level, ${result.subcases.length} subcases${action === 'skip' ? ` (${result.topLevel.join(', ')})` : ''}`,
      )
    const binary = join(scratch, 'localization-fixture')
    await command('go', ['test', '-c', '-o', binary, './internal/accounting'], env)
    transport = await createLocalTransport()
    browser = await transport.launch(chromium)
    const company = '000000000000000000000001'
    async function fixture(locale, capabilities, check) {
      const l = labels[locale]
      const reservation = await reserveTestPort()
      const origin = `http://127.0.0.1:${reservation.port}`
      const database = `odee_test_locale_${randomUUID().replaceAll('-', '')}`
      const fixtureEnv = {
        ...env,
        ODEE_TEST_MONGODB_URI: uri,
        MONGODB_DATABASE_ODEE: database,
        ODEE_TEST_BROWSER_ADDR: `127.0.0.1:${reservation.port}`,
        ODEE_TEST_BROWSER_AUTH_MODE: 'github',
        ODEE_COMPANY_ID: company,
        ODEE_WEB_DIR: join(root, 'web', 'dist'),
        ODEE_AUTHZ_MODE: 'enforced',
        ODEE_CAPABILITY_GRANTS: JSON.stringify([
          { principal: 'github:42', companyId: company, capabilities },
        ]),
      }
      await reservation.release()
      let owner = run(binary, ['-test.v', '-test.run=^TestCapabilitiesBrowserFixture$'], fixtureEnv)
      const revoke = transport.allowOrigin(origin)
      // The committed proxy is mandatory for each context, including native API requests.
      const context = await browser.newContext({
        proxy: transport.proxy,
        serviceWorkers: 'block',
        locale: locale === 'nl' ? 'nl-BE' : 'en-GB',
      })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const pageErrors = []
      const blockedOrigins = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin === 'https://fonts.googleapis.com') {
          await route.fulfill({ contentType: 'text/css', body: '/* offline system fonts */' })
          return
        }
        try {
          transport.assertAllowed(url.href)
        } catch {
          blockedOrigins.push(url.origin)
          await route.abort('blockedbyclient')
          return
        }
        if (url.pathname === '/auth/github') {
          const response = await transport.fetch(context.request, url.href)
          expect(response.status()).toBe(302)
          const destination = new URL(response.headers().location)
          expect(destination.origin).toBe('https://github.com')
          expect(destination.pathname).toBe('/login/oauth/authorize')
          const state = destination.searchParams.get('state')
          expect(state).toMatch(/^[a-zA-Z0-9_-]+$/)
          await route.fulfill({
            status: 200,
            headers: {
              'Content-Type': 'text/html',
              'Set-Cookie': response.headers()['set-cookie'],
            },
            body: `<a href="/auth/github/callback?code=synthetic&amp;state=${state}">Continue local mock sign-in</a>`,
          })
          return
        }
        await route.continue()
      })
      async function ready() {
        for (let attempt = 0; attempt < 150; attempt++) {
          if (owner.child.exitCode !== null) throw new Error(owner.logs())
          try {
            const response = await transport.health(`${origin}/healthz`)
            if (response.ok && (await response.text()) === 'ok') return
          } catch {
            /* bounded loopback startup probe */
          }
          await sleep(100)
        }
        throw new Error(`Fixture not ready: ${owner.logs()}`)
      }
      let csrf = ''
      async function api(path, body, method = 'POST') {
        return transport.fetch(context.request, `${origin}/api/${path}`, {
          method: body === undefined ? 'GET' : method,
          headers: { Origin: origin, ...(body === undefined ? {} : { 'X-CSRF-Token': csrf }) },
          ...(body === undefined ? {} : { data: body }),
        })
      }
      const state = async () => {
        const response = await api('state')
        expect(response.status()).toBe(200)
        return response.json()
      }
      try {
        await ready()
        console.log(`Owned ${locale} fixture port=${reservation.port} database=${database}`)
        await page.goto(origin)
        await expect(page.getByRole('heading', { name: l.protected })).toBeVisible()
        await page.getByRole('link', { name: l.signIn }).focus()
        await page.keyboard.press('Enter')
        await page.getByRole('link', { name: 'Continue local mock sign-in' }).click()
        await expect(page.getByLabel(l.signedIn)).toBeVisible()
        csrf = (await (await api('session')).json()).csrfToken
        await check({
          page,
          context,
          l,
          api,
          state,
          origin,
          restart: async () => {
            expect(await owner.stop()).toBe(0)
            owner = run(
              binary,
              ['-test.v', '-test.run=^TestCapabilitiesBrowserFixture$'],
              fixtureEnv,
            )
            await ready()
          },
        })
        expect(pageErrors).toEqual([])
        expect(blockedOrigins).toEqual([])
        expect(transport.denied).toEqual([])
      } catch (error) {
        throw new Error(
          `${error.stack}\nFixture output:\n${owner.logs()}\nPage:\n${await page.locator('body').innerText()}`,
          { cause: error },
        )
      } finally {
        await context.close()
        revoke()
        expect(await owner.stop()).toBe(0)
        await reservation.release()
      }
    }

    for (const locale of ['en', 'nl']) {
      await test(`${locale}: protected contact/create/review/post/payment, conflict and restart`, async () => {
        await fixture(
          locale,
          ['read', 'write', 'post', 'admin'],
          async ({ page, context, l, api, state, origin, restart }) => {
            const price = locale === 'nl' ? '100,00' : '100.00'
            const writes = []
            page.on('request', (request) => {
              if (request.method() !== 'GET' && request.url().includes('/api/'))
                writes.push(request.url())
            })
            await page.getByRole('button', { name: new RegExp(l.openContacts) }).click()
            await page.getByLabel(l.searchContacts).fill('nonexistent-synthetic')
            await expect(page.getByRole('heading', { name: l.noMatches })).toBeVisible()
            await page.getByLabel(l.searchContacts).fill('')
            const trigger = page.getByRole('button', { name: l.newContact })
            await trigger.focus()
            await page.keyboard.press('Enter')
            const dialog = page.getByRole('dialog')
            await expect(dialog.getByLabel(l.name, { exact: true })).toBeFocused()
            await dialog.getByLabel(l.name, { exact: true }).fill('Draft')
            await dialog.getByRole('button', { name: l.saveContact }).click()
            await expect(dialog.getByRole('heading', { name: 'Draft', exact: true })).toBeVisible()
            await dialog.getByRole('button', { name: l.close, exact: true }).click()
            await expect(trigger).toBeFocused()
            // A real Odoo JSON import; source business strings are deliberately English catalog keys.
            await page.getByRole('button', { name: l.copy }).click()
            await dialog
              .getByLabel('Odoo contact JSON')
              .count()
              .then(async (count) => {
                const input = count
                  ? dialog.getByLabel('Odoo contact JSON')
                  : dialog.getByLabel('Odoo-contact-JSON')
                await input.setInputFiles({
                  name: 'synthetic-contacts.json',
                  mimeType: 'application/json',
                  buffer: Buffer.from(
                    JSON.stringify({
                      source: 'https://synthetic.invalid',
                      database: 'synthetic-local',
                      contacts: [
                        {
                          externalId: 7001,
                          parentId: 0,
                          companyId: 1,
                          name: 'Sales revenue',
                          isCompany: true,
                          type: 'contact',
                          address: {},
                          tags: ['Draft'],
                          active: true,
                        },
                      ],
                    }),
                  ),
                })
              })
            await dialog.getByLabel(l.authorized).check()
            await dialog.getByRole('button', { name: l.importContacts, exact: true }).click()
            await expect(dialog).toHaveCount(0)
            expect(
              (await state()).contacts.some(
                (c) => c.name === 'Sales revenue' && c.tags.includes('Draft'),
              ),
            ).toBe(true)
            await page.getByRole('button', { name: l.launcher }).click()
            await page.getByRole('button', { name: new RegExp(l.openAccounting) }).click()
            await page.getByRole('button', { name: l.newInvoice, exact: true }).click()
            await expect(dialog.getByLabel(l.customer)).toBeFocused()
            await dialog.getByLabel(l.customer).fill('Draft')
            await dialog.getByLabel(l.description).fill('Sales revenue')
            await dialog.getByLabel(l.quantity).fill('2')
            await dialog.getByLabel(l.date, { exact: true }).fill('2026-03-29')
            await dialog.getByLabel(l.dueDate, { exact: true }).fill('2026-12-03')
            await dialog.getByLabel(l.quantity).fill('1.5')
            const beforeQuantity = writes.length
            await dialog.getByRole('button', { name: l.saveDraft }).click()
            await expect(dialog.getByLabel(l.quantity)).toHaveJSProperty(
              'validationMessage',
              locale === 'nl'
                ? 'Voer een geheel getal binnen het toegestane bereik in.'
                : 'Enter a whole number within the allowed range.',
            )
            const other = locale === 'nl' ? 'en' : 'nl'
            await dialog.getByLabel(l.language).selectOption(other)
            await expect(dialog.getByLabel(labels[other].quantity)).toHaveJSProperty(
              'validationMessage',
              other === 'nl'
                ? 'Voer een geheel getal binnen het toegestane bereik in.'
                : 'Enter a whole number within the allowed range.',
            )
            await dialog.getByLabel(labels[other].language).selectOption(locale)
            expect(writes).toHaveLength(beforeQuantity)
            await dialog.getByLabel(l.quantity).fill('2')
            await dialog.getByLabel(l.price).fill(locale === 'nl' ? '1,234' : '1.234')
            const beforeInvalid = (await state()).documents.length
            const beforeInvalidWrites = writes.length
            await dialog.getByRole('button', { name: l.saveDraft }).click()
            await expect(dialog.getByRole('alert')).toHaveText(l.invalid)
            expect((await state()).documents).toHaveLength(beforeInvalid)
            expect(writes).toHaveLength(beforeInvalidWrites)
            await dialog.getByLabel(l.price).fill(price)
            await dialog.getByLabel(l.language).selectOption(other)
            await expect(dialog.getByLabel(labels[other].price)).toHaveValue(
              other === 'nl' ? '100,00' : '100.00',
            )
            await expect(dialog.getByLabel(labels[other].quantity)).toHaveValue('2')
            await expect(dialog.getByLabel(labels[other].date, { exact: true })).toHaveValue(
              '2026-03-29',
            )
            await dialog.getByLabel(labels[other].language).selectOption(locale)
            await dialog.getByRole('button', { name: l.saveDraft }).click()
            await expect(dialog).toHaveCount(0)
            let invoice = (await state()).documents.find((d) => d.partner === 'Draft')
            expect([
              invoice.subtotal,
              invoice.tax,
              invoice.total,
              invoice.lines[0].quantity,
              invoice.lines[0].unitCents,
            ]).toEqual([20000, 4200, 24200, 2, 10000])
            const draftInput = (d) => ({
              kind: d.kind,
              partner: d.partner,
              email: d.email,
              reference: d.reference,
              date: d.date,
              dueDate: d.dueDate,
              lines: d.lines,
            })
            await page.getByRole('button', { name: l.editDraft }).click()
            const concurrent = await api(
              `documents/${invoice.id}`,
              { ...draftInput(invoice), reference: 'CONCURRENT', version: invoice.version },
              'PUT',
            )
            expect(concurrent.status()).toBe(200)
            const concurrentDocument = (await state()).documents.find((d) => d.id === invoice.id)
            expect(concurrentDocument.version).toBe(invoice.version + 1)
            expect(concurrentDocument.reference).toBe('CONCURRENT')
            const beforeConflictWrites = writes.length
            await dialog.getByRole('button', { name: l.saveDraft }).click()
            await expect(dialog.getByRole('alert')).toContainText(l.conflict)
            expect((await state()).documents.find((d) => d.id === invoice.id)).toEqual(
              concurrentDocument,
            )
            expect(writes).toHaveLength(beforeConflictWrites + 1)
            await dialog.getByRole('button', { name: l.cancel }).click()
            await page.getByRole('button', { name: l.refresh }).click()
            await expect(page.getByText('CONCURRENT', { exact: true })).toBeVisible()

            async function postAndPay(partner) {
              await page.getByRole('button', { name: l.post, exact: true }).click()
              await dialog.getByRole('button', { name: l.confirm }).click()
              await expect(dialog).toHaveCount(0)
              await page.getByRole('button', { name: l.pay, exact: true }).click()
              await page.setViewportSize({ width: 390, height: 844 })
              expect(
                await dialog.evaluate((el) => el.getBoundingClientRect().width <= innerWidth),
              ).toBe(true)
              await expect(dialog.getByLabel(l.amount)).toBeFocused()
              await dialog.getByLabel(l.amount).fill(locale === 'nl' ? '300,00' : '300.00')
              const before = (await state()).documents.find((d) => d.partner === partner)
              await dialog.getByRole('button', { name: l.pay, exact: true }).click()
              await expect(dialog.getByRole('alert')).toContainText(l.excessive)
              expect((await state()).documents.find((d) => d.id === before.id)).toEqual(before)
              await dialog.getByLabel(l.amount).fill(price)
              await dialog.getByLabel(l.paymentDate).fill('2026-11-03')
              await dialog.getByLabel(l.paymentReference).fill('SYNTHETIC-TRANSFER')
              await dialog.getByRole('button', { name: l.pay, exact: true }).click()
              await expect(dialog).toHaveCount(0)
              await expect(page.getByText(l.partial, { exact: true })).toBeVisible()
              await expect(page.getByText(l.outstanding, { exact: true })).toBeVisible()
              const doc = (await state()).documents.find((d) => d.partner === partner)
              expect([
                doc.total,
                doc.paid,
                doc.total - doc.paid,
                doc.payments[0].amount,
                doc.payments[0].date,
              ]).toEqual([24200, 10000, 14200, 10000, '2026-11-03'])
              for (const entries of [doc.entries, ...doc.payments.map((p) => p.entries)])
                expect(
                  entries.reduce((sum, e) => sum + BigInt(e.debit) - BigInt(e.credit), 0n),
                ).toBe(0n)
              return doc
            }
            invoice = await postAndPay('Draft')
            await page.getByLabel(l.language).selectOption(other)
            await expect(
              page.getByRole('heading', { level: 1, name: 'Draft', exact: true }),
            ).toBeVisible()
            expect((await state()).documents.find((d) => d.id === invoice.id)).toEqual(invoice)
            await page.reload()
            await expect(page.locator('html')).toHaveAttribute('lang', other)
            await page.getByLabel(labels[other].language).selectOption(locale)
            await page.getByRole('button', { name: l.bills, exact: true }).click()
            const originalsBeforeInvalid = (await state()).imports.length
            await page.getByLabel(l.choose).setInputFiles({
              name: 'synthetic-invalid.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('synthetic invalid upload'),
            })
            await expect(page.locator('.upload-progress')).toContainText(
              locale === 'nl'
                ? 'Kies een niet-leeg PDF-, PNG- of JPEG-bestand van maximaal 20 MiB.'
                : 'Choose a nonempty PDF, PNG or JPEG of at most 20 MiB.',
            )
            expect((await state()).imports).toHaveLength(originalsBeforeInvalid)

            const pdfPage = await context.newPage()
            await pdfPage.setContent(
              '<html><body><pre style="font:18px monospace">Supplier: Synthetic Local Supplier\nInvoice number: SYNTHETIC-006\nInvoice date: 03/11/2026\nDue date: 03/12/2026\nCurrency: EUR\nConsulting  2  100.00  21%  242.00\nSubtotal: 200.00\nVAT 21%: 42.00\nTotal: 242.00 EUR</pre></body></html>',
            )
            const pdf = await pdfPage.pdf({ format: 'A4' })
            await pdfPage.close()
            await page.getByLabel(l.choose).setInputFiles({
              name: 'synthetic-local-bill.pdf',
              mimeType: 'application/pdf',
              buffer: pdf,
            })
            await page.getByRole('button', { name: l.review, exact: true }).click()
            const scanned = (await state()).imports.find(
              (item) => item.filename === 'synthetic-local-bill.pdf',
            )
            expect([scanned.scan.subtotal, scanned.scan.tax, scanned.scan.total]).toEqual([
              20000, 4200, 24200,
            ])
            await expect(
              dialog.getByRole('img', {
                name:
                  locale === 'nl'
                    ? 'Originele factuur synthetic-local-bill.pdf, pagina 1'
                    : 'Original bill synthetic-local-bill.pdf, page 1',
              }),
            ).toBeVisible()
            await dialog.getByLabel(l.vendor).fill('Synthetic reviewed bill')
            await dialog.getByLabel(l.description).fill('Sales revenue')
            await dialog.getByLabel(l.quantity).fill('2')
            await dialog.getByLabel(l.price).fill(price)
            await dialog.getByLabel(l.date, { exact: true }).fill('2026-11-03')
            await dialog.getByLabel(l.dueDate, { exact: true }).fill('2026-12-03')
            await expect(dialog.getByRole('button', { name: l.saveDraft })).toBeDisabled()
            await dialog.getByLabel(l.reviewed).check()
            await dialog.getByRole('button', { name: l.saveDraft }).click()
            await expect(dialog).toHaveCount(0)
            const reviewedDraft = (await state()).documents.find(
              (d) => d.partner === 'Synthetic reviewed bill',
            )
            expect(reviewedDraft.status).toBe('draft')
            expect(reviewedDraft.entries).toEqual([])
            const bill = await postAndPay('Synthetic reviewed bill')
            expect(bill.sourceId).toBeTruthy()
            expect((await state()).imports.find((i) => i.id === bill.sourceId).documentId).toBe(
              bill.id,
            )
            // Both narrow and wide layouts, dialog keyboard trap and focus restoration.
            for (const width of [390, 1280]) {
              await page.setViewportSize({ width, height: 844 })
              expect(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              ).toBe(true)
            }
            await page.getByRole('button', { name: l.pay, exact: true }).click()
            await page.keyboard.press('Tab')
            expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
            await page.keyboard.press('Escape')
            await expect(dialog).toHaveCount(0)
            await expect(page.getByRole('button', { name: l.pay, exact: true })).toBeFocused()
            await restart()
            await page.goto(`${origin}/accounting/invoices`)
            await page
              .getByRole('table')
              .getByRole('button', { name: 'Draft', exact: true })
              .click()
            await expect(page.getByText(l.outstanding, { exact: true })).toBeVisible()
            const persisted = await state()
            expect(persisted.documents.find((d) => d.id === invoice.id)).toEqual(invoice)
            expect(persisted.documents.find((d) => d.id === bill.id)).toEqual(bill)
            await page.getByRole('button', { name: l.contacts, exact: true }).click()
            await page.goBack()
            await expect(page).toHaveURL(`${origin}/accounting/invoices`)
            await page.reload()
            await expect(page.locator('html')).toHaveAttribute('lang', locale)
            // Expire the real signed cookie, then ensure stale protected data disappears.
            expect(
              (await transport.fetch(context.request, `${origin}/fixture/expired`)).status(),
            ).toBe(204)
            await page.reload()
            await expect(page.getByRole('heading', { name: l.protected })).toBeVisible()
            await expect(page.getByText('SYNTHETIC-TRANSFER')).toHaveCount(0)
            await expect(page.getByLabel(l.token)).toHaveCount(0)
          },
        )
      })
      await test(`${locale}: real authenticated read denial is not a 401`, async () => {
        await fixture(locale, [], async ({ page, l, api }) => {
          await expect(page.getByRole('heading', { name: l.forbidden, exact: true })).toBeVisible()
          await expect(page.getByRole('button', { name: l.signOut })).toBeVisible()
          expect((await api('state')).status()).toBe(403)
          expect((await api('contacts', { name: 'No write' })).status()).toBe(403)
          await expect(page.getByLabel(l.signedIn)).toBeVisible()
          await expect(page.getByRole('link', { name: l.signIn })).toHaveCount(0)
        })
      })
    }
  } finally {
    if (browser) await browser.close()
    if (transport) await transport.close()
    for (const owner of children) await owner.stop()
    await mongo.stop()
  }
}

if (process.argv[2] === '--isolated') await isolated()
else await launch()
