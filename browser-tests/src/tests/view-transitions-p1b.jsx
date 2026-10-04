// PLAN-4 P-1b (GS-12, D129): `C.viewTransitions = ['MOVE']` with makeViewTransitionDOMDriver()
// runs the patch those actions cause inside document.startViewTransition(); `['ROUTE']` does the
// same for route changes. prefers-reduced-motion and a missing API patch at once; continuous
// renders can't hold the page past the 200 ms cap; SYG645 without the driver.
import { run, makeRouter, Collection, Switchable, makeViewTransitionDOMDriver, getDiagnostics, clearDiagnostics } from 'sygnal'
import { resetChecks } from 'sygnal/diagnostics'
import { mount, assert, runTest, waitFor, wait } from '../harness.js'
// the docs page's CSS recipe, applied as written
import guide from '../../../docs/src/content/docs/guide/view-transitions.md?raw'

const CAT = 'View Transitions (PLAN-4 P-1b)'

// counts the calls and keeps the transitions (it still calls the real API when there is one)
function spyVT() {
  const real = document.startViewTransition, calls = []
  document.startViewTransition = function (cb) {
    const startedAt = performance.now()
    const t = real ? real.call(document, cb) : (cb(), null)
    const rec = { t, startedAt }
    t?.updateCallbackDone.then(() => { rec.doneAt = performance.now() }, () => {})
    calls.push(rec)
    return t
  }
  return { calls, restore: () => { if (real) document.startViewTransition = real; else delete document.startViewTransition } }
}
const settled = (calls) => Promise.all(calls.map(c => c.t?.finished.catch(() => 0)))

const Item = ({ state }) => <li className="item" style={{ viewTransitionName: 'p1b-' + state.id }}>{state.id}</li>
function Board({ state }) {
  return (
    <div>
      <ul className="a"><Collection of={Item} from="a" /></ul>
      <ul className="b"><Collection of={Item} from="b" /></ul>
      <p className="n">{state.n}</p>
    </div>
  )
}
Board.initialState = { a: [{ id: 'x' }, { id: 'y' }], b: [{ id: 'z' }], n: 0 }
Board.intent = ({ DOM }) => ({
  MOVE: DOM.select('document').events('p1b-move'),
  BUMP: DOM.select('document').events('p1b-bump'),
})
const move = (s) => s.a.length ? { ...s, a: s.a.slice(1), b: [...s.b, s.a[0]] } : { ...s, a: [...s.a, s.b[0]], b: s.b.slice(1) }
Board.model = { MOVE: move, BUMP: (s) => ({ ...s, n: s.n + 1 }) }
Board.viewTransitions = ['MOVE']

const fire = (name) => document.dispatchEvent(new CustomEvent(name))
const ids = (el, sel) => [...el.querySelectorAll(sel + ' .item')].map(li => li.textContent).join()

async function start(App = Board, { vt = true, drivers = {}, options = {} } = {}) {
  const { id, el } = mount()
  const app = run(App, { ...(vt && { DOM: makeViewTransitionDOMDriver(id) }), ...drivers }, { mountPoint: id, ...options })
  await waitFor(() => el.querySelector('.n'))
  await wait(30)
  return { el, app }
}

export async function viewTransitionTestsP1b() {
  const supported = typeof document.startViewTransition == 'function'

  await runTest(CAT, 'a listed action patches inside one View Transition (a Collection move across lists)', async () => {
    const spy = spyVT()
    const { el, app } = await start()
    try {
      fire('p1b-move')
      await waitFor(() => ids(el, '.b') == 'z,x', 1000)
      assert(spy.calls.length == (supported ? 1 : 0), `one transition: ${spy.calls.length}`)
      await settled(spy.calls)
      assert(ids(el, '.a') == 'y' && ids(el, '.b') == 'z,x', `final DOM: ${ids(el, '.a')} | ${ids(el, '.b')}`)
    } finally { spy.restore(); app.dispose() }
  })

  await runTest(CAT, 'the in-between patches of a cross-list move all land before the update callback resolves', async () => {
    if (!supported) return
    const spy = spyVT()
    const { el, app } = await start()
    const partial = []
    const mo = new MutationObserver(() => { if (el.querySelectorAll('.item').length != 3) partial.push(performance.now()) })
    mo.observe(el, { childList: true, subtree: true })
    try {
      fire('p1b-move')
      await waitFor(() => spy.calls.length == 1, 1000)
      await settled(spy.calls)
      const c = spy.calls[0]
      assert(c.doneAt, 'the update callback resolved')
      assert(partial.every(at => at <= c.doneAt), `partial states after the callback: ${partial.map(x => Math.round(x - c.doneAt))}`)
    } finally { mo.disconnect(); spy.restore(); app.dispose() }
  })

  await runTest(CAT, 'an unlisted action patches at once, without a transition', async () => {
    const spy = spyVT()
    const { el, app } = await start()
    try {
      fire('p1b-bump')
      await waitFor(() => el.querySelector('.n').textContent == '1', 1000)
      await wait(150)
      assert(spy.calls.length == 0, `no transition: ${spy.calls.length}`)
    } finally { spy.restore(); app.dispose() }
  })

  await runTest(CAT, 'prefers-reduced-motion: reduce patches at once', async () => {
    const spy = spyVT()
    const mm = window.matchMedia
    window.matchMedia = (q) => q.includes('reduce') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm.call(window, q)
    const { el, app } = await start()
    try {
      fire('p1b-move')
      await waitFor(() => ids(el, '.b') == 'z,x', 1000)
      assert(spy.calls.length == 0, `no transition: ${spy.calls.length}`)
    } finally { window.matchMedia = mm; spy.restore(); app.dispose() }
  })

  await runTest(CAT, 'no startViewTransition (older browser): patches at once', async () => {
    const real = document.startViewTransition
    document.startViewTransition = undefined
    const { el, app } = await start()
    try {
      fire('p1b-move')
      await waitFor(() => ids(el, '.b') == 'z,x', 1000)
    } finally { if (real) document.startViewTransition = real; else delete document.startViewTransition; app.dispose() }
  })

  await runTest(CAT, 'rapid moves and continuous renders: the DOM ends right and no update callback outlives the cap', async () => {
    const spy = spyVT()
    const { el, app } = await start()
    // an app that re-renders every 5 ms while it moves
    const timer = setInterval(() => fire('p1b-bump'), 5)
    try {
      for (let i = 0; i < 5; i++) { fire('p1b-move'); await wait(40) }
      clearInterval(timer)
      await wait(300)
      await settled(spy.calls)
      let s = { a: [{ id: 'x' }, { id: 'y' }], b: [{ id: 'z' }] }
      for (let i = 0; i < 5; i++) s = move(s)
      const want = s.a.map(i => i.id).join() + '|' + s.b.map(i => i.id).join()
      assert(ids(el, '.a') + '|' + ids(el, '.b') == want, `final DOM ${ids(el, '.a')}|${ids(el, '.b')}, want ${want}`)
      if (supported) {
        assert(spy.calls.length >= 1 && spy.calls.length <= 5, `transitions: ${spy.calls.length}`)
        const longest = Math.max(...spy.calls.map(c => (c.doneAt ?? Infinity) - c.startedAt))
        // 200 ms cap, plus the frame the browser takes to call back
        assert(longest < 300, `longest update callback ${Math.round(longest)} ms`)
      }
    } finally { clearInterval(timer); spy.restore(); app.dispose() }
  }, 6000)

  await runTest(CAT, "App.viewTransitions = ['ROUTE'] wraps a route change", async () => {
    const start0 = location.pathname + location.search
    history.replaceState(null, '', '/vt1b')
    const router = makeRouter({ routes: { home: '/', page: '/p/:id' }, base: '/vt1b', focus: false, scroll: false })
    const Home = () => <h2 className="h">home</h2>
    const Page = ({ state }) => <h2 className="h">page {state.route.params.id}</h2>
    function App({ state }) { return <div><Switchable of={{ home: Home, page: Page }} current={state.route.name} /><p className="n">x</p></div> }
    App.route = 'ROUTE'
    App.viewTransitions = ['ROUTE']
    App.initialState = { route: router.current() }
    App.intent = ({ DOM }) => ({ GO: DOM.select('document').events('p1b-go') })
    App.model = { ROUTE: (s, route) => ({ ...s, route }), GO: { ROUTER: () => ({ to: 'page', params: { id: 7 } }) } }
    const spy = spyVT()
    const { el, app } = await start(App, { drivers: { ROUTER: router.driver } })
    try {
      assert(el.querySelector('.h')?.textContent == 'home', `starts at home: ${el.innerHTML.slice(0, 80)}`)
      // the first ROUTE reply renders the same view: no patch, so no transition (and its
      // request expires instead of animating a later, unrelated patch)
      await wait(150)
      const before = spy.calls.length
      assert(before == 0, `no transition at start: ${before}`)
      fire('p1b-go')
      await waitFor(() => el.querySelector('.h')?.textContent == 'page 7', 1000)
      assert(spy.calls.length == (supported ? 1 : 0), `one transition for the route change: ${spy.calls.length}`)
      await settled(spy.calls)
    } finally {
      spy.restore(); app.dispose()
      await wait(10)
      history.replaceState(null, '', start0)
    }
  }, 6000)

  await runTest(CAT, 'SYG645: the static without makeViewTransitionDOMDriver() (silent with it)', async () => {
    resetChecks(); clearDiagnostics()
    // one app at a time: two Boards would share view-transition-names
    const plain = await start(Board, { vt: false, options: { diagnostics: 'collect' } })
    try {
      const d = getDiagnostics().filter(d => d.code == 'SYG645')
      assert(d.length == 1, `one SYG645: ${d.length}`)
      assert(/makeViewTransitionDOMDriver/.test(d[0].fix), d[0].fix)
      fire('p1b-move')
      await waitFor(() => ids(plain.el, '.b') == 'z,x', 1000)
    } finally { plain.app.dispose() }
    resetChecks(); clearDiagnostics()
    const withVT = await start(Board, { options: { diagnostics: 'collect' } })
    try {
      assert(!getDiagnostics().some(d => d.code == 'SYG645'), 'no SYG645 with the driver')
    } finally { withVT.app.dispose(); clearDiagnostics(); resetChecks() }
  })

  await runTest(CAT, "the docs' CSS recipe parses and raises a moving card (view-transition-class)", async () => {
    const css = guide.match(/```css\n([\s\S]*?)```/)[1]
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    const Card = ({ state }) => <li className="item" style={{ viewTransitionName: 'p1b-css-' + state.id, viewTransitionClass: 'card' }}>{state.id}</li>
    function Lanes({ state }) {
      return (
        <div>
          <ul className="a" style={{ viewTransitionName: 'p1b-lane-a', viewTransitionClass: 'lane' }}><Collection of={Card} from="a" /></ul>
          <ul className="b" style={{ viewTransitionName: 'p1b-lane-b', viewTransitionClass: 'lane' }}><Collection of={Card} from="b" /></ul>
          <p className="n">{state.n}</p>
        </div>
      )
    }
    Object.assign(Lanes, { initialState: Board.initialState, intent: Board.intent, model: Board.model, viewTransitions: ['MOVE'] })
    const spy = spyVT()
    const { el, app } = await start(Lanes)
    try {
      // every rule is valid where view-transition-class is (3 rules; older engines drop them)
      const classes = CSS.supports('view-transition-class: card')
      assert(!classes || style.sheet.cssRules.length == 3, `rules: ${style.sheet.cssRules.length}`)
      fire('p1b-move')
      await waitFor(() => ids(el, '.b') == 'z,x', 1000)
      if (supported && classes) {
        await spy.calls[0].t.ready
        const z = getComputedStyle(document.documentElement, '::view-transition-group(p1b-css-x)').zIndex
        const nw = getComputedStyle(document.documentElement, '::view-transition-new(p1b-lane-b)')
        const ow = getComputedStyle(document.documentElement, '::view-transition-old(p1b-lane-b)')
        assert(z == '1', `card group z-index: ${z}`)
        assert(ow.opacity == '0' && ow.animationName == 'none', `old lane snapshot: opacity ${ow.opacity}, animation ${ow.animationName}`)
        assert(nw.animationName == 'none' && nw.objectFit == 'none', `new lane snapshot: animation ${nw.animationName}, object-fit ${nw.objectFit}`)
      }
      await settled(spy.calls)
    } finally { spy.restore(); app.dispose(); style.remove() }
  })
}
