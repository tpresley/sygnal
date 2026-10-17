/**
 * PLAN-10 W-1: `sygnal-check --graph=html --watch` in a real browser. run-headless.mjs calls it with
 * the graph view suite (BROWSER_TESTS_ONLY=graphview runs both; BROWSER_TESTS_GRAPHVIEW=0 skips both).
 *
 * Copies the shop fixture to a temp directory, starts the watch server in this process (cli.js
 * watchGraph, as `sygnal-check --graph=html --watch --no-open` would) and opens its URL. Then edits
 * the copy on disk: a component's file gains lines above it (its id moves) and a new action, and the
 * page must update in place with the selection and the view kept, the card marked as changed and
 * the "live · updated" indicator showing; a syntax error keeps the last good graph and says so;
 * when the server stops the page says it is reconnecting. Fails on any console error, any uncaught
 * error, and any request other than the page and its event stream.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const FIXTURE = 'sygnal-check/test/fixtures/graph-shop/src'

export async function runGraphLive(browser, engine) {
  const t0 = Date.now()
  const { watchGraph, parseArgs } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/cli.js')))
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-graph-live-')))
  fs.cpSync(path.join(repo, FIXTURE), path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'shop-live' }))
  const cartFile = path.join(root, 'src/Cart.jsx')
  const cartText = fs.readFileSync(cartFile, 'utf8')
  const log = []
  const sink = { write: (s) => { log.push(String(s)) } }
  const h = await watchGraph(parseArgs(['--graph=html', '--watch', '--no-open']), { cwd: root, stdout: sink, stderr: sink, env: {}, isTTY: false, signals: null })

  const results = []
  const errors = [], requests = []
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }) } catch (e) { results.push({ name, pass: false, detail: e.message.split('\n').slice(0, 8).join(' | ') }) }
  }
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
  const ok = (v, what) => { if (!v) throw new Error(what) }
  let ctx = null
  let stopped = false
  try {
    if (!h.url) throw new Error(`the watch server didn't start: ${log.join('')}`)
    const base = new URL(h.url)
    ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, colorScheme: 'light' })
    const page = await ctx.newPage()
    page.on('console', m => { if (m.type() === 'error' && !stopped) errors.push(`[console.error] ${m.text()}`) })
    page.on('pageerror', e => errors.push(`[uncaught] ${e.stack || e.message}`))
    page.on('request', r => {
      const u = new URL(r.url())
      if (u.origin !== base.origin || !['/', '/events'].includes(u.pathname) || u.search !== base.search) requests.push(r.url())
    })
    const version = () => page.evaluate(() => window.__sygnalLive?.version)
    const indicator = () => page.locator('#live').textContent()
    const cartKey = 'src/Cart.jsx#Cart'

    await page.goto(h.url)
    await page.waitForFunction(() => window.__sygnalGraph && window.__sygnalLive, undefined, { timeout: 10000 })

    await check('the served page renders, with the live indicator', async () => {
      ok(await page.locator('#nodes .node').count() > 5, 'cards drawn')
      await page.waitForFunction(() => /^live · updated \d\d:\d\d:\d\d/.test(document.querySelector('#live')?.textContent || ''), undefined, { timeout: 5000 })
      eq(await version(), 1, 'graph version')
    })

    await check('a save updates the page in place: the selection, the view and the moved card stay', async () => {
      const id = await page.evaluate((k) => window.__sygnalGraph.model.byKey.get(k), cartKey)
      ok(id, 'Cart is in the graph')
      await page.locator(`#tree .tree-item[data-id="${id}"]`).click()
      eq(await page.evaluate(() => window.__sygnalGraph.selectedKey), cartKey, 'Cart selected')
      // the user moves the view: it must not jump back to a fit
      await page.waitForTimeout(600) // selecting from the list pans to the card after the panel opens
      await page.waitForFunction(() => !window.__sygnalGraph.animating, undefined, { timeout: 3000 })
      const box = await page.locator('#svg').boundingBox()
      await page.mouse.move(box.x + 60, box.y + box.height - 60)
      await page.mouse.wheel(30, 120)
      await page.waitForTimeout(100)
      const view = await page.evaluate(() => window.__sygnalGraph.view)
      const marker = await page.evaluate(() => { window.__notReloaded = true; return true })
      // two lines above the component (its id moves) and a new action
      fs.writeFileSync(cartFile, '// edited\n// twice\n' + cartText
        .replace("CHECKOUT: DOM.click('.checkout'),", "CHECKOUT: DOM.click('.checkout'),\n  CLEAR: DOM.click('.clear'),")
        .replace('<button className="checkout">Checkout</button>', '<button className="checkout">Checkout</button><button className="clear">Clear</button>')
        .replace('LINE_QTY: (state) => state,', 'LINE_QTY: (state) => state,\n  CLEAR: (state) => ({ ...state, cart: [] }),'))
      await page.waitForFunction(() => window.__sygnalLive.version === 2, undefined, { timeout: 5000 })
      ok(marker && await page.evaluate(() => window.__notReloaded === true), 'not reloaded')
      eq(await page.evaluate(() => window.__sygnalGraph.selectedKey), cartKey, 'still selected (by key)')
      const newId = await page.evaluate((k) => window.__sygnalGraph.model.byKey.get(k), cartKey)
      ok(newId && newId !== id, `the id moved (${id} → ${newId})`)
      ok(await page.locator('#detail.open').isVisible(), 'details still open')
      ok((await page.locator('#dinner').textContent()).includes('CLEAR'), 'the details show the new action')
      eq(await page.evaluate(() => window.__sygnalGraph.view), view, 'the view is kept')
      eq(await page.locator(`#nodes .node.live-changed[data-id="${newId}"]`).count(), 1, 'the card is marked as changed')
      eq(await page.locator('#nodes .node.live-changed').count(), 1, 'only that card')
      ok(/^live · updated/.test(await indicator()), 'indicator')
      // the mark goes away
      await page.waitForFunction(() => !document.querySelector('.live-changed'), undefined, { timeout: 6000 })
    })

    await check('a file that stops parsing keeps its last good version, and the page says so', async () => {
      fs.writeFileSync(cartFile, cartText.replace('Cart.model = {', 'Cart.model = {{'))
      await page.waitForFunction(() => window.__sygnalLive.version === 3, undefined, { timeout: 5000 })
      ok(await page.evaluate((k) => window.__sygnalGraph.model.byKey.has(k), cartKey), 'Cart is still there')
      ok(/Cart\.jsx doesn’t parse: last good version shown/.test(await indicator()), `indicator: ${await indicator()}`)
      eq(await page.evaluate(() => window.__sygnalGraph.selectedKey), cartKey, 'still selected')
      fs.writeFileSync(cartFile, cartText)
      await page.waitForFunction(() => window.__sygnalLive.version === 4, undefined, { timeout: 5000 })
      ok(!/parse/.test(await indicator()), 'the note is gone')
    })

    await check('a new component appears, marked as added', async () => {
      fs.writeFileSync(path.join(root, 'src/Promo.jsx'), "export default function Promo() { return <aside>promo</aside> }\nPromo.initialState = { seen: false }\n")
      await page.waitForFunction(() => window.__sygnalLive.version === 5, undefined, { timeout: 5000 })
      const pid = await page.evaluate(() => window.__sygnalGraph.model.byKey.get('src/Promo.jsx#Promo'))
      ok(pid, 'Promo is in the graph')
      eq(await page.locator(`#nodes .node.live-added[data-id="${pid}"]`).count(), 1, 'marked as added')
    })

    await check('when the server stops, the page says so and keeps the graph', async () => {
      stopped = true // the engine logs the refused reconnects
      await h.close()
      await page.waitForFunction(() => /reconnecting|disconnected/.test(document.querySelector('#live')?.textContent || ''), undefined, { timeout: 5000 })
      ok(await page.locator('#nodes .node').count() > 5, 'cards still drawn')
    })
  } catch (e) {
    results.push({ name: 'live page', pass: false, detail: e.message.split('\n')[0] })
  } finally {
    await h.close?.()
    await ctx?.close()
    fs.rmSync(root, { recursive: true, force: true })
  }

  const failed = results.filter(r => !r.pass)
  const lines = [`Graph view live page (${engine} ${browser.version()}): ${results.length - failed.length}/${results.length} passed`]
  for (const f of failed) lines.push(`  FAIL: ${f.name} — ${f.detail}`)
  for (const e of errors) lines.push(`  FAIL: ${e}`)
  if (requests.length) lines.push(`  FAIL: ${requests.length} unexpected request(s): ${requests.slice(0, 5).join(', ')}`)
  console.log(lines.join('\n') + `\nGraph view live page: ${Date.now() - t0} ms\n`)
  return failed.length + errors.length + requests.length
}
