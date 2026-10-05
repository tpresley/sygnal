// PLAN-5 2-B: browser sources (B-3) and deferred lazy loading (B-4) in a real browser, under run()
// with makeBrowserDriver(). The runner's window.__pwBrowser drives the browser context (offline,
// permissions, geolocation, emulated media, a second tab writing localStorage).
//
// Engine notes (Playwright 1.63, headless): no engine lets a test hide the page for real, so
// visibility is checked with a simulated document.visibilityState + visibilitychange; WebKit
// doesn't deliver `storage` events between two pages of a context (the cross-tab test is skipped
// there: the setItem command's same-page event still runs) and denies clipboard reads outside its
// native paste menu (the test checks that the denial reaches the error action); WebKit has no
// requestIdleCallback (lazy 'idle' runs on its timeout fallback).
import { run, lazy, Suspense, makeBrowserDriver } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Browser sources (PLAN-5 2-B)'
const pw = (...a) => window.__pwBrowser(...a)

// an app on the on-screen stage; `log` collects every action's data by type
function start(Root) {
  const { id, el } = mountOnScreen()
  const app = run(Root, { BROWSER: makeBrowserDriver() }, { mountPoint: id })
  return { el, app, stop: () => { app.dispose(); clearStage() } }
}
const logger = () => { const log = {}; const add = (type) => (s, d) => { (log[type] ||= []).push(d); return { ...s, n: (s.n || 0) + 1 } }; return { log, add } }

export async function browserSourceTestsP5_2B() {
  const engine = await pw('engine')

  await runTest(CAT, 'intersection: not visible below the viewport, visible once moved into it', async () => {
    const { log, add } = logger()
    function Page({ state }) {
      return <div>{state.far ? <div style={{ height: '5000px' }} /> : null}<p className="target" data-id="t1">target</p></div>
    }
    Page.initialState = { far: true }
    Page.browser = () => ({ t: { intersection: '.target', action: 'VIS' } })
    Page.model = { VIS: add('VIS'), NEAR: (s) => ({ ...s, far: false }) }
    const { app, stop } = start(Page)
    try {
      await waitFor(() => log.VIS?.length >= 1)
      assert(log.VIS[0].visible === false, `first report: not visible (${JSON.stringify(log.VIS[0])})`)
      assert(log.VIS[0].index === 0 && log.VIS[0].dataset.id === 't1', 'index and dataset')
      app.__runtime.dispatch('root', 'NEAR')
      await waitFor(() => log.VIS.some(d => d.visible))
      const v = log.VIS.find(d => d.visible)
      assert(v.ratio > 0, `ratio > 0 (${v.ratio})`)
    } finally { stop() }
  })

  await runTest(CAT, 'resize: the content box, and each change', async () => {
    const { log, add } = logger()
    function Box({ state }) { return <div className="box" style={{ width: `${state.w}px`, height: '20px' }} /> }
    Box.initialState = { w: 100 }
    Box.browser = () => ({ size: { resize: '.box', action: 'SIZE' } })
    Box.model = { SIZE: add('SIZE'), WIDER: (s) => ({ ...s, w: 250 }) }
    const { app, stop } = start(Box)
    try {
      await waitFor(() => log.SIZE?.some(d => d.width === 100))
      app.__runtime.dispatch('root', 'WIDER')
      await waitFor(() => log.SIZE.some(d => d.width === 250))
      assert(log.SIZE.at(-1).height === 20, `height ${log.SIZE.at(-1).height}`)
    } finally { stop() }
  })

  await runTest(CAT, 'media: the current match, then a change (emulated prefers-color-scheme)', async () => {
    const { log, add } = logger()
    await pw('emulateMedia', { colorScheme: 'light' })
    function Theme() { return <p>theme</p> }
    Theme.initialState = {}
    Theme.browser = () => ({ dark: { media: '(prefers-color-scheme: dark)', action: 'DARK' } })
    Theme.model = { DARK: add('DARK') }
    const { stop } = start(Theme)
    try {
      await waitFor(() => log.DARK?.length >= 1)
      assert(log.DARK[0].matches === false, 'light at start')
      await pw('emulateMedia', { colorScheme: 'dark' })
      await waitFor(() => log.DARK.some(d => d.matches))
    } finally { stop(); await pw('emulateMedia', { colorScheme: null }) }
  })

  await runTest(CAT, 'storage: reads the key; setItem from a model entry; another tab\'s write', async () => {
    localStorage.setItem('p5-2b-theme', '"blue"')
    const { log, add } = logger()
    function Prefs() { return <p>prefs</p> }
    Prefs.initialState = {}
    Prefs.browser = () => ({ theme: { storage: 'p5-2b-theme', json: true, action: 'THEME' } })
    Prefs.model = { THEME: add('THEME'), SAVE: { BROWSER: () => ({ setItem: 'p5-2b-theme', value: 'green', json: true }) } }
    const { app, stop } = start(Prefs)
    try {
      await waitFor(() => log.THEME?.[0]?.value === 'blue')
      app.__runtime.dispatch('root', 'SAVE')
      await waitFor(() => log.THEME.some(d => d.value === 'green'))
      assert(localStorage.getItem('p5-2b-theme') === '"green"', 'written')
      if (engine !== 'webkit') {
        await pw('otherTab', 'p5-2b-theme', '"red"')
        await waitFor(() => log.THEME.some(d => d.value === 'red'))
        await pw('otherTab', 'p5-2b-theme', null)
        await waitFor(() => log.THEME.at(-1).value === null)
      }
    } finally { stop(); localStorage.removeItem('p5-2b-theme') }
  })

  await runTest(CAT, 'online: Playwright setOffline goes offline and back', async () => {
    const { log, add } = logger()
    function Net() { return <p>net</p> }
    Net.initialState = {}
    Net.browser = () => ({ net: { online: true, action: 'NET' } })
    Net.model = { NET: add('NET') }
    const { stop } = start(Net)
    try {
      await waitFor(() => log.NET?.[0]?.online === true)
      await pw('offline', true)
      await waitFor(() => log.NET.some(d => d.online === false))
      await pw('offline', false)
      await waitFor(() => log.NET.at(-1).online === true)
    } finally { stop(); await pw('offline', false) }
  })

  await runTest(CAT, 'visibility: the current state, then visibilitychange (simulated hidden page)', async () => {
    const { log, add } = logger()
    function Vis() { return <p>vis</p> }
    Vis.initialState = {}
    Vis.browser = () => ({ vis: { visibility: true, action: 'VIS' } })
    Vis.model = { VIS: add('VIS') }
    const { stop } = start(Vis)
    try {
      await waitFor(() => log.VIS?.[0]?.visible === true)
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await waitFor(() => log.VIS.at(-1).visible === false)
    } finally { delete document.visibilityState; stop() }
  })

  await runTest(CAT, 'geolocation: the granted position reaches the action', async () => {
    const refused = await pw('grant', ['geolocation'])
    assert(!refused, `geolocation permission: ${refused}`)
    await pw('geolocation', { latitude: 51.5, longitude: -0.12, accuracy: 10 })
    const { log, add } = logger()
    function Here() { return <p>here</p> }
    Here.initialState = {}
    Here.browser = () => ({ here: { geolocation: true, action: 'POS', error: 'GEO_ERR' } })
    Here.model = { POS: add('POS'), GEO_ERR: add('GEO_ERR') }
    const { stop } = start(Here)
    try {
      await waitFor(() => log.POS?.length || log.GEO_ERR?.length, 2500)
      assert(!log.GEO_ERR, `no error (${JSON.stringify(log.GEO_ERR)})`)
      assert(log.POS[0].latitude === 51.5 && log.POS[0].longitude === -0.12, JSON.stringify(log.POS[0]))
    } finally { stop(); await pw('clearPermissions') }
  })

  await runTest(CAT, 'clipboard: copy then paste from model entries (WebKit: paste denied, through the error action)', async () => {
    const refused = engine === 'chromium' ? await pw('grant', ['clipboard-read', 'clipboard-write']) : ''
    assert(!refused, `clipboard permission: ${refused}`)
    const { log, add } = logger()
    function Clip() { return <div><button className="copy">copy</button><button className="paste">paste</button></div> }
    Clip.initialState = {}
    Clip.intent = ({ DOM }) => ({ COPY: DOM.click('.copy'), PASTE: DOM.click('.paste') })
    Clip.model = {
      COPY: { BROWSER: () => ({ copy: 'p5-2b clip', ok: 'COPIED', error: 'FAILED' }) },
      PASTE: { BROWSER: { paste: true, ok: 'PASTED', error: 'FAILED' } },
      COPIED: add('COPIED'), PASTED: add('PASTED'), FAILED: add('FAILED'),
    }
    const { el, stop } = start(Clip)
    try {
      await window.__pw('click', `#${el.id} .copy`)
      await waitFor(() => log.COPIED || log.FAILED, 2500)
      assert(log.COPIED?.[0]?.text === 'p5-2b clip', `copied (${JSON.stringify(log)})`)
      await window.__pw('click', `#${el.id} .paste`)
      await waitFor(() => log.PASTED || log.FAILED, 2500)
      // WebKit only reads the clipboard through its native paste menu: the denial is the error action
      if (engine === 'webkit') assert(log.FAILED?.[0]?.name === 'NotAllowedError', `WebKit denies paste: ${JSON.stringify(log)}`)
      else assert(log.PASTED?.[0]?.text === 'p5-2b clip', `pasted (${JSON.stringify(log)})`)
    } finally { stop(); if (engine === 'chromium') await pw('clearPermissions') }
  }, 6000)

  // ─── B-4: lazy(…, { when }) ────────────────────────────────────────────────
  function Chart({ title }) { return <h2 className="chart">{title}</h2> }
  const counted = () => { const c = { n: 0 }; c.load = () => { c.n++; return new Promise(r => setTimeout(() => r({ default: Chart }), 20)) }; return c }

  await runTest(CAT, "lazy when: 'visible': loads only when the placeholder scrolls into view", async () => {
    const c = counted()
    const LazyChart = lazy(c.load, { when: 'visible' })
    function Page({ state }) { return <div>{state.far ? <div style={{ height: '5000px' }} /> : null}<LazyChart title="Sales" /></div> }
    Page.initialState = { far: true }
    Page.model = { NEAR: (s) => ({ ...s, far: false }) }
    const { el, app, stop } = start(Page)
    try {
      await waitFor(() => el.querySelector('[data-sygnal-when="visible"]'))
      await wait(150)
      assert(c.n === 0, 'not loaded while below the viewport')
      app.__runtime.dispatch('root', 'NEAR')
      await waitFor(() => el.querySelector('.chart')?.textContent === 'Sales')
      assert(c.n === 1, `loaded once (${c.n})`)
    } finally { stop() }
  })

  await runTest(CAT, "lazy when: 'visible' in Suspense: the fallback shows, then the component", async () => {
    const c = counted()
    const LazyChart = lazy(c.load, { when: 'visible' })
    function Page({ state }) {
      return <div>{state.far ? <div style={{ height: '5000px' }} /> : null}<Suspense fallback={<p className="skeleton" style={{ height: '40px' }}>Loading…</p>}><LazyChart title="Q3" /></Suspense></div>
    }
    Page.initialState = { far: true }
    Page.model = { NEAR: (s) => ({ ...s, far: false }) }
    const { el, app, stop } = start(Page)
    try {
      await waitFor(() => el.querySelector('.skeleton'))
      await wait(150)
      assert(c.n === 0, 'not loaded while the boundary is below the viewport')
      app.__runtime.dispatch('root', 'NEAR')
      await waitFor(() => el.querySelector('.chart')?.textContent === 'Q3')
      assert(!el.querySelector('.skeleton'), 'the fallback is gone')
    } finally { stop() }
  })

  await runTest(CAT, "lazy when: 'idle': loads once the browser is idle", async () => {
    const c = counted()
    const LazyChart = lazy(c.load, { when: 'idle' })
    assert(c.n === 0, 'not at lazy()')
    function Page() { return <div><LazyChart title="Idle" /></div> }
    Page.initialState = {}
    const { el, stop } = start(Page)
    try {
      await waitFor(() => el.querySelector('.chart')?.textContent === 'Idle', 3000)
      assert(c.n === 1, `loaded once (${c.n})`)
    } finally { stop() }
  }, 5000)
}
