// PLAN-5 3-W (BROWSER=chromium|firefox|webkit): after a DOM patch error (D224, G-543) the app's
// DOM stops updating and its root element (the mount point) is marked data-sygnal-error="patch":
// a CSS rule on it applies, state and events go on, onError gets phase 'patch', and dispose
// removes the mark. With real clicks.
import { run } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Patch error marker (PLAN-5 3-W)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

let armed = false
function App({ state }) {
  return (
    <main>
      <button className="p3w-inc">+</button>
      <output>{String(state.n)}</output>
      <i hook={{ update: () => { if (armed) { armed = false; throw new Error('p3w boom') } } }}>{String(state.n)}</i>
    </main>
  )
}
App.initialState = { n: 0 }
App.intent = ({ DOM }) => ({ INC: DOM.select('.p3w-inc').events('click') })
App.model = { INC: (s) => ({ n: s.n + 1 }) }

const click = async () => { await window.__pw('click', '.p3w-inc'); await wait(40) }

export async function patchErrorTestsP5_3W() {
  await runTest('G-543: the mount point is marked data-sygnal-error="patch" after a patch error; CSS sees it; dispose removes it', async () => {
    const style = document.createElement('style')
    style.textContent = '[data-sygnal-error="patch"] { outline: 3px solid rgb(200, 0, 0); }'
    document.head.appendChild(style)
    const { id, el } = mountOnScreen()
    const seen = []
    let n = 0
    const Counted = Object.assign((p) => App(p), App, { model: { INC: (s) => (n++, { n: s.n + 1 }) } })
    const app = run(Counted, {}, { mountPoint: id, onError: (e, info) => seen.push([e.message, info.phase]) })
    try {
      await waitFor(() => el.querySelector('.p3w-inc'))
      await click()
      assert(el.querySelector('output').textContent === '1', 'updates normally')
      assert(!el.hasAttribute('data-sygnal-error'), 'no mark while it works')
      assert(getComputedStyle(el).outlineStyle === 'none', 'no outline while it works')
      armed = true
      await click()
      assert(el.getAttribute('data-sygnal-error') === 'patch', 'marked after the patch error: ' + el.getAttribute('data-sygnal-error'))
      assert(getComputedStyle(el).outlineColor === 'rgb(200, 0, 0)', 'the CSS rule applies: ' + getComputedStyle(el).outlineColor)
      assert(JSON.stringify(seen) === '[["p3w boom","patch"]]', 'onError: ' + JSON.stringify(seen))
      const out = el.querySelector('output').textContent
      await click()
      assert(n === 3, 'events and state go on: ' + n)
      assert(el.querySelector('output').textContent === out, 'the DOM stays as it was')
      assert(el.getAttribute('data-sygnal-error') === 'patch', 'still marked')
    } finally {
      armed = false
      app.dispose()
      style.remove()
    }
    await wait(40)
    assert(!el.hasAttribute('data-sygnal-error'), 'dispose removes the mark')
    assert(el.innerHTML === '', 'dispose empties the mount point: ' + el.innerHTML)
  })
}
