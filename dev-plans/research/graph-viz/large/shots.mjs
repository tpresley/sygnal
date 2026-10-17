#!/usr/bin/env node
/**
 * S-1: the screenshots in large-apps.md (synthetic corpora only), small PNGs in shots/.
 *   node shots.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { renderPage } from './render.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, 'shots'); fs.mkdirSync(dir, { recursive: true })
fs.mkdirSync(path.join(here, 'out'), { recursive: true })
const page = async (name) => { const f = path.join(here, 'out', name + '.html'); fs.writeFileSync(f, await renderPage({ graph: JSON.parse(fs.readFileSync(path.join(here, 'corpus', name + '.json'), 'utf8')), title: name })); return pathToFileURL(f).href }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 0.5 })
async function shot(file, url, steps = async () => {}) {
  const p = await ctx.newPage()
  await p.goto(url); await p.waitForFunction(() => window.__ready)
  await steps(p); await p.waitForTimeout(700)
  await p.screenshot({ path: path.join(dir, file) })
  await p.close()
}
const u2000 = await page('syn-2000'), u200 = await page('syn-200')
await shot('2000-spike-flat.png', u2000 + '?preset=spike')
await shot('2000-auto-folded.png', u2000)
await shot('2000-open-shop.png', u2000, async p => { await p.locator('#nodes .node.group', { hasText: 'shop' }).first().click() })
await shot('2000-focus-checkout.png', u2000, async p => { await p.click('#q'); await p.keyboard.type('Checkout'); await p.waitForTimeout(200); await p.keyboard.press('Enter') })
await shot('2000-events-table.png', u2000, async p => { await p.click('.tab[data-view=events]'); await p.fill('#ev-q', 'NAVIGATE') })
await shot('2000-icicle.png', u2000 + '?view=icicle')
await shot('200-auto-open-groups.png', u200)
await shot('200-subtrees-depth4.png', u200 + '?preset=custom&group=dir&fold=open&depth=4&events=bus')
await browser.close()
for (const f of fs.readdirSync(dir)) process.stderr.write(`${f} ${(fs.statSync(path.join(dir, f)).size / 1024).toFixed(0)} KB\n`)
