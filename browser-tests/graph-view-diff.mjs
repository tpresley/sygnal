/**
 * PLAN-10 V-6 / C-3: the `sygnal-check --graph=html --base <ref>` page in a real browser.
 * run-headless.mjs calls it with the other graph page suites (BROWSER_TESTS_ONLY=graphview).
 *
 * A temporary git repository (sygnal-check/test/fixtures/git-diff-app.js: Old removed, New added,
 * List.jsx renamed, Header / Item / App changed) through the CLI, and a synthetic large graph
 * (graphHtml with `base`). Checks: the added / removed / changed cards and their corner marks, the
 * removed cards drawn faded in their old place, the marked edges, the sidebar's Changes section (a
 * click selects), the detail panel's Changes section, the "Changes only" filter (absent without a
 * base), counts from the head graph, a folded group's changed-count badge. Fails on any console
 * error, any uncaught error and any network request.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')

export async function runGraphDiff(browser, engine) {
  const t0 = Date.now()
  const { main } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/cli.js')))
  const { graphHtml } = await import(pathToFileURL(path.join(repo, 'sygnal-check/src/graphView/html.js')))
  const { makeDiffRepo } = await import(pathToFileURL(path.join(repo, 'sygnal-check/test/fixtures/git-diff-app.js')))
  const { synthGraph } = await import(pathToFileURL(path.join(repo, 'sygnal-check/test/fixtures/graph-synth.js')))
  const results = [], errors = [], requests = [], cleanup = []
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }) } catch (e) { results.push({ name, pass: false, detail: e.message.split('\n').slice(0, 6).join(' | ') }) }
  }
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
  const ok = (v, what) => { if (!v) throw new Error(what) }

  async function open(file, tag) {
    const url = pathToFileURL(file).href
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, colorScheme: 'light' })
    const page = await ctx.newPage()
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${tag}] [console.error] ${m.text()}`) })
    page.on('pageerror', e => errors.push(`[${tag}] [uncaught] ${e.stack || e.message}`))
    page.on('request', r => { if (r.url() !== url) requests.push(r.url()) })
    await ctx.route('**/*', route => route.request().url() === url ? route.continue() : route.abort())
    await page.goto(url)
    await page.waitForFunction(() => window.__sygnalGraph, undefined, { timeout: 20000 })
    cleanup.push(() => ctx.close())
    return page
  }
  const api = (page, expr, arg) => page.evaluate(expr, arg)

  try {
    // ── the fixture repository through the CLI ──
    const { root } = makeDiffRepo()
    cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
    const file = path.join(root, 'diff.html')
    let err = ''
    const code = main(['--graph=html', '--base', 'HEAD~1', '--out', file], { cwd: root, stdout: { write() {}, isTTY: false }, stderr: { write: (s) => { err += s } }, env: {}, isTTY: false, openFile: () => {} })
    if (code !== 0) throw new Error(`the CLI exited ${code}: ${err}`)
    const page = await open(file, 'fixture')

    await check('cards: 2 added, 2 removed (faded, dashed), 3 changed, each with a corner mark; removed cards sit with their old siblings', async () => {
      eq(await page.locator('#nodes .node.diff-added').count(), 2, 'added cards')
      eq(await page.locator('#nodes .node.diff-removed').count(), 2, 'removed cards')
      eq(await page.locator('#nodes .node.diff-changed').count(), 3, 'changed cards')
      eq(await page.locator('#nodes .node .dmark').count(), 7, 'corner marks')
      const op = await page.locator('#nodes .node.diff-removed').first().evaluate(e => Number(getComputedStyle(e).opacity))
      ok(op < 0.8, `removed cards faded (opacity ${op})`)
      const dash = await page.locator('#nodes .node.diff-removed .box').first().evaluate(e => getComputedStyle(e).strokeDasharray)
      ok(dash && dash !== 'none', 'removed cards dashed')
      // the removed List is drawn in the row of its added replacement (same parent, same layer)
      const ys = await api(page, () => { const a = window.__sygnalGraph; const y = (n, d) => a.layout.pos.get(a.model.comps.find(c => c.name === n && c.diff === d).id).y; return [y('List', 'removed'), y('List', 'added')] })
      eq(ys[0], ys[1], 'the removed List in the same row as the added one')
      ok((await page.locator('#nodes .node.diff-removed').first().getAttribute('aria-label')).includes('removed since HEAD~1'), 'aria-label says removed')
    })

    await check('edges: removed render and EVENTS edges dashed red, added render edges green', async () => {
      ok(await page.locator('#edges .edge.diff-removed').count() >= 3, 'removed edges')
      ok(await page.locator('#edges .edge.event.diff-removed').count() === 1, 'the SAVED edge Item → App is removed')
      ok(await page.locator('#edges .edge.diff-added').count() >= 2, 'added edges')
    })

    await check('sidebar: the Changes section with counts and a list; a click selects (a removed card too)', async () => {
      const sec = page.locator('#diffsec')
      ok(await sec.isVisible(), 'Changes section shown')
      const txt = await sec.textContent()
      ok(/2\s*added/.test(txt) && /2\s*removed/.test(txt) && /3\s*changed/.test(txt), `counts: ${txt}`)
      eq(await sec.locator('.diff-item').count(), 7, 'listed')
      await sec.locator('.diff-item.d-removed', { hasText: 'Old' }).click()
      eq(await page.locator('#detail.open #dtitle').evaluate(e => e.firstChild.textContent.trim()), 'Old', 'selected')
      ok((await page.locator('#detail .diff-sec').textContent()).includes('Removed: in HEAD~1'), 'the detail says removed')
      eq(await page.locator('#stats .stat').first().textContent(), '5components', 'stats count the head graph')
    })

    await check('detail panel: what changed in a component', async () => {
      await page.locator('#diffsec .diff-item.d-changed', { hasText: 'Header' }).click()
      const t = await page.locator('#detail .diff-sec').textContent()
      ok(t.includes('+ CLOSE') && t.includes('+ OPEN') && t.includes('− TOGGLE'), `Header's changes: ${t}`)
      await page.locator('#diffsec .diff-item.d-changed', { hasText: 'Item' }).click()
      const i = await page.locator('#detail .diff-sec').textContent()
      ok(i.includes('+ REMOVED') && i.includes('− SAVED'), `Item's changes: ${i}`)
    })

    await check('"Changes only": in the filter menu with a base; leaves only changed components (and their dimmed ancestors)', async () => {
      await page.keyboard.press('Escape')
      await page.locator('#filter-btn').click()
      ok(await page.locator('#fl-changes').isVisible(), 'offered')
      await page.locator('#fl-changes input').check()
      const s = await api(page, () => { const a = window.__sygnalGraph; return [...a.projection.rep.keys()].map(id => { const c = a.model.byId.get(id); return { d: c.diff ?? null, dim: a.projection.dimmed.has(id) } }) })
      ok(s.length && s.every(x => x.d || x.dim), `only changes: ${JSON.stringify(s)}`)
      eq(await api(page, () => window.__sygnalGraph.filter), { changes: true }, 'filter state')
      await page.locator('#f-clear').click()
    })

    // ── without a base: no diff anywhere ──
    {
      const plain = path.join(root, 'plain.html')
      fs.writeFileSync(plain, graphHtml(JSON.parse(JSON.stringify(synthGraph(30, 2))), { title: 'plain' }))
      const p2 = await open(plain, 'plain')
      await check('without --base: no Changes section, no filter, no marks', async () => {
        eq(await p2.locator('#diffsec').count(), 0, 'no section')
        eq(await p2.locator('#nodes .dmark').count(), 0, 'no marks')
        await p2.locator('#filter-btn').click()
        ok(!(await p2.locator('#fl-changes').isVisible()), 'no "Changes only"')
        eq(await api(p2, () => window.__sygnalGraph.diff), null, 'api.diff')
      })
    }

    // ── a large graph: folded groups count their changes ──
    {
      const base = synthGraph(400, 3)
      const head = { ...base, components: base.components.slice(0, -12).map((c, i) => i % 40 === 5 ? { ...c, stateKeys: [...(c.stateKeys || []), 'extra'] } : c) }
      const big = path.join(root, 'big.html')
      fs.writeFileSync(big, graphHtml(head, { title: 'big', base: { ref: 'main', graph: base } }))
      const p3 = await open(big, 'large')
      await check('large tier: folded group cards carry a changed-count badge (and say so)', async () => {
        eq(await api(p3, () => window.__sygnalGraph.tier.name), 'large', 'tier')
        const badges = p3.locator('#nodes .node.group .dmark')
        ok(await badges.count() > 0, 'badges on folded groups')
        const lbl = await p3.locator('#nodes .node.group').filter({ has: p3.locator('.dmark') }).first().getAttribute('aria-label')
        ok(/\d+ changed since main/.test(lbl), `aria-label: ${lbl}`)
        const total = await api(p3, () => window.__sygnalGraph.diff.removed.length + window.__sygnalGraph.diff.changed.length + window.__sygnalGraph.diff.added.length)
        const sum = await api(p3, () => { const a = window.__sygnalGraph; return a.projection.nodes.reduce((n, x) => n + (x.type === 'group' ? x.members.filter(id => a.model.byId.get(id).diff).length : x.comp?.diff ? 1 : 0), 0) })
        eq(sum, total, 'every change is in a badge or on a card')
      })
    }
  } catch (e) {
    results.push({ name: 'diff pages', pass: false, detail: e.message.split('\n')[0] })
  } finally {
    for (const f of cleanup.reverse()) { try { await f() } catch (_) { /* gone */ } }
  }

  const failed = results.filter(r => !r.pass)
  const lines = [`Graph view diff (${engine} ${browser.version()}): ${results.length - failed.length}/${results.length} passed`]
  for (const f of failed) lines.push(`  FAIL: ${f.name} — ${f.detail}`)
  for (const e of errors) lines.push(`  FAIL: ${e}`)
  if (requests.length) lines.push(`  FAIL: ${requests.length} network request(s): ${requests.slice(0, 5).join(', ')}`)
  console.log(lines.join('\n') + `\nGraph view diff: ${Date.now() - t0} ms\n`)
  return failed.length + errors.length + requests.length
}
