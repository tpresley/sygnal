/**
 * PLAN-10 T-2: the `sygnal-check --graph=html` page in a real browser. run-headless.mjs calls it after
 * the main suite (BROWSER_TESTS_ONLY=graphview runs only this; BROWSER_TESTS_GRAPHVIEW=0 skips it).
 *
 * Builds the page for the graph-viz spike's shop fixture with sygnal-check (needs
 * `npm ci --prefix sygnal-check`), writes it to the OS temp dir and opens it from file:// in a fresh
 * context. Checks: the cards and the component list render, selecting (click, the list, search,
 * the keyboard), tracing an EVENTS type, the overlay toggles, the theme, 900 px wide, reduced motion.
 * Fails on any console error, any uncaught error, and **any network request** (the page must be
 * self-contained: PLAN-10 invariant, gate "the page works offline").
 * Then the runtime page (V-3) and the devtools panel's App graph view (P-1): graph-view-runtime.mjs.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
// T-3 moves the shop fixture into sygnal-check's tests; until then it is the spike's
const FIXTURES = ['sygnal-check/test/fixtures/graph-shop', 'dev-plans/research/graph-viz/fixture/src']

export async function runGraphView(browser, engine, appUrl) {
  const t0 = Date.now()
  const { graph } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/graph.js')))
  const { graphHtml } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/graphView/html.js')))
  const { buildModel } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/graphView/model.js')))
  const fixture = FIXTURES.find(f => fs.existsSync(path.join(repo, f)))
  const g = graph([fixture], { cwd: repo })
  const model = buildModel(g)
  const file = path.join(os.tmpdir(), `sygnal-graph-browser-test-${process.pid}.html`)
  fs.writeFileSync(file, graphHtml(g, { title: 'shop', subtitle: fixture, root: repo }))
  const url = pathToFileURL(file).href

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errors = [], requests = []
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`) })
  page.on('pageerror', e => errors.push(`[uncaught] ${e.stack || e.message}`))
  page.on('request', r => { if (r.url() !== url) requests.push(r.url()) })
  // anything but the page itself is refused, so a request can't slip through as a cache hit
  await ctx.route('**/*', route => route.request().url() === url ? route.continue() : route.abort())

  const results = []
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }) } catch (e) { results.push({ name, pass: false, detail: e.message.split('\n').slice(0, 8).join(' | ') }) }
  }
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
  const ok = (v, what) => { if (!v) throw new Error(what) }
  const id = (name) => model.comps.find(c => c.name === name).id
  const selectedName = () => page.evaluate(() => document.querySelector('#detail.open #dtitle')?.firstChild?.textContent.trim() ?? null)

  try {
    await page.goto(url)
    await page.waitForFunction(() => window.__sygnalGraph, undefined, { timeout: 10000 })

    await check('renders a card per component and the component list', async () => {
      eq(await page.locator('#nodes .node').count(), model.comps.length, 'cards')
      eq(await page.locator('#tree .tree-item').count(), model.comps.length, 'list buttons')
      eq(await page.locator('#nodes .node.ghost').count(), model.ghosts.length, 'ghost cards')
      ok(await page.locator('#edges .edge').count() >= model.renderEdges.length, 'edges drawn')
      eq(await page.title(), 'shop · Sygnal app graph', 'title')
      ok((await page.locator('#health .health-item').count()) > 0, 'health items')
    })

    await check('the graph data: view-only cards, package / widget ghosts, PARENT edges, entries first', async () => {
      const n = (pred) => model.comps.filter(pred).length
      eq(await page.locator('#nodes .node.view-only').count(), n(c => c.viewOnly), 'view-only cards')
      eq(await page.locator('#nodes .node.ghost.external').count(), n(c => c.external), 'package ghosts')
      eq(await page.locator('#nodes .node.ghost.widget').count(), n(c => c.ghost && c.widget), 'widget ghosts')
      eq(await page.locator('#edges .edge.parent').count(), model.parentEdges.length, 'PARENT edges')
      ok(model.parentEdges.length > 0 && n(c => c.viewOnly) > 0 && n(c => c.external) > 0, 'the fixture has each kind')
      const entry = model.comps.find(c => c.entry === true)
      if (entry) eq(await page.locator('#nodes .node[tabindex="0"]').getAttribute('data-id'), entry.id, 'the entry is the first tab stop')
      // health: "rendered but not scanned" lists only names that really don't resolve
      const notScanned = model.ghosts.filter(gh => !gh.external && !gh.widget).map(gh => gh.name)
      const shown = await page.locator('#health details', { hasText: 'Rendered but not scanned' }).locator('.health-item .t').allTextContents()
      eq(shown.length, notScanned.length, 'not-scanned health items')
    })

    await check('click a card selects it and opens the details', async () => {
      await page.locator(`#nodes .node[data-id="${id('App')}"]`).click()
      eq(await selectedName(), 'App', 'detail title')
      eq(await page.locator('#nodes .node.sel').count(), 1, 'selected cards')
      eq(await page.locator(`#tree .tree-item[data-id="${id('App')}"]`).getAttribute('aria-current'), 'true', 'list aria-current')
    })

    await check('trace an EVENTS type from the details', async () => {
      await page.locator('#dinner [data-trace-event="NAVIGATE"]').first().click()
      ok(await page.locator('#trace.on').isVisible(), 'trace bar visible')
      ok((await page.locator('#trace').textContent()).includes('NAVIGATE'), 'trace names the type')
      const want = model.eventEdges.filter(e => e.type === 'NAVIGATE').length
      ok(want > 0, 'fixture has NAVIGATE edges')
      eq(await page.locator('#edges .edge.event.hl').count(), want, 'highlighted NAVIGATE edges')
      await page.locator('#trace-x').click()
      eq(await page.locator('#trace.on').count(), 0, 'trace cleared')
    })

    await check('overlay toggles hide and show EVENTS and context edges', async () => {
      const shown = (cls) => page.locator(`#edges .edge.${cls}`).first().evaluate(e => getComputedStyle(e).display !== 'none')
      ok(await shown('event') && await shown('context'), 'both overlays start shown')
      await page.locator('#t-events').click()
      eq(await page.locator('#t-events').getAttribute('aria-pressed'), 'false', 'events pressed')
      ok(!await shown('event') && await shown('context'), 'events hidden, context shown')
      await page.locator('#t-context').click()
      ok(!await shown('context'), 'context hidden')
      await page.locator('#t-events').click()
      await page.locator('#t-context').click()
      ok(await shown('event') && await shown('context'), 'both shown again')
    })

    await check('search: / focuses it, matches count, Enter selects the one match, Esc clears', async () => {
      await page.keyboard.press('Escape')
      eq(await selectedName(), null, 'Esc cleared the selection')
      await page.locator('body').press('/')
      eq(await page.evaluate(() => document.activeElement.id), 'q', 'focus after /')
      await page.keyboard.type('cartline')
      eq(await page.locator('#qcount').textContent(), '1', 'match count')
      eq(await page.locator('#nodes .node.match').count(), 1, 'matched cards')
      await page.keyboard.press('Enter')
      eq(await selectedName(), 'CartLine', 'selected by search')
      await page.locator('#q').press('Escape')
      eq(await page.locator('#q').inputValue(), '', 'search cleared')
    })

    await check('keyboard: the canvas is one tab stop; arrows follow edges; Enter selects', async () => {
      await page.keyboard.press('Escape')
      eq(await page.locator('#nodes .node[tabindex="0"]').count(), 1, 'one tab stop')
      await page.locator(`#nodes .node[data-id="${id('App')}"]`).focus()
      await page.keyboard.press('ArrowDown')
      const child = await page.evaluate(() => document.activeElement.dataset.id)
      ok(model.childrenOf.get(id('App')).includes(child), `ArrowDown went to a child (${child})`)
      await page.keyboard.press('ArrowUp')
      eq(await page.evaluate(() => document.activeElement.dataset.id), id('App'), 'ArrowUp back to the parent')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowRight')
      let sib = await page.evaluate(() => document.activeElement.dataset.id)
      if (sib === child) { await page.keyboard.press('ArrowLeft'); sib = await page.evaluate(() => document.activeElement.dataset.id) } // the last in its row
      ok(sib && sib !== child && model.childrenOf.get(id('App')).includes(sib), `ArrowRight went to a sibling (${sib})`)
      await page.keyboard.press('Enter')
      eq(await selectedName(), model.byId.get(sib).name, 'Enter selected it')
      eq(await page.locator('#nodes .node[tabindex="0"]').count(), 1, 'still one tab stop')
    })

    await check('the component list selects (the screen-reader view)', async () => {
      await page.locator('#tree').getByRole('button', { name: /^Checkout, / }).click()
      eq(await selectedName(), 'Checkout', 'selected from the list')
    })

    await check('theme toggle and stored overlay state', async () => {
      await page.locator('#menu-btn').click()
      ok(await page.locator('#menu.open').isVisible(), 'menu open')
      await page.locator('#m-theme').click()
      eq(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'dark theme')
      eq(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(13, 17, 23)', 'dark background')
      await page.locator('#menu-btn').click()
      await page.locator('#m-theme').click()
      eq(await page.evaluate(() => document.documentElement.dataset.theme), 'light', 'light again')
      await page.keyboard.press('Escape')
    })

    // lines added above every component: every 'file.jsx:N' id (components, children, events,
    // childSelects, diagnostics) moves; the keys stay
    const shiftIds = (gr) => JSON.parse(JSON.stringify(gr).replace(/(\.[jt]sx?):(\d+)"/g, (_, ext, n) => `${ext}:${Number(n) + 3}"`))
    // the view settles: the select's pan (after 200 ms) and any animation are done
    const settle = async () => { await page.waitForTimeout(250); await page.waitForFunction(() => !window.__sygnalGraph.animating) }

    await check('setGraph replaces the graph in place, keeping a moved view, the selection and the trace by key', async () => {
      try {
        // from the list: the card may be off screen after the earlier steps' pans
        await settle()
        await page.locator(`#tree .tree-item[data-id="${id('App')}"]`).click()
        await page.locator('#dinner [data-trace-event="NAVIGATE"]').first().click()
        await settle()
        const view = await page.locator('#vp').getAttribute('transform')
        const shifted = shiftIds(g)
        shifted.components.find(c => c.name === 'Header').actions.push({ name: 'NEW_ONE', trigger: 'intent', sinks: ['STATE'] })
        await page.evaluate((gr) => window.__sygnalGraph.setGraph(gr), shifted)
        await settle()
        const newApp = shifted.components.find(c => c.name === 'App').id
        ok(newApp !== id('App'), 'the ids moved')
        eq(await page.locator('#nodes .node.sel').getAttribute('data-id'), newApp, 'selection follows the key')
        eq(await selectedName(), 'App', 'details still open')
        ok(await page.locator('#trace.on').isVisible(), 'trace kept')
        eq(await page.locator('#edges .edge.event.hl').count(), model.eventEdges.filter(e => e.type === 'NAVIGATE').length, 'trace highlight redrawn')
        eq(await page.locator('#vp').getAttribute('transform'), view, 'the moved view is kept exactly')
        eq(await page.locator('#nodes .node').count(), model.comps.length, 'cards')
        eq(await page.locator('#nodes .node[tabindex="0"]').count(), 1, 'one tab stop')
        eq(await page.evaluate(() => window.__sygnalGraph.model.comps.find(c => c.name === 'Header').actions.length), g.components.find(c => c.name === 'Header').actions.length + 1, 'new data')
      } finally {
        if (await page.locator('#trace.on').count()) await page.locator('#trace-x').click()
        await page.keyboard.press('Escape')
        await page.evaluate((gr) => window.__sygnalGraph.setGraph(gr), g)
      }
      eq(await page.locator(`#nodes .node[data-id="${id('App')}"]`).count(), 1, 'back to the original graph')
    })

    await check('setGraph on a view nobody moved fits the new graph', async () => {
      await page.reload()
      await page.waitForFunction(() => window.__sygnalGraph, undefined, { timeout: 10000 })
      const shifted = shiftIds(g)
      shifted.components = shifted.components.filter(c => c.name !== 'ProductCard')
      await page.evaluate((gr) => window.__sygnalGraph.setGraph(gr), shifted)
      const after = await page.locator('#vp').getAttribute('transform')
      await page.evaluate(() => window.__sygnalGraph.fit(undefined, false))
      eq(after, await page.locator('#vp').getAttribute('transform'), 'the view is the new graph\'s fit')
      await page.evaluate((gr) => window.__sygnalGraph.setGraph(gr), g)
    })

    await check('900 px wide: no horizontal overflow, the list and details still work', async () => {
      await page.setViewportSize({ width: 900, height: 700 })
      eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('header').scrollWidth <= document.querySelector('header').clientWidth), true, 'no overflow')
      ok(await page.locator('#tree').isVisible(), 'component list visible')
      await page.locator(`#tree .tree-item[data-id="${id('Cart')}"]`).click()
      eq(await selectedName(), 'Cart', 'selected at 900 px')
      ok(await page.locator('#detail').isVisible(), 'details visible')
      await page.setViewportSize({ width: 1400, height: 860 })
    })

    await check('prefers-reduced-motion: no transitions', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      eq(await page.locator('#detail').evaluate(e => getComputedStyle(e).transitionDuration), '0s', 'detail transition')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    })
  } catch (e) {
    results.push({ name: 'page', pass: false, detail: e.message.split('\n')[0] })
  } finally {
    await ctx.close()
    fs.rmSync(file, { force: true })
  }

  const failed = results.filter(r => !r.pass)
  const lines = [`Graph view page (${engine} ${browser.version()}, ${model.comps.length} components): ${results.length - failed.length}/${results.length} passed`]
  for (const f of failed) lines.push(`  FAIL: ${f.name} — ${f.detail}`)
  for (const e of errors) lines.push(`  FAIL: ${e}`)
  if (requests.length) lines.push(`  FAIL: ${requests.length} network request(s): ${requests.slice(0, 5).join(', ')}`)
  console.log(lines.join('\n') + `\nGraph view page: ${Date.now() - t0} ms\n`)
  const { runRuntimeView } = await import('./graph-view-runtime.mjs')
  return failed.length + errors.length + requests.length + await runRuntimeView(browser, engine, appUrl)
}
