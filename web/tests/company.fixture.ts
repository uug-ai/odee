import { chromium, request, test, expect } from '@playwright/test'
import { createLocalTransport } from './local-transport.mjs'
import type { Contact, ContactData, CompanyProfile, State } from '../src/types'

const copy = {
  en: {
    language: 'Language',
    token: 'Company access token',
    open: 'Open workspace',
    settings: 'Legal company profile',
    name: 'Name',
    saveProfile: 'Save company profile',
    saved: 'Company profile saved.',
    enterprise: 'Enterprise identifier',
    bank: 'Bank account / IBAN',
    applicability: 'Tax applicability',
    unknown: 'Unknown / not assessed',
    invoices: 'Invoices',
    newInvoice: 'New invoice',
    select: 'Choose a saved contact',
    customer: 'Customer name',
    description: 'Line 1 description',
    price: 'Line 1 unit price',
    save: 'Save draft',
    edit: 'Edit draft',
    refreshContact: 'Refresh saved contact',
    refreshCompany: 'Refresh own company capture',
    manual: 'Convert to manual entry',
    post: 'Post document',
    confirm: 'Confirm posting',
    cancel: 'Cancel',
    refresh: 'Refresh workspace',
    archived: 'archived contacts cannot be selected or refreshed',
  },
  nl: {
    language: 'Taal',
    token: 'Bedrijfstoegangstoken',
    open: 'Werkruimte openen',
    settings: 'Juridisch bedrijfsprofiel',
    name: 'Naam',
    saveProfile: 'Bedrijfsprofiel opslaan',
    saved: 'Bedrijfsprofiel opgeslagen.',
    enterprise: 'Ondernemingsnummer',
    bank: 'Bankrekening / IBAN',
    applicability: 'Fiscale toepasselijkheid',
    unknown: 'Onbekend / niet beoordeeld',
    invoices: 'Klantfacturen',
    newInvoice: 'Nieuwe klantfactuur',
    select: 'Kies een opgeslagen contact',
    customer: 'Naam klant',
    description: 'Regel 1 omschrijving',
    price: 'Regel 1 eenheidsprijs',
    save: 'Concept opslaan',
    edit: 'Concept bewerken',
    refreshContact: 'Opgeslagen contact vernieuwen',
    refreshCompany: 'Eigen bedrijfsgegevens vernieuwen',
    manual: 'Omzetten naar handmatige invoer',
    post: 'Document boeken',
    confirm: 'Boeking bevestigen',
    cancel: 'Annuleren',
    refresh: 'Werkruimte vernieuwen',
    archived: 'Gearchiveerde contacten kunnen niet worden geselecteerd of vernieuwd',
  },
}

for (const locale of ['en', 'nl'] as const) {
  test(`protected ${locale}: complete saved-contact and legal-company snapshot lifecycle`, async () => {
    const origin = process.env.ODEE_COMPANY_TEST_ORIGIN
    const token = process.env.ODEE_COMPANY_TEST_TOKEN
    test.skip(
      !origin || !token,
      'run node web/tests/company.mjs for the owned disposable Mongo fixture',
    )
    const transport = await createLocalTransport([origin!])
    const browser = await transport.launch(chromium)
    const context = await browser.newContext({ proxy: transport.proxy, serviceWorkers: 'block' })
    await context.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ contentType: 'text/css', body: '/* offline system fonts */' }),
    )
    const api = await request.newContext({ proxy: transport.proxy })
    const l = copy[locale]
    try {
      const call = async <T>(
        path: string,
        method = 'GET',
        data?: unknown,
        expected = 200,
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
        expect(response.status(), await response.text()).toBe(expected)
        return response.json()
      }
      const state = () => call<State>('state')
      const get = async (id: string) => (await state()).documents.find((d) => d.id === id)!
      const profile = () => call<CompanyProfile>('company-profile')
      const data: ContactData = {
        name: `Contact ${locale}`,
        isCompany: true,
        companyName: '',
        email: `${locale}@example.invalid`,
        phone: '',
        mobile: '',
        website: '',
        vat: 'BE0123456749',
        reference: 'Imported source text',
        type: 'contact',
        address: {
          street: 'Synthetic 1',
          street2: '',
          postalCode: '1000',
          city: 'Brussels',
          state: '',
          country: 'BE',
        },
        tags: ['Draft'],
        customer: true,
        vendor: true,
        active: true,
        enterpriseId: '0123456749',
        bankAccount: 'BE68539007547034',
        bic: 'TESTBEBB',
        paymentTerms: '30 days',
        taxApplicability: 'unknown',
      }
      let contact = await call<Contact>('contacts', 'POST', data, 201)
      contact = (await state()).contacts.find((item) => item.id === contact.id)!
      const page = await context.newPage()
      const pageErrors: string[] = []
      page.on('pageerror', (error) => {
        pageErrors.push(error.message)
        console.error('Owned app page error:', error.message)
      })
      await page.addInitScript((locale) => localStorage.setItem('odee.locale', locale), locale)
      await page.goto(`${origin}/accounting/settings`)
      await page.getByLabel(l.token).fill(token!)
      await page.getByRole('button', { name: l.open, exact: true }).click()
      await expect(page.getByRole('heading', { name: l.settings, exact: true })).toBeVisible()
      await page.getByLabel(l.name, { exact: true }).fill(`Company ${locale} v1`)
      await page.getByLabel(l.enterprise, { exact: true }).fill('0123456749')
      const profileBeforeInvalid = (await state()).companyProfile
      await page.getByLabel(l.bank, { exact: true }).fill('BE00539007547034')
      await page.getByRole('button', { name: l.saveProfile, exact: true }).click()
      await expect(page.getByRole('alert')).toContainText(
        locale === 'nl'
          ? 'Ongeldig controlegetal voor Belgische IBAN'
          : 'invalid Belgian IBAN checksum',
      )
      expect((await state()).companyProfile).toEqual(profileBeforeInvalid)
      await expect(page.getByLabel(l.name, { exact: true })).toHaveValue(`Company ${locale} v1`)
      await page.getByLabel(l.bank, { exact: true }).fill('BE68539007547034')
      await page.getByRole('button', { name: l.saveProfile, exact: true }).click()
      await expect(page.getByText(l.saved, { exact: true })).toBeVisible()
      let p1 = await profile()
      expect(p1.data.name).toBe(`Company ${locale} v1`)
      const concurrent = await call<CompanyProfile>('company-profile', 'PUT', {
        version: p1.version,
        data: { ...p1.data, name: `Concurrent ${locale}` },
      })
      await page.getByLabel(l.name, { exact: true }).fill(`Unsaved ${locale}`)
      await page.getByRole('button', { name: l.saveProfile, exact: true }).click()
      await expect(page.getByRole('alert')).toContainText(
        locale === 'nl'
          ? 'Document gewijzigd; vernieuw voordat je opnieuw probeert'
          : 'document changed; refresh before trying again',
      )
      expect((await profile()).version).toBe(concurrent.version)
      expect((await profile()).data.name).toBe(`Concurrent ${locale}`)
      await page
        .getByRole('button', {
          name: locale === 'nl' ? 'Opgeslagen profiel opnieuw laden' : 'Reload saved profile',
          exact: true,
        })
        .click()
      await expect(page.getByLabel(l.name, { exact: true })).toHaveValue(`Concurrent ${locale}`)
      await page.getByLabel(l.name, { exact: true }).fill(`Company ${locale} v1`)
      await page.getByRole('button', { name: l.saveProfile, exact: true }).click()
      await expect(page.getByText(l.saved, { exact: true })).toBeVisible()
      p1 = await profile()
      const dialog = page.getByRole('dialog')
      await page
        .getByRole('button', { name: locale === 'nl' ? 'Contacten' : 'Contacts', exact: true })
        .click()
      await page
        .getByRole('button', {
          name: locale === 'nl' ? `Contact ${contact.name} openen` : `Open contact ${contact.name}`,
          exact: true,
        })
        .click()
      await dialog
        .getByRole('button', {
          name: locale === 'nl' ? 'Contact bewerken' : 'Edit contact',
          exact: true,
        })
        .click()
      await expect(dialog.getByLabel(l.bank, { exact: true })).toHaveValue(data.bankAccount!)
      await expect(dialog.getByLabel(l.enterprise, { exact: true })).toHaveValue(data.enterpriseId!)
      await dialog.getByLabel('BIC', { exact: true }).fill('invalid')
      await dialog
        .getByRole('button', {
          name: locale === 'nl' ? 'Contact opslaan' : 'Save contact',
          exact: true,
        })
        .click()
      await expect(dialog.getByRole('alert')).toContainText(
        locale === 'nl'
          ? 'BIC moet 8 of 11 geldige tekens bevatten'
          : 'BIC must contain 8 or 11 valid characters',
      )
      expect((await state()).contacts.find((c) => c.id === contact.id)).toEqual(contact)
      await dialog.getByRole('button', { name: l.cancel, exact: true }).click()
      async function refreshWorkspace() {
        const button = page.getByRole('button', { name: l.refresh, exact: true })
        await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url() === `${origin}/api/state` && response.request().method() === 'GET',
          ),
          button.click(),
        ])
        await expect(button).toBeEnabled()
      }
      async function create(selection: boolean) {
        await page.getByRole('button', { name: new RegExp(`^${l.invoices}(?: \\d+)?$`) }).click()
        await refreshWorkspace()
        await page.getByRole('button', { name: l.newInvoice, exact: true }).click()
        if (selection) await dialog.getByLabel(l.select, { exact: true }).selectOption(contact.id)
        else await dialog.getByLabel(l.customer, { exact: true }).fill(`Manual ${locale}`)
        await dialog.getByLabel(l.description, { exact: true }).fill('Business data: Draft')
        await dialog
          .getByLabel(l.price, { exact: true })
          .fill(locale === 'nl' ? '100,05' : '100.05')
        await dialog.getByRole('button', { name: l.save, exact: true }).click()
        await expect(dialog).toHaveCount(0)
        return (await state()).documents.find(
          (d) =>
            d.partner === (selection ? contact.name : `Manual ${locale}`) && d.status === 'draft',
        )!
      }
      let doc = await create(true)
      expect(doc.partnerSnapshot).toMatchObject({
        contactId: contact.id,
        sourceVersion: 1,
        schemaVersion: 1,
        data: { bankAccount: data.bankAccount, name: data.name },
      })
      expect(doc.ownCompanySnapshot).toMatchObject({
        sourceVersion: p1.version,
        role: 'seller',
        data: { name: p1.data.name },
      })
      expect(doc.lines[0].unitCents).toBe(10005)
      const initial = structuredClone(doc)
      contact = await call<Contact>(`contacts/${contact.id}`, 'PUT', {
        ...data,
        name: `Contact ${locale} v2`,
        bankAccount: 'BE62510007547061',
        version: contact.version,
      })
      const changeProfile = async (name: string) => {
        await page.getByRole('button', { name: l.settings, exact: true }).click()
        await expect(page.getByRole('heading', { name: l.settings, exact: true })).toBeVisible()
        await page.getByLabel(l.name, { exact: true }).fill(name)
        await page.getByRole('button', { name: l.saveProfile, exact: true }).click()
        await expect(page.getByText(l.saved, { exact: true })).toBeVisible()
      }
      await changeProfile(`Company ${locale} v2`)
      const p2 = await profile()
      const openDoc = async (id: string) => {
        await page.getByRole('button', { name: new RegExp(`^${l.invoices}(?: \\d+)?$`) }).click()
        const d = await get(id)
        await page.getByRole('button', { name: d.partner, exact: true }).click()
        await expect(page.getByRole('button', { name: l.edit, exact: true })).toBeVisible()
      }
      await openDoc(doc.id)
      await page.getByRole('button', { name: l.edit, exact: true }).click()
      await expect(dialog.getByLabel(l.customer, { exact: true })).toHaveAttribute('readonly', '')
      await dialog.getByRole('button', { name: l.save, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      doc = await get(doc.id)
      expect(doc.partnerSnapshot).toEqual(initial.partnerSnapshot)
      expect(doc.ownCompanySnapshot).toEqual(initial.ownCompanySnapshot)
      await page.getByRole('button', { name: l.edit, exact: true }).click()
      await dialog.getByRole('button', { name: l.refreshContact, exact: true }).click()
      await dialog.getByRole('button', { name: l.refreshCompany, exact: true }).click()
      await dialog.getByRole('button', { name: l.save, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      doc = await get(doc.id)
      expect(doc.partnerSnapshot).toMatchObject({
        sourceVersion: 2,
        data: { name: contact.name, bankAccount: contact.bankAccount },
      })
      expect(doc.ownCompanySnapshot).toMatchObject({
        sourceVersion: p2.version,
        data: { name: p2.data.name },
      })
      contact = await call<Contact>(`contacts/${contact.id}`, 'PUT', {
        ...contactData(contact),
        active: false,
        version: contact.version,
      })
      await refreshWorkspace()
      await page.getByRole('button', { name: l.edit, exact: true }).click()
      await dialog.getByRole('button', { name: l.refreshContact, exact: true }).click()
      const beforeRejected = await get(doc.id)
      await dialog.getByRole('button', { name: l.save, exact: true }).click()
      await expect(dialog.getByRole('alert')).toContainText(l.archived)
      expect(await get(doc.id)).toEqual(beforeRejected)
      await dialog.getByRole('button', { name: l.cancel, exact: true }).click()
      await page.getByRole('button', { name: l.post, exact: true }).click()
      await dialog.getByRole('button', { name: l.confirm, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const posted = await get(doc.id)
      expect(posted.status).toBe('posted')
      await changeProfile(`Company ${locale} v3`)
      contact = await call<Contact>(`contacts/${contact.id}`, 'PUT', {
        ...contactData(contact),
        name: `Contact ${locale} v3`,
        active: true,
        version: contact.version,
      })
      expect(await get(doc.id)).toEqual(posted)
      contact = await call<Contact>(`contacts/${contact.id}`, 'PUT', {
        ...contactData(contact),
        active: false,
        version: contact.version,
      })
      expect(await get(doc.id)).toEqual(posted)
      contact = await call<Contact>(`contacts/${contact.id}`, 'PUT', {
        ...contactData(contact),
        active: true,
        version: contact.version,
      })
      // Separate draft proves explicit manual conversion retains metadata.
      let converted = await create(true)
      await page.getByRole('button', { name: l.edit, exact: true }).click()
      await dialog.getByRole('button', { name: l.manual, exact: true }).click()
      await dialog.getByLabel(l.customer, { exact: true }).fill(`Converted ${locale}`)
      await dialog.getByRole('button', { name: l.save, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      converted = await get(converted.id)
      expect(converted.partner).toBe(`Converted ${locale}`)
      expect(converted.partnerSnapshot?.contactId).toBe('000000000000000000000000')
      expect(converted.partnerSnapshot?.data.bankAccount).toBe(contact.bankAccount)
      const manual = await create(false)
      expect(manual.partnerSnapshot).toBeUndefined()
      expect(manual.ownCompanySnapshot?.role).toBe('seller')
      expect(transport.denied).toEqual([])
      expect(pageErrors).toEqual([])
    } finally {
      await api.dispose()
      await context.close()
      await browser.close()
      await transport.close()
    }
  })
}

function contactData(contact: Contact): ContactData {
  const { id, version, createdAt, updatedAt, odoo, ...data } = contact
  return data
}

test('protected read-only settings: both locales retain session and reject profile mutation without writes', async () => {
  const origin = process.env.ODEE_COMPANY_TEST_ORIGIN
  const token = process.env.ODEE_COMPANY_TEST_TOKEN
  test.skip(!origin || !token, 'run node web/tests/company.mjs')
  const transport = await createLocalTransport([origin!])
  const browser = await transport.launch(chromium)
  const api = await request.newContext({ proxy: transport.proxy })
  try {
    const fetch = (path: string, method = 'GET', data?: unknown) =>
      transport.fetch(api, `${origin}/api/${path}`, {
        method,
        data,
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: origin!,
          'Content-Type': 'application/json',
        },
      })
    const before = await (await fetch('state')).json()
    const denied = await fetch('company-profile', 'PUT', {
      version: before.companyProfile.version,
      data: {},
    })
    expect(denied.status()).toBe(403)
    const session = await (await fetch('session')).json()
    expect(session.authenticated).toBe(true)
    expect(session.access.capabilities).toEqual(['read'])
    expect(await (await fetch('state')).json()).toEqual(before)
    for (const locale of ['en', 'nl'] as const) {
      const context = await browser.newContext({ proxy: transport.proxy, serviceWorkers: 'block' })
      await context.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({ contentType: 'text/css', body: '/* offline system fonts */' }),
      )
      try {
        await context.addInitScript((locale) => localStorage.setItem('odee.locale', locale), locale)
        const page = await context.newPage()
        await page.goto(`${origin}/accounting/settings`)
        await page.getByLabel(copy[locale].token).fill(token!)
        await page.getByRole('button', { name: copy[locale].open, exact: true }).click()
        await expect(
          page.getByRole('button', { name: copy[locale].saveProfile, exact: true }),
        ).toBeDisabled()
        await expect(page.getByLabel(copy[locale].name, { exact: true })).toBeDisabled()
        await expect(
          page.getByText(
            locale === 'nl'
              ? 'Alleen-lezen. Voor wijzigingen aan het bedrijfsprofiel zijn lees- en beheerdersrechten vereist.'
              : 'Read-only. Company profile changes require read and admin capabilities.',
            { exact: true },
          ),
        ).toBeVisible()
      } finally {
        await context.close()
      }
    }
    expect(transport.denied).toEqual([])
  } finally {
    await api.dispose()
    await browser.close()
    await transport.close()
  }
})
