// PLAN-10 W-2 / P-2 end to end (D543, D544): a Vite dev server (examples/kanban's Vite) with
// sygnal() on a copy of examples/kanban (plus one component nothing renders), the app and the graph
// page (/__sygnal/graph) open in one browser context of headless Chromium, Firefox and WebKit
// (browser-tests' cached Playwright builds, never downloaded; GRAPH_E2E_BROWSERS=chromium picks
// engines). The page shows the runtime data over the static graph: instance counts, a faded card for
// the unmounted component, a flash when an action runs, an instance's state; it follows a save over
// SSE without losing the overlay, and goes back to the static graph when the app tab closes.
// Also: a production build of the same app has no stamps and no graph code.
// Needs `npm run build`, `npm install --prefix examples/kanban` and `npm ci --prefix browser-tests`.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sygnal from '../dist/vite/plugin.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KANBAN = path.join(REPO, 'examples', 'kanban')
const kanbanVite = () => import(pathToFileURL(createRequire(path.join(KANBAN, 'package.json')).resolve('vite')).href)
const playwright = () => import(pathToFileURL(createRequire(path.join(REPO, 'browser-tests', 'package.json')).resolve('playwright')).href)

const UNUSED = `export function Unused({ state }) { return <p>{state.note}</p> }
Unused.initialState = { note: 'never rendered' }
`
const ROOT_KEY = 'src/RootComponent.jsx#RootComponent'
const LANE_KEY = 'src/LaneComponent.jsx#LaneComponent'
const TASK_KEY = 'src/TaskCard.jsx#TaskCard'
const UNUSED_KEY = 'src/Unused.jsx#Unused'

/** a copy of examples/kanban with sygnal and sygnal-check linked from this repo */
function kanbanCopy() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-graph-e2e-')))
  fs.cpSync(path.join(KANBAN, 'src'), path.join(dir, 'src'), { recursive: true })
  for (const f of fs.readdirSync(path.join(dir, 'src'))) if (/\.test\.|testHelpers/.test(f)) fs.rmSync(path.join(dir, 'src', f))
  fs.copyFileSync(path.join(KANBAN, 'index.html'), path.join(dir, 'index.html'))
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"kanban-graph","private":true,"type":"module"}')
  fs.writeFileSync(path.join(dir, 'src', 'Unused.jsx'), UNUSED)
  fs.mkdirSync(path.join(dir, 'node_modules'))
  fs.symlinkSync(REPO, path.join(dir, 'node_modules', 'sygnal'), 'dir')
  fs.symlinkSync(path.join(REPO, 'sygnal-check'), path.join(dir, 'node_modules', 'sygnal-check'), 'dir')
  return dir
}

const ENGINES = (process.env.GRAPH_E2E_BROWSERS || 'chromium,firefox,webkit').split(',').map((e) => e.trim()).filter(Boolean)
const pw = await playwright()
const engines = ENGINES.filter((e) => { try { return fs.existsSync(pw[e].executablePath()) } catch (_) { return false } })

let dir, server, base
const logs = []

beforeAll(async () => {
  dir = kanbanCopy()
  const vite = await kanbanVite()
  const saved = process.env.VITEST
  delete process.env.VITEST
  try {
    server = await vite.createServer({
      root: dir, configFile: false, logLevel: 'info', clearScreen: false,
      customLogger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), warnOnce: (m) => logs.push(m), error: (m) => logs.push(m), clearScreen() {}, hasErrorLogged: () => false, hasWarned: false },
      plugins: [sygnal()],
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
  } finally {
    if (saved !== undefined) process.env.VITEST = saved
  }
  await server.listen()
  base = `http://localhost:${server.httpServer.address().port}`
}, 60000)

afterAll(async () => {
  await server?.close()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

it('has at least Chromium cached', () => expect(engines).toContain('chromium'))

it('prints the page URL under the dev server URLs', () => {
  server.printUrls()
  expect(logs.some((m) => /➜ {2}Sygnal graph: http:\/\/(127\.0\.0\.1|localhost):\d+\/__sygnal\/graph$/.test(m))).toBe(true)
})

describe.each(engines)('the graph page with the app open in %s', (engine) => {
  let browser, context, app, graph
  const cards = () => graph.evaluate(() => Object.fromEntries(window.__sygnalGraph.model.comps.filter((c) => !c.ghost)
    .map((c) => [c.key, { count: c.rt ? c.rt.count : 0, mounted: c.mounted !== false, recent: c.rt ? c.rt.recent : null }])))
  const live = () => graph.evaluate(() => { const d = window.__sygnalLiveData; return d && { connected: d.connected, on: d.on, tabs: d.tabs, summary: d.summary } })

  beforeAll(async () => {
    browser = await pw[engine].launch({ headless: true })
    context = await browser.newContext()
    app = await context.newPage()
    await app.goto(base + '/')
    await app.waitForSelector('.add-task-btn')
    graph = await context.newPage()
    await graph.goto(base + '/__sygnal/graph')
    await graph.waitForFunction(() => window.__sygnalLiveData && window.__sygnalLiveData.on, null, { timeout: 20000 })
  }, 60000)
  afterAll(async () => { await browser?.close() })

  it('overlays the app tab: instance counts on the static cards, the unmounted one faded', async () => {
    const c = await cards()
    expect(c[ROOT_KEY]).toMatchObject({ count: 1, mounted: true })
    expect(c[LANE_KEY].count).toBe(await app.locator('.lane').count())
    expect(c[TASK_KEY].count).toBe(await app.locator('.task-card').count())
    expect(c[TASK_KEY].count).toBeGreaterThan(1)
    expect(c[UNUSED_KEY]).toMatchObject({ count: 0, mounted: false })
    expect(await live()).toMatchObject({ connected: true, on: true, tabs: 1, summary: { unmatched: [], ambiguous: [] } })
    // the cards as drawn: ×N, and the faded one
    const unusedId = await graph.evaluate((k) => window.__sygnalGraph.model.byKey.get(k), UNUSED_KEY)
    expect(await graph.locator(`.node.unmounted[data-id="${unusedId}"]`).count()).toBe(1)
    // (and the Extra* components an earlier engine's run added, which nothing renders either)
    expect(await graph.locator('.node.unmounted').count()).toBe(Object.values(c).filter((x) => !x.mounted).length)
    expect(await graph.locator('#t-livedata').getAttribute('aria-pressed')).toBe('true')
  })

  it('an action in the app flashes its card on the page and is counted', async () => {
    await graph.evaluate(() => {
      window.__flashes = []
      const api = window.__sygnalGraph, action = api.action
      api.action = (r) => { const hit = action(r); window.__flashes.push([r.type, hit]); return hit }
    })
    await app.locator('.add-task-btn').first().click()
    await graph.waitForFunction(() => window.__flashes.some(([t]) => t === 'SHOW_ADD_TASK'), null, { timeout: 10000 })
    expect(await graph.evaluate(() => window.__flashes.find(([t]) => t === 'SHOW_ADD_TASK'))).toEqual(['SHOW_ADD_TASK', true])
    // the next graph from the tab counts it on the Lane card
    await vi.waitFor(async () => expect((await cards())[LANE_KEY].recent.SHOW_ADD_TASK).toBeGreaterThanOrEqual(1), { timeout: 10000, interval: 100 })
  })

  it("the detail panel shows an instance's live state", async () => {
    await graph.evaluate((k) => window.__sygnalGraph.select(window.__sygnalGraph.model.byKey.get(k)), ROOT_KEY)
    await graph.waitForFunction(() => /"lanes"/.test(document.querySelector('#dinner .rt-state')?.textContent || ''), null, { timeout: 10000 })
    const text = await graph.locator('#dinner .rt-state').first().textContent()
    expect(text).toContain('Design homepage mockups')
    // the static detail stays: the file link
    expect(await graph.locator('#dinner .loc').textContent()).toContain('RootComponent.jsx')
  })

  it('a save updates the page over SSE and keeps the overlay', async () => {
    const before = await graph.evaluate(() => window.__sygnalLive.version)
    const name = `Extra${engine}`
    fs.writeFileSync(path.join(dir, 'src', `${name}.jsx`), `export function ${name}() { return <i /> }\n${name}.initialState = {}\n`)
    await graph.waitForFunction((v) => window.__sygnalLive.version > v, before, { timeout: 15000 })
    await vi.waitFor(async () => {
      const c = await cards()
      expect(c[`src/${name}.jsx#${name}`]).toMatchObject({ mounted: false })
      expect(c[ROOT_KEY].count).toBe(1)
    }, { timeout: 10000, interval: 100 })
    expect((await live()).on).toBe(true)
  })

  it('the toggle turns the overlay off and on', async () => {
    await graph.locator('#t-livedata').click()
    expect(await graph.locator('#t-livedata').getAttribute('aria-pressed')).toBe('false')
    expect(Object.values(await cards()).every((c) => c.count === 0 && c.mounted)).toBe(true)
    expect(await graph.locator('.node.unmounted').count()).toBe(0)
    await graph.locator('#t-livedata').click()
    await vi.waitFor(async () => expect((await cards())[ROOT_KEY].count).toBe(1), { timeout: 5000, interval: 100 })
  })

  it('closing the app tab leaves the static graph and disables the toggle', async () => {
    await app.close()
    await graph.waitForFunction(() => !window.__sygnalLiveData.connected, null, { timeout: 15000 })
    expect(await graph.locator('#t-livedata').isDisabled()).toBe(true)
    expect(await graph.locator('#t-livedata').getAttribute('title')).toMatch(/no app tab is connected/)
    expect(Object.values(await cards()).every((c) => c.count === 0 && c.mounted)).toBe(true)
  })
})

describe('a production build', () => {
  it('has no component stamps and no graph code', async () => {
    const vite = await kanbanVite()
    const src = kanbanCopy()
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-graph-build-'))
    try {
      await vite.build({ root: src, configFile: false, logLevel: 'silent', plugins: [sygnal()], build: { outDir, emptyOutDir: true } })
      const assets = path.join(outDir, 'assets')
      const code = fs.readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n')
      expect(code).toContain('Design homepage mockups')
      for (const m of ['__sygnalKey', 'sygnal:graph', 'installGraphBridge', '__sygnal/graph', 'mountLiveData', 'RootComponent.jsx#']) expect(code).not.toContain(m)
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true })
      fs.rmSync(src, { recursive: true, force: true })
    }
  }, 60000)
})
