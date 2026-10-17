/**
 * PLAN-10 V-4 (D536): the `sygnal-check --graph=html` page on large apps, in a real browser.
 * run-headless.mjs calls it with the other graph page suites (BROWSER_TESTS_ONLY=graphview).
 *
 * Synthetic graphs from S-1's seeded generator (sygnal-check/test/fixtures/graph-synth.js): 120
 * components (the medium tier) and 500 / 2,000 (the large tier). Checks: first paint (T-4: under
 * 1 s on Chromium, a warning only), the folded default above 150, opening and folding a group
 * (the outline follows), the search results list, focus mode and "Show all", semantic zoom hiding
 * card text, the EVENTS table, the filter menu, the canvas renderer once everything is opened,
 * the medium tier's open groups, bus nodes and minimap. Fails on any console error, any uncaught
 * error and any network request.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')

export async function runGraphLarge(browser, engine) {
  const t0 = Date.now()
  const { graphHtml } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/graphView/html.js')))
  const { synthGraph } = await import(pathToFileURL(path.join(repo, 'sygnal-check/test/fixtures/graph-synth.js')))
  const results = [], errors = [], requests = [], notes = []
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }) } catch (e) { results.push({ name, pass: false, detail: e.message.split('\n').slice(0, 6).join(' | ') }) }
  }
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
  const ok = (v, what) => { if (!v) throw new Error(what) }

  async function open(n) {
    const g = synthGraph(n, 1)
    const html = graphHtml(g, { title: `syn-${n}`, subtitle: 'synthetic' })
    const file = path.join(os.tmpdir(), `sygnal-graph-large-${n}-${process.pid}.html`)
    fs.writeFileSync(file, html)
    const url = pathToFileURL(file).href
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
    const page = await ctx.newPage()
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${n}] [console.error] ${m.text()}`) })
    page.on('pageerror', e => errors.push(`[${n}] [uncaught] ${e.stack || e.message}`))
    page.on('request', r => { if (r.url() !== url) requests.push(r.url()) })
    await ctx.route('**/*', route => route.request().url() === url ? route.continue() : route.abort())
    await page.goto(url)
    await page.waitForFunction(() => window.__sygnalGraph, undefined, { timeout: 20000 })
    // first paint: navigation start to the second animation frame after the page mounted
    const paint = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now())))))
    const gz = zlib.gzipSync(html).length
    notes.push(`syn-${n}: page ${Math.round(html.length / 1024)} KB (${Math.round(gz / 1024)} KB gzip), first paint ${Math.round(paint)} ms`)
    if (engine === 'chromium' && paint > 1000) notes.push(`  WARN (T-4): syn-${n} first paint ${Math.round(paint)} ms > 1 s`)
    const close = async () => { await ctx.close(); fs.rmSync(file, { force: true }) }
    return { page, g, close }
  }
  const api = (page, expr) => page.evaluate(expr)
  const selectedName = (page) => page.evaluate(() => document.querySelector('#detail.open #dtitle')?.firstChild?.textContent.trim() ?? null)

  try {
    // ── 2,000: the large tier ──
    {
      const { page, close } = await open(2000)
      try {
        await check('2,000: large tier, directory groups folded, SVG, ≤ 100 cards drawn', async () => {
          const s = await api(page, () => { const a = window.__sygnalGraph; return { tier: a.tier.name, r: a.renderer, groups: a.projection.nodes.filter(n => n.type === 'group').length, nodes: a.projection.nodes.length } })
          eq(s.tier, 'large', 'tier'); eq(s.r, 'svg', 'renderer')
          ok(s.groups > 20 && s.nodes < 100, `folded overview (${s.groups} groups, ${s.nodes} nodes)`)
          eq(await page.locator('#nodes .node.group').count(), s.groups, 'group cards drawn')
          ok((await page.locator('#tierinfo').textContent()).includes('folded'), 'the toolbar says what is folded')
          ok(await page.locator('#minimap').isVisible(), 'minimap shown')
          eq(await page.locator('#tree .tree-toggle[data-group="src/features/shop"]').getAttribute('aria-expanded'), 'false', 'outline: the shop group folded')
        })

        await check('semantic zoom: below 0.4 card text is hidden and group names stay; zoomed in it is back', async () => {
          await api(page, () => window.__sygnalGraph.fit(undefined, false, 0.3))
          ok(await page.evaluate(() => document.getElementById('svg').classList.contains('far')), 'far at k ≤ 0.3')
          eq(await page.locator('#nodes .node.group .sub').first().evaluate(e => getComputedStyle(e).display), 'none', 'card text hidden')
          ok(await page.locator('#nodes .node.group .name').first().evaluate(e => getComputedStyle(e).display !== 'none'), 'group name shown')
          // far away a group's name is centred in its card and never grows out of it (user report)
          const out = await page.evaluate(() => [...document.querySelectorAll('#nodes .node.group')].filter(g => {
            const c = g.querySelector('.box').getBoundingClientRect(), t = g.querySelector('.name').getBoundingClientRect()
            return t.top < c.top - 1 || t.bottom > c.bottom + 1 || t.left < c.left - 1 || t.right > c.right + 1
          }).map(g => g.dataset.key))
          eq(out, [], 'group names outside their card')
          await page.locator('#zfit').click()
          await api(page, () => { const a = window.__sygnalGraph; a.fit([a.projection.nodes[0].id], false, 1) })
          ok(!await page.evaluate(() => document.getElementById('svg').classList.contains('far')), 'not far at k 1')
          ok(await page.locator('#nodes .node.group .sub').first().evaluate(e => getComputedStyle(e).display !== 'none'), 'card text back')
        })

        await check('opening a group by click draws its components; the outline follows; folding it from the outline', async () => {
          await page.locator('#zfit').click()
          await page.locator('#nodes .node.group[data-key="src/features/shop"]').click()
          const shop = await api(page, () => { const a = window.__sygnalGraph; return a.model.comps.filter(c => a.groupOf(c.id) === 'src/features/shop').map(c => c.id) })
          ok(shop.length > 20, 'the shop group is big')
          for (const id of shop.slice(0, 5)) eq(await page.locator(`#nodes .node[data-id="${id}"]`).count(), 1, `card ${id}`)
          eq(await page.locator('#nodes .node.group[data-key="src/features/shop"]').count(), 0, 'no shop card')
          eq(await page.locator('#tree .tree-toggle[data-group="src/features/shop"]').getAttribute('aria-expanded'), 'true', 'outline open')
          ok(await page.locator('#clusters .cluster[data-key="src/features/shop"]').count() === 1, 'a box around it')
          await page.locator('#tree .tree-toggle[data-group="src/features/shop"]').click()
          eq(await page.locator('#nodes .node.group[data-key="src/features/shop"]').count(), 1, 'folded again from the outline')
          // Enter on a focused group card opens it too
          await page.locator('#nodes .node.group[data-key="src/layout"]').focus()
          await page.keyboard.press('Enter')
          eq(await page.locator('#nodes .node.group[data-key="src/layout"]').count(), 0, 'opened by Enter')
        })

        await check('search lists results (with why), picking one focuses it; breadcrumbs; Show all', async () => {
          await page.locator('body').press('/')
          await page.keyboard.type('checkout')
          ok(await page.locator('#results').isVisible(), 'results list open')
          ok(await page.locator('#results .r').count() >= 1, 'results')
          eq((await page.locator('#results .r .nm').first().textContent()), 'Checkout', 'best match first')
          await page.keyboard.press('ArrowDown')
          await page.keyboard.press('Enter')
          eq(await selectedName(page), 'Checkout', 'selected')
          ok(await page.locator('#crumbs.on').isVisible(), 'breadcrumbs')
          ok((await page.locator('#crumbs').textContent()).includes('StoreShell'), 'breadcrumbs through StoreShell')
          const n = await page.locator('#nodes .node').count()
          ok(n > 3 && n < 40, `focus view (${n} cards)`)
          ok((await page.locator('#dinner').textContent()).includes('currency'), 'context in the details')
          await page.locator('#crumbs-x').click()
          eq(await page.locator('#crumbs.on').count(), 0, 'focus left')
          eq(await selectedName(page), 'Checkout', 'still selected')
          ok(await page.locator('#nodes .node.sel').count() === 1, 'drawn in the whole graph, selected')
          await page.locator('#q').press('Escape') // clears and leaves the search
          await page.keyboard.press('Escape')
          eq(await selectedName(page), null, 'Esc cleared the selection')
        })

        await check('EVENTS table: filter, emitters and selectors, a click selects in the graph', async () => {
          await page.locator('#v-events').click()
          ok(await page.locator('#events-view').isVisible(), 'table shown')
          await page.locator('#ev-q').fill('NAVIGATE')
          ok((await page.locator('#evtable tbody tr').count()) >= 1, 'rows')
          const row = page.locator('#evtable tbody tr', { has: page.locator('[data-ev="NAVIGATE"]') })
          ok((await row.locator('td').nth(2).textContent()).includes('PageTracker'), 'selected by PageTracker')
          await row.locator('td').nth(2).getByRole('button', { name: /^PageTracker/ }).click()
          ok(await page.locator('#events-view').isHidden(), 'back to the graph')
          eq(await selectedName(page), 'PageTracker', 'selected from the table')
          await page.keyboard.press('Escape')
        })

        await check('filter menu: only problems; the count; clear', async () => {
          await page.locator('#filter-btn').click()
          ok(await page.locator('#filters.open').isVisible(), 'menu open')
          await page.locator('#filters input[data-f="problems"]').check()
          eq(await page.locator('#filter-n').textContent(), '1', 'filter count')
          ok((await page.locator('#tierinfo').textContent()).match(/\d+ of 2000 shown/), 'shown count')
          await page.locator('#f-clear').click()
          eq(await page.locator('#filter-n').textContent(), '', 'cleared')
          await page.keyboard.press('Escape')
        })

        await check('canvas: opening every group (> 400 nodes) switches to the canvas; a click on it selects', async () => {
          await page.locator('#filter-btn').click()
          await page.locator('#g-open').click()
          eq(await api(page, () => window.__sygnalGraph.renderer), 'canvas', 'renderer')
          ok(await page.locator('#cv').isVisible(), 'canvas visible')
          eq(await page.locator('#nodes .node').count(), 0, 'no SVG cards')
          // click the centre of a card: find one on screen through the API
          const pt = await api(page, () => {
            const a = window.__sygnalGraph, c = a.model.comps.find(x => x.name === 'Checkout')
            a.fit([c.id], false, 1)
            const p = a.layout.pos.get(c.id), v = a.view
            return { x: v.x + (p.x + p.w / 2) * v.k, y: v.y + (p.y + p.h / 2) * v.k }
          })
          await page.waitForTimeout(50)
          const box = await page.locator('#svg').boundingBox()
          await page.mouse.click(box.x + pt.x, box.y + pt.y)
          eq(await selectedName(page), 'Checkout', 'selected by a canvas click')
          eq(await api(page, () => window.__sygnalGraph.renderer), 'svg', 'focus view is SVG again')
          await page.keyboard.press('Escape')
          eq(await api(page, () => window.__sygnalGraph.renderer), 'canvas', 'back to everything: canvas')
          await page.locator('#filter-btn').click()
          await page.locator('#g-fold').click()
          eq(await api(page, () => window.__sygnalGraph.renderer), 'svg', 'folded again: SVG')
        })

        await check('setGraph keeps open groups and the focus by key', async () => {
          await api(page, () => window.__sygnalGraph.openGroup('src/features/shop'))
          const before = await api(page, () => window.__sygnalGraph.projection.nodes.length)
          await api(page, () => { const a = window.__sygnalGraph; a.setGraph(JSON.parse(document.getElementById('graph-data').textContent)) })
          eq(await api(page, () => window.__sygnalGraph.projection.nodes.length), before, 'same drawing after an update')
          await api(page, () => { const a = window.__sygnalGraph; a.select(a.model.comps.find(c => c.name === 'Cart').id) })
          const key = await api(page, () => window.__sygnalGraph.focusKey)
          ok(key && key.endsWith('#Cart'), 'focus on Cart')
          await api(page, () => { const a = window.__sygnalGraph; a.setGraph(JSON.parse(document.getElementById('graph-data').textContent)) })
          eq(await api(page, () => window.__sygnalGraph.focusKey), key, 'focus kept')
          eq(await selectedName(page), 'Cart', 'selection kept')
        })
      } finally { await close() }
    }

    // ── 500: the large tier, a trace opens the groups of its ends ──
    {
      const { page, close } = await open(500)
      try {
        await check('500: folded by default; tracing an event opens the groups of its ends', async () => {
          eq(await api(page, () => window.__sygnalGraph.tier.name), 'large', 'tier')
          await api(page, () => window.__sygnalGraph.trace('event', 'CART_CHANGED'))
          const shown = await api(page, () => { const a = window.__sygnalGraph; return ['Cart', 'MiniCart', 'StoreShell'].map(n => a.model.comps.filter(c => c.name === n).every(c => a.projection.rep.get(c.id) === c.id)) })
          eq(shown, [true, true, true], 'ends drawn as cards')
          ok((await page.locator('#edges .edge.event.hl').count()) > 0, 'highlighted')
        })
      } finally { await close() }
    }

    // ── 120: the medium tier ──
    {
      const { page, close } = await open(120)
      try {
        await check('120: open directory groups in boxes, bus nodes where they cut edges, minimap, focus on select', async () => {
          eq(await api(page, () => window.__sygnalGraph.tier.name), 'medium', 'tier')
          eq(await page.locator('#nodes .node.group').count(), 0, 'nothing folded')
          ok(await page.locator('#clusters .cluster').count() > 2, 'group boxes')
          ok(await page.locator('#nodes .node.bus').count() >= 1, 'a bus node (NAVIGATE)')
          ok(await page.locator('#minimap').isVisible(), 'minimap')
          await page.locator('#tree').getByRole('button', { name: /^Checkout, / }).click()
          ok(await page.locator('#crumbs.on').isVisible(), 'focus mode')
        })
      } finally { await close() }
    }
  } catch (e) {
    results.push({ name: 'large pages', pass: false, detail: e.message.split('\n')[0] })
  }

  const failed = results.filter(r => !r.pass)
  const lines = [`Graph view large apps (${engine} ${browser.version()}): ${results.length - failed.length}/${results.length} passed`]
  for (const n of notes) lines.push('  ' + n)
  for (const f of failed) lines.push(`  FAIL: ${f.name} — ${f.detail}`)
  for (const e of errors) lines.push(`  FAIL: ${e}`)
  if (requests.length) lines.push(`  FAIL: ${requests.length} network request(s): ${requests.slice(0, 5).join(', ')}`)
  console.log(lines.join('\n') + `\nGraph view large apps: ${Date.now() - t0} ms\n`)
  return failed.length + errors.length + requests.length
}
