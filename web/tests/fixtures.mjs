import { chromium } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function billFixtures() {
  const directory = await mkdtemp(join(tmpdir(), 'odee-test-bills-'))
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
    const text = [
      'Supplier: Example Supplies Ltd',
      'Invoice number: EX-2026-001',
      'Invoice date: 03/11/2026',
      'Due date: 03/12/2026',
      'Currency: EUR',
      'Consulting  2  100.00  21%  242.00',
      'Subtotal: 200.00',
      'VAT 21%: 42.00',
      'Total: 242.00 EUR',
    ].join('\n')
    await page.setContent(
      `<html><body style="margin:40px;background:white"><pre style="font:30px/1.7 monospace;color:black">${text}</pre></body></html>`,
    )
    await page.screenshot({ path: join(directory, 'bill.png') })
    await page.screenshot({ path: join(directory, 'bill.jpg'), type: 'jpeg', quality: 100 })
    await page.pdf({ path: join(directory, 'digital.pdf'), format: 'A4', scale: 0.7 })
    const image = await readFile(join(directory, 'bill.png'))
    await page.setContent(
      `<html><body style="margin:0"><img style="width:100%" src="data:image/png;base64,${image.toString('base64')}"></body></html>`,
    )
    await page.pdf({ path: join(directory, 'scanned.pdf'), format: 'A4' })
    await page.setContent(
      `<html><body style="margin:0"><p>This document was scanned locally; the original bill is embedded below.</p><img style="width:100%" src="data:image/png;base64,${image.toString('base64')}"></body></html>`,
    )
    await page.pdf({ path: join(directory, 'hybrid.pdf'), format: 'A4' })
    await page.setContent(
      `<html><body>${Array.from({ length: 11 }, (_, index) => `<section style="break-after:${index === 10 ? 'auto' : 'page'}">Synthetic page ${index + 1}</section>`).join('')}</body></html>`,
    )
    await page.pdf({ path: join(directory, 'too-many.pdf'), format: 'A4' })
    return directory
  } finally {
    await browser.close()
  }
}
