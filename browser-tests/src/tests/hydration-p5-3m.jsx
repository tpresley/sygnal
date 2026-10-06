// PLAN-5 3-M (BROWSER=chromium|firefox|webkit): the hydrating first patch's review fixes in a real
// engine, with real input before start-up: fields after a component returning a fragment keep
// typed text and focus (G-481), a server-rendered textarea keeps its text / what the user typed
// (G-484), a <details> the user opened stays open (G-487), server-only style declarations go
// (G-483), data-* the client sets as attributes stay (G-482).
import { run, renderToString } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Hydration review fixes (PLAN-5 3-M)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

function Label() { return <><label htmlFor="p3m-name">Name</label><span>*</span></> }
function Nested() { return <><em>a</em><><b>b</b><b>c</b></></> }

function Form({ state }) {
  return (
    <form className="p3m" onSubmit={(e) => e.preventDefault()}>
      <Label />
      <span data-t="hint">hint</span>
      <input id="p3m-name" className="name" data-t="in" />
      <Nested />
      {state.none && <i>never</i>}
      <textarea data-t="ta" value={state.notes} />
      <textarea data-t="free" />
      <details data-t="details"><summary data-t="summary">more</summary>body</details>
      <div style={{ color: 'rgb(255, 0, 0)' }} attrs={{ 'data-x': '1' }} data-t="styled">s</div>
    </form>
  )
}
Form.initialState = { none: false, notes: 'server notes' }

export async function hydrationTestsP5_3M() {
  await runTest('fragments, holes, textarea, details, style and data-* over real input', async () => {
    const { id, el } = mountOnScreen()
    el.innerHTML = renderToString(Form, { state: Form.initialState })
    const all = [...el.querySelectorAll('*')]
    const q = (t) => el.querySelector(`[data-t="${t}"]`)
    // server-only declarations and a stale class (G-483)
    q('styled').setAttribute('style', 'color: rgb(255, 0, 0); padding: 3px')
    await window.__pw('type', `${id} [data-t="in"]`, 'typed')
    await window.__pw('type', `${id} [data-t="free"]`, 'free text')
    await window.__pw('click', `${id} [data-t="summary"]`)
    await window.__pw('focus', `${id} [data-t="in"]`)
    assert(q('details').open, 'opened before start-up')
    const app = run(Form, {}, { mountPoint: id })
    try {
      await waitFor(() => !el.querySelector('[data-sygnal-ssr]'))
      await wait(50)
      const gone = all.filter(e => !e.isConnected).map(e => e.localName + '.' + e.className)
      assert(gone.length == 0, 'replaced: ' + gone.join(', '))
      assert(q('in').value === 'typed', 'typed text: ' + q('in').value)
      assert(document.activeElement === q('in'), 'focus on ' + document.activeElement?.outerHTML?.slice(0, 60))
      assert(q('ta').value === 'server notes' && q('ta').childNodes.length === 0, 'textarea: ' + q('ta').value)
      assert(q('free').value === 'free text', 'free textarea: ' + q('free').value)
      assert(q('details').open, 'details open')
      assert(q('styled').style.padding === '' && getComputedStyle(q('styled')).color === 'rgb(255, 0, 0)', 'style: ' + q('styled').getAttribute('style'))
      assert(q('styled').getAttribute('data-x') === '1', 'data-x')
      await window.__pw('type', `${id} [data-t="in"]`, '!')
      assert(q('in').value === 'typed!', 'typed after start-up: ' + q('in').value)
    } finally { app.dispose() }
  })
}
