/**
 * PLAN-10 E-2: the graph page as the VS Code panel builds it (`host: 'vscode'`, a script nonce), in
 * a real browser with a stand-in for the webview API (`acquireVsCodeApi`: postMessage / getState /
 * setState recorded on window). run-headless.mjs calls it with the graph view suites
 * (BROWSER_TESTS_ONLY=graphview runs them; BROWSER_TESTS_GRAPHVIEW=0 skips them).
 *
 * Checks: the inline script runs under the nonce CSP and says `ready`; the page's tokens follow
 * VS Code's theme variables and theme kind (body class); the theme toggle, downloads and the editor
 * choice are hidden; an editor link becomes an `open` message (file relative to the root, the
 * line) and never navigates; a `graph` message updates in place keeping the selection; a `reveal`
 * message selects by key; the saved state brings the selection and view back after a reload.
 * Fails on any console error, uncaught error or network request.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const FIXTURE = 'sygnal-check/test/fixtures/graph-shop'

/** The stand-in for VS Code's webview API: what the page posts and saves, on window. */
function fakeVscode(saved) {
  window.__posted = []
  window.__saved = saved ?? null
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => { window.__posted.push(JSON.parse(JSON.stringify(m))) },
    getState: () => window.__saved,
    setState: (s) => { window.__saved = JSON.parse(JSON.stringify(s)) },
  })
}

export async function runGraphVscode(browser, engine) {
  const t0 = Date.now()
  const { graph } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/graph.js')))
  const { graphHtml } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/graphView/html.js')))
  const g = graph([FIXTURE], { cwd: repo })
  const root = repo.replace(/\\/g, '/')
  const nonce = crypto.randomBytes(18).toString('base64')
  const rootUri = pathToFileURL(repo).href
  const file = path.join(os.tmpdir(), `sygnal-graph-vscode-test-${process.pid}.html`)
  fs.writeFileSync(file, graphHtml(g, { title: 'shop', root, rootUri, version: 1, editor: 'vscode', host: 'vscode', nonce }))
  const url = pathToFileURL(file).href

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } })
  const page = await ctx.newPage()
  const errors = [], requests = []
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`) })
  page.on('pageerror', e => errors.push(`[uncaught] ${e.stack || e.message}`))
  page.on('request', r => { if (r.url() !== url) requests.push(r.url()) })
  await ctx.route('**/*', route => route.request().url() === url ? route.continue() : route.abort())

  const results = []
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }) } catch (e) { results.push({ name, pass: false, detail: e.message.split('\n').slice(0, 8).join(' | ') }) }
  }
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
  const ok = (v, what) => { if (!v) throw new Error(what) }
  const posted = (type) => page.evaluate((t) => window.__posted.filter(m => m.type === t), type)
  const cartKey = 'sygnal-check/test/fixtures/graph-shop/src/Cart.jsx#Cart'
  const appKey = 'sygnal-check/test/fixtures/graph-shop/src/App.jsx#App'

  try {
    await page.addInitScript(fakeVscode, null)
    await page.goto(url)
    await page.waitForFunction(() => window.__sygnalGraph && window.__sygnalVscode, undefined, { timeout: 10000 })

    await check('the script runs by its nonce and says ready', async () => {
      eq(await posted('ready'), [{ type: 'ready', version: 1 }], 'ready')
      eq(await page.locator('#nodes .node').count() > 5, true, 'cards drawn')
      eq(await page.evaluate(() => document.documentElement.dataset.host), 'vscode', 'host marked')
    })

    await check("VS Code's theme: variables and kind", async () => {
      // (VS Code sets its variables on the html element, as here, and its classes on the body)
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--vscode-editor-background', 'rgb(18, 52, 86)')
        document.documentElement.style.setProperty('--vscode-editor-foreground', 'rgb(240, 241, 242)')
        document.body.className = 'vscode-light'
      })
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      eq(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(18, 52, 86)', 'background from --vscode-editor-background')
      eq(await page.evaluate(() => getComputedStyle(document.body).color), 'rgb(240, 241, 242)', 'text from --vscode-editor-foreground')
      await page.evaluate(() => { document.body.className = 'vscode-dark' })
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    })

    await check('the theme toggle, downloads and the editor choice are hidden', async () => {
      for (const sel of ['#m-theme', '#m-svg', '#m-json']) eq(await page.locator(sel).evaluate(e => e.hidden), true, sel)
      eq(await page.locator('#editor').evaluate(e => e.closest('label').hidden), true, 'editor choice')
      eq(await page.locator('#editor').inputValue(), 'vscode', 'links for the panel')
    })

    await check('an editor link becomes an open message and never navigates', async () => {
      await page.evaluate((k) => window.__sygnalGraph.select(window.__sygnalGraph.model.byKey.get(k)), cartKey)
      const link = page.locator('#dinner a[href^="vscode://file"]').first()
      ok(await link.count(), 'a file link in the details')
      const href = await link.getAttribute('href')
      await link.click()
      const opens = await posted('open')
      eq(opens.length, 1, 'one open message')
      eq(opens[0].file, 'sygnal-check/test/fixtures/graph-shop/src/Cart.jsx', 'file relative to the root')
      eq(opens[0].line, Number(/:(\d+)$/.exec(href)[1]), 'line')
      eq(page.url(), url, 'no navigation')
    })

    await check('a graph message updates in place and keeps the selection', async () => {
      const next = JSON.parse(JSON.stringify(g))
      next.components = next.components.filter(c => c.name !== 'ProductCard')
      await page.evaluate((gr) => window.postMessage({ type: 'graph', graph: gr, version: 2 }, '*'), next)
      await page.waitForFunction(() => window.__posted.some(m => m.type === 'applied'))
      eq(await posted('applied'), [{ type: 'applied', version: 2, components: next.components.length }], 'applied')
      eq(await page.evaluate(() => window.__sygnalGraph.selectedKey), cartKey, 'selection kept')
      // the same version again: nothing redrawn, still acknowledged
      await page.evaluate((gr) => window.postMessage({ type: 'graph', graph: gr, version: 2 }, '*'), g)
      await page.waitForFunction(() => window.__posted.filter(m => m.type === 'applied').length === 2)
      eq(await page.evaluate(() => window.__sygnalGraph.model.graph.components.length), next.components.length, 'same version not applied')
    })

    await check('a reveal message selects the component by key', async () => {
      await page.evaluate((k) => window.postMessage({ type: 'reveal', key: k }, '*'), appKey)
      await page.waitForFunction(() => window.__posted.some(m => m.type === 'revealed'))
      eq(await page.evaluate(() => window.__sygnalGraph.selectedKey), appKey, 'App selected')
      eq((await posted('revealed'))[0], { type: 'revealed', key: appKey, selected: appKey }, 'revealed')
      await page.evaluate(() => window.postMessage({ type: 'reveal', key: 'no/such#Thing' }, '*'))
      await page.waitForFunction(() => window.__posted.filter(m => m.type === 'revealed').length === 2)
      eq(await page.evaluate(() => window.__sygnalGraph.selectedKey), appKey, 'an unknown key changes nothing')
    })

    await check('the saved state brings the selection, the view and the search back', async () => {
      await page.waitForFunction(() => !window.__sygnalGraph.animating, undefined, { timeout: 3000 })
      const box = await page.locator('#svg').boundingBox()
      await page.mouse.move(box.x + 300, box.y + 300)
      await page.mouse.wheel(0, 200)
      await page.locator('#q').fill('Cart')
      await page.waitForFunction(() => window.__saved?.query === 'Cart', undefined, { timeout: 3000 })
      const saved = await page.evaluate(() => window.__saved)
      eq(saved.root, rootUri, 'root in the state')
      eq(saved.selected, appKey, 'selection in the state')
      // VS Code re-creates the page from the same html, with the state
      await page.addInitScript(fakeVscode, saved)
      await page.reload()
      await page.waitForFunction(() => window.__sygnalVscode, undefined, { timeout: 10000 })
      eq(await page.evaluate(() => window.__sygnalGraph.selectedKey), appKey, 'selection restored')
      const view = await page.evaluate(() => window.__sygnalGraph.view)
      for (const k of ['x', 'y', 'k']) ok(Math.abs(view[k] - saved.view[k]) < 1e-6, `view.${k} restored (${view[k]} vs ${saved.view[k]})`)
      eq(await page.locator('#q').inputValue(), 'Cart', 'search restored')
      eq(await posted('ready'), [{ type: 'ready', version: 1 }], 'ready again, with the html\'s version')
    })
  } catch (e) {
    results.push({ name: 'page', pass: false, detail: e.message.split('\n')[0] })
  } finally {
    await ctx.close()
    fs.rmSync(file, { force: true })
  }

  const failed = results.filter(r => !r.pass)
  const lines = [`Graph view in the VS Code panel (${engine} ${browser.version()}): ${results.length - failed.length}/${results.length} passed`]
  for (const f of failed) lines.push(`  FAIL: ${f.name} — ${f.detail}`)
  for (const e of errors) lines.push(`  FAIL: ${e}`)
  if (requests.length) lines.push(`  FAIL: ${requests.length} network request(s): ${requests.slice(0, 5).join(', ')}`)
  console.log(lines.join('\n') + `\nGraph view in the VS Code panel: ${Date.now() - t0} ms\n`)
  return failed.length + errors.length + requests.length
}
