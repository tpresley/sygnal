// PLAN-4 P-2/P-2b: scripted HMR check in Vite dev (sygnal/vite appends the accept to
// src/elements.js). Edit Board.jsx while the pages run; the
// element must re-render with the new view, keep its state, and not reload the page.
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

if (process.env.P2_PLAIN_ESBUILD === '1') {
  console.log('SKIP: without the sygnal/vite plugin src/elements.js has no HMR accept')
  process.exit(0)
}

const here = new URL('.', import.meta.url).pathname
const file = here + 'src/Board.jsx'
const original = readFileSync(file, 'utf8')
const server = await createServer({ configFile: here + 'vite.config.js', server: { port: 0, host: '127.0.0.1' } })
await server.listen()
const url = `http://127.0.0.1:${server.httpServer.address().port}/`
const browser = await chromium.launch()
let ok = true
try {
  for (const pagePath of ['plain.html', 'index.html']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(url + pagePath)
    await page.waitForTimeout(1500)            // first visit: Vite's dep optimizer may reload once
    await page.goto(url + pagePath)
    await page.evaluate(() => (window.__marker = 'no-reload'))
    const sel = (s) => page.evaluate((s) => document.getElementById('tb').shadowRoot.querySelector(s)?.textContent, s)
    await page.waitForFunction(() => document.getElementById('tb')?.shadowRoot?.querySelector('.btn'))
    await page.evaluate(() => { const b = document.getElementById('tb').shadowRoot.querySelector('.btn'); b.click(); b.click() })
    await page.waitForFunction(() => document.getElementById('tb').shadowRoot.querySelector('.meta').textContent.endsWith('|2'))
    const metaBefore = await sel('.meta')
    writeFileSync(file, original.replace('Board: {state.heading}', 'Board v2: {state.heading}'))
    await page.waitForFunction(() => document.getElementById('tb').shadowRoot.querySelector('.title')?.textContent.startsWith('Board v2'), null, { timeout: 5000 })
    await page.waitForTimeout(150)
    const res = { page: pagePath, title: await sel('.title'), metaBefore, metaAfter: await sel('.meta'),
      reloaded: (await page.evaluate(() => window.__marker)) !== 'no-reload', errors }
    await page.evaluate(() => document.getElementById('tb').shadowRoot.querySelector('.btn').click())
    await page.waitForTimeout(50)
    res.afterClick = await sel('.meta')
    const pass = !res.reloaded && res.metaAfter === metaBefore && res.afterClick.endsWith('|3') && !errors.length
    ok &&= pass
    console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(res))
    writeFileSync(file, original)
    await page.waitForTimeout(300)
    await page.close()
  }
} finally {
  writeFileSync(file, original)
  await browser.close()
  await server.close()
}
process.exit(ok ? 0 : 1)
