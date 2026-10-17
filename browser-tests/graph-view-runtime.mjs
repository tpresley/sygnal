/**
 * PLAN-10 V-3 and P-1 in a real browser (called by graph-view.mjs, so BROWSER_TESTS_ONLY=graphview
 * runs it):
 *
 * 1. The runtime page: `graphHtml()` of a real runtime inspect() graph
 *    (sygnal-check/test/fixtures/graph-runtime/shop.runtime.json, written by
 *    test/p10-runtime-view.test.js) from file://: cards ×N, two apps as clusters, the hidden
 *    Switchable page faded, context edges, the runtime health groups, the instances with state from a
 *    host, action flashes, a pushed state change, setGraph keeping the selection, a diagnostic's time.
 *    Fails on any network request (the page stays self-contained).
 * 2. The devtools panel's App graph (P-1) with the extension as `devtools/build.mjs` builds it, served
 *    from one origin; `chrome.runtime` is a stub that relays the panel's port to a second page running a
 *    real app (p10-devtools-app.html: sygnal/diagnostics + sygnal/devtools, as sygnal/vite loads them in
 *    dev), the way background.js and content-script.js relay. The frame's own CSP is stricter than
 *    the extension's MV3 default (script-src 'self'), so a script it blocks fails here too.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')

export async function runRuntimeView(browser, engine, appUrl) {
  const t0 = Date.now()
  const results = []
  const errors = []
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }) } catch (e) { results.push({ name, pass: false, detail: e.message.split('\n').slice(0, 8).join(' | ') }) }
  }
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
  const ok = (v, what) => { if (!v) throw new Error(what) }

  // ───────────── 1. the runtime page from file:// ─────────────
  const { graphHtml } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/graphView/html.js')))
  const raw = JSON.parse(fs.readFileSync(path.join(repo, 'sygnal-check/test/fixtures/graph-runtime/shop.runtime.json'), 'utf8'))
  const reported = Date.UTC(2026, 9, 16, 9, 30, 15)
  raw.diagnostics = [{ code: 'SYG105', severity: 'warn', message: 'EVENTS type NAVIGATE is selected but never emitted', timestamp: reported }]
  const file = path.join(os.tmpdir(), `sygnal-graph-runtime-test-${process.pid}.html`)
  fs.writeFileSync(file, graphHtml(raw, { title: 'shop (runtime)' }))
  const url = pathToFileURL(file).href
  const requests = []
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, colorScheme: 'light' })
    const page = await ctx.newPage()
    page.on('console', m => { if (m.type() === 'error') errors.push(`[runtime page console.error] ${m.text()}`) })
    page.on('pageerror', e => errors.push(`[runtime page uncaught] ${e.stack || e.message}`))
    page.on('request', r => { if (r.url() !== url) requests.push(r.url()) })
    await ctx.route('**/*', route => route.request().url() === url ? route.continue() : route.abort())
    const nodeOf = (name) => page.locator('#nodes .node', { has: page.locator('text.name', { hasText: new RegExp(`^${name}( ×\\d+)?$`) }) })
    try {
      await page.goto(url)
      await page.waitForFunction(() => window.__sygnalGraph, undefined, { timeout: 10000 })

      await check('runtime: one card per (parent, name) ×N, two apps as clusters, hidden page faded', async () => {
        eq(await page.locator('#nodes .node').count(), 7, 'cards (8 instances)')
        eq(await page.locator('#nodes .node.rt').count(), 7, 'runtime cards')
        eq(await nodeOf('Line').locator('text.name').textContent(), 'Line ×2', 'the ×N label')
        eq(await nodeOf('Line').locator('text.sub').textContent(), '2 instances', 'the second line')
        eq(await nodeOf('App').locator('text.sub').textContent(), 'instance #0', 'one instance')
        eq((await page.locator('#clusters .cluster text').allTextContents()).sort(), ['app 1 · App', 'app 2 · Widget'], 'clusters')
        ok(await nodeOf('Shop').evaluate(n => n.classList.contains('hidden-page') && getComputedStyle(n).opacity === '0.5'), 'Shop faded')
        eq(await page.locator('#edges .edge.context').count(), 2, 'context edges (App → Badge, App → Line)')
        eq(await page.locator('#stats .stat').filter({ hasText: 'instances' }).locator('b').textContent(), '8', 'instances stat')
      })

      await check('runtime: "not seen yet" health groups instead of the static false alarms; a diagnostic with its time', async () => {
        const groups = await page.locator('#health summary').allTextContents()
        ok(groups.some(g => g.startsWith('Actions not seen yet')), `"Actions not seen yet" in ${groups}`)
        ok(!groups.some(g => /nothing triggers|not in the view|nobody emits|nobody selects/.test(g)), `no static checks in ${groups}`)
        const d = new Date(reported), p = (n) => String(n).padStart(2, '0')
        const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
        const sub = await page.locator('#health details', { hasText: 'SYG105' }).locator('.health-item small').textContent()
        eq(sub, `${time} · EVENTS type NAVIGATE is selected but never emitted`, 'diagnostic time')
      })

      await check('runtime: the detail panel lists the instances; state comes from the host on demand', async () => {
        await page.evaluate(() => {
          window.__asked = []
          window.__sygnalGraph.host = { getState(id) { window.__asked.push(id); return new Promise(r => setTimeout(() => r({ id: Number(id), title: 'row ' + id }), 20)) } }
        })
        await page.locator('#tree .tree-item', { hasText: 'Line ×2' }).click()
        eq((await page.locator('#dtitle').textContent()).replace(/\s+/g, ' ').trim().split(' ').slice(0, 2), ['Line', '×2'], 'detail title')
        eq(await page.locator('#dinner .rt-inst').count(), 2, 'instance rows')
        eq(await page.evaluate(() => window.__asked), [], 'nothing fetched while the rows are closed')
        await page.locator('#dinner .rt-inst summary').first().click()
        await page.waitForFunction(() => document.querySelector('#dinner .rt-inst .rt-state')?.textContent.includes('row 6'))
        eq(await page.evaluate(() => window.__asked), ['6'], 'fetched the opened instance')
        // a pushed change shows in place
        await page.evaluate(() => window.__sygnalGraph.state('6', { id: 6, title: 'pushed' }))
        ok((await page.locator('#dinner .rt-inst .rt-state').first().textContent()).includes('"pushed"'), 'pushed state shown')
      })

      await check('runtime: action(record) flashes the instance\'s card, also across setGraph', async () => {
        eq(await page.evaluate(() => window.__sygnalGraph.action({ instance: '7', type: 'REMOVE' })), true, 'action → a card')
        ok(await nodeOf('Line').evaluate(n => n.classList.contains('flash')), 'Line card flashing')
        eq(await page.evaluate(() => window.__sygnalGraph.action({ instance: '999', type: 'X' })), false, 'unknown instance')
        await page.evaluate((g) => window.__sygnalGraph.setGraph(g), raw)
        ok(await nodeOf('Line').evaluate(n => n.classList.contains('flash')), 'still flashing after the redraw')
        await page.waitForFunction(() => !document.querySelector('#nodes .node.flash'), undefined, { timeout: 3000 })
      })

      await check('runtime: setGraph keeps the selected card by key and the fetched state', async () => {
        const g2 = JSON.parse(JSON.stringify(raw))
        const extra = JSON.parse(JSON.stringify(g2.components.find(c => c.name === 'Line')))
        extra.id = '9'
        g2.components.push(extra)
        await page.evaluate((g) => window.__sygnalGraph.setGraph(g), g2)
        eq(await nodeOf('Line').locator('text.name').textContent(), 'Line ×3', 'the new count')
        eq(await page.evaluate(() => window.__sygnalGraph.selectedKey), 'rt:App>Cart>Line', 'selection kept')
        eq(await page.locator('#dinner .rt-inst').count(), 3, 'instance rows')
        await page.evaluate((g) => window.__sygnalGraph.setGraph(g), raw)
      })
    } catch (e) {
      results.push({ name: 'runtime page', pass: false, detail: e.message.split('\n')[0] })
    } finally {
      await ctx.close()
      fs.rmSync(file, { force: true })
    }
  }

  // ───────────── 2. the devtools panel's App graph with a running app ─────────────
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-devtools-test-'))
  const ORIGIN = 'http://sygnal-devtools.test'
  const app = new URL('p10-devtools-app.html', appUrl).href
  const foreign = []
  if (!appUrl) results.push({ name: 'devtools App graph', pass: false, detail: 'no app server url' })
  else {
    execFileSync(process.execPath, [path.join(repo, 'devtools/build.mjs'), out], { stdio: 'pipe' })
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } })
    await ctx.route(`${ORIGIN}/**`, async route => {
      const name = new URL(route.request().url()).pathname.slice(1)
      const fp = path.join(out, name)
      if (!name || name.includes('..') || !fs.existsSync(fp)) return route.fulfill({ status: 404, body: '' })
      const type = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png' }[name.split('.').pop()] || 'application/octet-stream'
      await route.fulfill({ status: 200, body: fs.readFileSync(fp), headers: { 'content-type': type } })
    })
    const appPage = await ctx.newPage()
    const panelPage = await ctx.newPage()
    for (const [p, label] of [[appPage, 'app'], [panelPage, 'panel']]) {
      p.on('console', m => { if (m.type() === 'error') errors.push(`[${label} console.error] ${m.text()}`) })
      p.on('pageerror', e => errors.push(`[${label} uncaught] ${e.stack || e.message}`))
      p.on('request', r => { const u = r.url(); if (!u.startsWith(ORIGIN) && !u.startsWith(new URL(appUrl).origin)) foreign.push(u) })
    }
    // background.js + content-script.js, in two bindings
    await panelPage.exposeBinding('__toApp', async (_, m) => {
      const msg = m.type === 'INIT' ? { type: 'CONNECT', payload: {} } : m
      await appPage.evaluate((x) => window.postMessage({ source: '__SYGNAL_DEVTOOLS_EXTENSION__', ...x }, '*'), msg)
    })
    await appPage.exposeBinding('__toPanel', async (_, d) => { await panelPage.evaluate((x) => window.__deliver && window.__deliver(x), d).catch(() => {}) })
    await appPage.addInitScript(() => {
      window.addEventListener('message', (e) => { if (e.source === window && e.data && e.data.source === '__SYGNAL_DEVTOOLS_PAGE__') window.__toPanel(e.data) })
    })
    await panelPage.addInitScript(() => {
      window.chrome = {
        runtime: { connect: () => ({ postMessage: (m) => window.__toApp(m), onMessage: { addListener: (fn) => { window.__deliver = fn } }, onDisconnect: { addListener() {} } }) },
        devtools: { inspectedWindow: { tabId: 1 } },
      }
    })
    const frame = panelPage.frameLocator('#app-graph-frame')
    const card = (name) => frame.locator('#nodes .node', { has: frame.locator('text.name', { hasText: new RegExp(`^${name}( ×\\d+)?$`) }) })
    try {
      await appPage.goto(app)
      await appPage.waitForFunction(() => window.__p10Ready && window.__SYGNAL_DEVTOOLS__ && typeof window.__SYGNAL_DEVTOOLS__.inspect === 'function', undefined, { timeout: 10000 })
      await panelPage.goto(`${ORIGIN}/panel.html`)

      await check('devtools: the App graph view shows the running app (inspect() over the bridge)', async () => {
        await panelPage.locator('#app-graph-btn').click()
        ok(await panelPage.locator('.main').isHidden(), 'the component view is hidden')
        await frame.locator('#nodes .node').first().waitFor({ timeout: 10000 })
        const names = (await frame.locator('#nodes .node text.name').allTextContents()).sort()
        eq(names, ['App', 'Cart', 'Counter', 'Header', 'Line ×2', 'Shop'], 'cards')
        eq((await frame.locator('#clusters .cluster text').allTextContents()).sort(), ['app 1 · App', 'app 2 · Counter'], 'clusters')
        ok(await card('Shop').evaluate(n => n.classList.contains('hidden-page')), 'the hidden page')
        eq(await frame.locator('#edges .edge.context').count(), 1, 'context edge App → Line (D530)')
        const sub = await frame.locator('#health details', { hasText: 'SYG101' }).locator('.health-item small').first().textContent()
        ok(/^\d\d:\d\d:\d\d · /.test(sub), `SYG101 with its time: ${sub}`)
      })

      await check('devtools: an action flashes its card; the graph refreshes after it', async () => {
        await panelPage.evaluate(() => { const f = document.getElementById('app-graph-frame').contentWindow; f.__flashes = []; new f.MutationObserver(ms => { for (const m of ms) if (m.target.classList.contains('flash')) f.__flashes.push(m.target.querySelector('text.name').textContent) }).observe(f.document.getElementById('nodes'), { subtree: true, attributes: true, attributeFilter: ['class'] }) })
        await appPage.locator('.add').click()
        await panelPage.waitForFunction(() => document.getElementById('app-graph-frame').contentWindow.__flashes.includes('App'), undefined, { timeout: 5000 })
        await card('Line').locator('text.name', { hasText: 'Line ×3' }).waitFor({ timeout: 5000 })
      })

      await check('devtools: the selected card\'s state is fetched on demand and follows changes', async () => {
        await frame.locator('#tree .tree-item', { hasText: 'Counter' }).click()
        const pre = frame.locator('#dinner .rt-inst .rt-state')
        await frame.locator('#dinner .rt-inst .rt-state', { hasText: '"n": 0' }).waitFor({ timeout: 5000 })
        await appPage.locator('.inc').click()
        await appPage.locator('.inc').click()
        await frame.locator('#dinner .rt-inst .rt-state', { hasText: '"n": 2' }).waitFor({ timeout: 5000 })
        ok((await pre.textContent()).includes('"n": 2'), 'state updated')
        eq(await frame.locator('#dtitle').evaluate(e => e.firstChild.textContent.trim()), 'Counter', 'selection kept across refreshes')
      })

      await check('devtools: closing the view shows the component tree again', async () => {
        await panelPage.locator('#app-graph-btn').click()
        ok(await panelPage.locator('.main').isVisible(), 'component view')
        ok(await panelPage.locator('#app-graph').isHidden(), 'graph hidden')
      })
    } catch (e) {
      results.push({ name: 'devtools App graph', pass: false, detail: e.message.split('\n')[0] })
    } finally {
      await ctx.close()
      fs.rmSync(out, { recursive: true, force: true })
    }
  }

  const failed = results.filter(r => !r.pass)
  const lines = [`Runtime graph page + devtools App graph (${engine} ${browser.version()}): ${results.length - failed.length}/${results.length} passed`]
  for (const f of failed) lines.push(`  FAIL: ${f.name} — ${f.detail}`)
  for (const e of errors) lines.push(`  FAIL: ${e}`)
  if (requests.length) lines.push(`  FAIL: the runtime page made ${requests.length} network request(s): ${requests.slice(0, 5).join(', ')}`)
  if (foreign.length) lines.push(`  FAIL: ${foreign.length} request(s) outside the app and the extension: ${foreign.slice(0, 5).join(', ')}`)
  console.log(lines.join('\n') + `\nRuntime graph page: ${Date.now() - t0} ms\n`)
  return failed.length + errors.length + requests.length + foreign.length
}
