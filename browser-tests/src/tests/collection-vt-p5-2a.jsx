// PLAN-5 2-A (A-1, S-6): `<Collection viewTransitionName="p52a" />` names each keyed item
// `p52a-<id>` (view-transition-class `p52a`), so a reorder or a move between two Collections in a
// `viewTransitions` action animates each item: one startViewTransition() call, a
// ::view-transition-group per item that moves, and none under prefers-reduced-motion (emulated
// for real here). All three engines run same-document View Transitions (D195's evergreen floor),
// so there is no FLIP fallback.
import { run, Collection, makeViewTransitionDOMDriver, getDiagnostics, clearDiagnostics } from 'sygnal'
import { resetChecks } from 'sygnal/diagnostics'
import { mount, assert, runTest, waitFor, wait } from '../harness.js'

const CAT = 'Collection view-transition names (PLAN-5 A-1)'

function spyVT(quiet) {
  const real = document.startViewTransition, calls = []
  document.startViewTransition = function (cb) {
    const t = real.call(document, cb)
    // (quiet: a transition expected to be skipped rejects its promises: handled here)
    if (quiet) for (const p of ['ready', 'finished', 'updateCallbackDone']) t[p]?.catch(() => {})
    calls.push(t)
    return t
  }
  return { calls, restore: () => { document.startViewTransition = real } }
}

const Item = ({ state }) => <li className="item">{state.id}</li>
function Lists({ state }) {
  return (
    <div>
      <ul className="a"><Collection of={Item} from="a" viewTransitionName="p52a" /></ul>
      <ul className="b"><Collection of={Item} from="b" viewTransitionName="p52a" /></ul>
      <p className="n">{state.n}</p>
    </div>
  )
}
Lists.initialState = { a: [{ id: 1 }, { id: 2 }, { id: 3 }], b: [{ id: 4 }], n: 0 }
Lists.intent = ({ DOM }) => ({
  REVERSE: DOM.select('document').events('p52a-reverse'),
  MOVE: DOM.select('document').events('p52a-move'),
})
Lists.model = {
  REVERSE: (s) => ({ ...s, a: [...s.a].reverse() }),
  MOVE: (s) => ({ ...s, a: s.a.slice(1), b: [...s.b, s.a[0]] }),
}
Lists.viewTransitions = ['REVERSE', 'MOVE']

const fire = (name) => document.dispatchEvent(new CustomEvent(name))
const ids = (el, sel) => [...el.querySelectorAll(sel + ' .item')].map(li => li.textContent).join()
const names = (el) => [...el.querySelectorAll('.item')].map(li => li.textContent + ':' + getComputedStyle(li).viewTransitionName + '/' + getComputedStyle(li).viewTransitionClass).join()
// the item ids whose ::view-transition-group the running transition animates from one place to
// another (its first and last transform keyframes differ), sorted. An item that stays put has a
// group too, with the same transform at both ends
const travelled = () => document.documentElement.getAnimations({ subtree: true })
  .filter(a => (a.effect?.pseudoElement || '').startsWith('::view-transition-group(p52a-'))
  .filter(a => { const k = a.effect.getKeyframes(); return k.length > 1 && k[0].transform && k[0].transform != k[k.length - 1].transform })
  .map(a => a.effect.pseudoElement.slice('::view-transition-group(p52a-'.length, -1)).sort().join()

// PLAN-5 3-I G-460: SYG149 counts rendered elements only: the second list, in a display: none
// panel, has the same ids under the same prefix; shown (in a View Transition, so the patch runs in
// its update callback, after the check's first look), both are on the page
function Panels({ state }) {
  return (
    <div>
      <ul className="a"><Collection of={Item} from="items" viewTransitionName="p53i" /></ul>
      <div className="panel" style={{ display: state.shown ? 'block' : 'none' }}>
        <ul className="b"><Collection of={Item} from="items" viewTransitionName="p53i" /></ul>
      </div>
    </div>
  )
}
Panels.initialState = { items: [{ id: 1 }, { id: 2 }], shown: false }
Panels.intent = ({ DOM }) => ({ SHOW: DOM.select('document').events('p53i-show') })
Panels.model = { SHOW: (s) => ({ ...s, shown: true }) }
Panels.viewTransitions = ['SHOW']

async function start() {
  const { id, el } = mount()
  const app = run(Lists, { DOM: makeViewTransitionDOMDriver(id) }, { mountPoint: id })
  await waitFor(() => el.querySelector('.n'))
  await wait(30)
  return { el, app }
}

export async function collectionViewTransitionTestsP5_2A() {
  const engine = await window.__pwBrowser('engine')

  await runTest(CAT, `${engine} runs same-document View Transitions with view-transition-class (no FLIP fallback needed)`, async () => {
    assert(typeof document.startViewTransition == 'function', 'document.startViewTransition')
    assert(CSS.supports('view-transition-name: a') && CSS.supports('view-transition-class: a'), 'view-transition-name / -class')
  })

  await runTest(CAT, 'each item carries <prefix>-<id> and the prefix as its class', async () => {
    const { el, app } = await start()
    try {
      assert(names(el) == '1:p52a-1/p52a,2:p52a-2/p52a,3:p52a-3/p52a,4:p52a-4/p52a', names(el))
    } finally { app.dispose() }
  })

  await runTest(CAT, 'a reorder runs in one View Transition that animates each moved item', async () => {
    const spy = spyVT()
    const { el, app } = await start()
    try {
      fire('p52a-reverse')
      await waitFor(() => spy.calls.length == 1, 1000)
      await spy.calls[0].ready
      assert(ids(el, '.a') == '3,2,1', ids(el, '.a'))
      assert(names(el).startsWith('3:p52a-3/p52a,2:p52a-2/p52a,1:p52a-1/p52a'), names(el))
      // 1 and 3 swap places; 2 (the middle) and 4 (the other list) stay
      assert(travelled() == '1,3', `items that travel: ${travelled()}`)
      await spy.calls[0].finished
      assert(spy.calls.length == 1, `one transition: ${spy.calls.length}`)
    } finally { spy.restore(); app.dispose() }
  })

  await runTest(CAT, 'an item moved to another Collection with the same prefix keeps its name and animates across', async () => {
    const spy = spyVT()
    const { el, app } = await start()
    try {
      const old = el.querySelector('.a .item')
      fire('p52a-move')
      await waitFor(() => spy.calls.length == 1, 1000)
      await spy.calls[0].ready
      const moved = el.querySelector('.b .item:last-child')
      assert(ids(el, '.b') == '4,1' && moved !== old, `moved as a new element: ${ids(el, '.b')}`)
      assert(getComputedStyle(moved).viewTransitionName == 'p52a-1', getComputedStyle(moved).viewTransitionName)
      // 1 flies to the other list; 2, 3 and the list below them (4) move up a place
      assert(travelled() == '1,2,3,4', `items that travel: ${travelled()}`)
      await spy.calls[0].finished
    } finally { spy.restore(); app.dispose() }
  })

  await runTest(CAT, 'G-460: SYG149 ignores a list in a display: none panel, and reports it once the panel is shown', async () => {
    resetChecks()
    clearDiagnostics()
    // the transition with both lists shown is skipped (that is what SYG149 warns of): its promises
    // reject (InvalidStateError); Chromium also logs the name (EXPECTED_CONSOLE_ERRORS)
    const spy = spyVT(true)
    const { id, el } = mount()
    const app = run(Panels, { DOM: makeViewTransitionDOMDriver(id) }, { mountPoint: id, diagnostics: 'collect' })
    const syg149 = () => getDiagnostics().filter((d) => d.code == 'SYG149').map((d) => d.data.name).sort().join()
    try {
      await waitFor(() => el.querySelectorAll('.item').length == 4)
      await wait(150)
      assert(syg149() == '', `SYG149 for hidden items: ${syg149()}`)
      fire('p53i-show')
      await waitFor(() => spy.calls.length == 1, 1000)
      await waitFor(() => getComputedStyle(el.querySelector('.panel')).display == 'block', 1000)
      await waitFor(() => syg149() == 'p53i-1,p53i-2', 1500).catch(() => {})
      assert(syg149() == 'p53i-1,p53i-2', `SYG149 once shown: ${syg149() || 'none'}`)
    } finally { spy.restore(); app.dispose() }
  })

  await runTest(CAT, 'prefers-reduced-motion: reduce (emulated) moves at once, with no transition', async () => {
    await window.__pwBrowser('emulateMedia', { reducedMotion: 'reduce' })
    const spy = spyVT()
    const { el, app } = await start()
    try {
      assert(matchMedia('(prefers-reduced-motion: reduce)').matches, 'reduced motion emulated')
      fire('p52a-reverse')
      await waitFor(() => ids(el, '.a') == '3,2,1', 1000)
      await wait(50)
      assert(spy.calls.length == 0, `no transition: ${spy.calls.length}`)
      assert(names(el).startsWith('3:p52a-3/p52a'), names(el))
    } finally { spy.restore(); app.dispose(); await window.__pwBrowser('emulateMedia', { reducedMotion: null }) }
  })
}
