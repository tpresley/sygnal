// Components inside a <Portal> (BROWSER=chromium|firefox|webkit): instantiated like any child (they
// rendered as a literal <kid> tag): the child renders into the target, re-renders with its state,
// a Collection inside the portal follows its array, and the portal's removal disposes them. Its own
// clicks reach it through document-level selection (portal content is outside the app's scopes).
import { run, Portal, Collection } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Components inside a Portal (7.2)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage(); document.getElementById('pc-modal')?.remove() }
}, ms)
const click = async (sel) => { await window.__pw('click', sel); await wait(40) }

const disposed = []
function Counter({ state }) { return <button className="pc-inc">count {state.n}</button> }
Counter.intent = ({ DOM }) => ({ INC: DOM.select('document').select('.pc-inc').events('click') })
Counter.model = { INC: { STATE: (s) => ({ ...s, n: s.n + 1 }), PARENT: (s) => s.n }, DISPOSE: (s) => { disposed.push(s.n); return s } }
function Row({ state }) { return <li>{state.label}</li> }

function App({ state }) {
  return (
    <main>
      <button className="pc-close">close</button>
      <output className="pc-got">{String(state.got)}</output>
      {state.open && (
        <Portal target="#pc-modal">
          <section className="pc-dialog">
            <Counter state="counter" />
            <ul><Collection of={Row} from="rows" /></ul>
          </section>
        </Portal>
      )}
    </main>
  )
}
App.initialState = { open: true, got: 0, counter: { n: 0 }, rows: [{ id: 1, label: 'r1' }] }
App.intent = ({ DOM, CHILD }) => ({ CLOSE: DOM.select('.pc-close').events('click'), GOT: CHILD.select(Counter) })
App.model = {
  CLOSE: (s) => ({ ...s, open: false }),
  GOT: (s, n) => ({ ...s, got: n, rows: [...s.rows, { id: n + 1, label: 'r' + (n + 1) }] }),
}

export async function portalComponentTests7_2() {
  await runTest('a component in a portal renders into the target, updates, sends PARENT and is disposed with it', async () => {
    const modal = document.createElement('div')
    modal.id = 'pc-modal'
    document.body.appendChild(modal)
    disposed.length = 0
    const { id, el } = mountOnScreen()
    const app = run(App, {}, { mountPoint: id })
    try {
      await waitFor(() => modal.querySelector('.pc-inc'))
      assert(!modal.querySelector('counter'), 'no literal tag: ' + modal.innerHTML)
      assert(modal.querySelector('.pc-inc').textContent === 'count 0', 'start: ' + modal.innerHTML)
      await click('#pc-modal .pc-inc')
      await click('#pc-modal .pc-inc')
      assert(modal.querySelector('.pc-inc').textContent === 'count 2', 'counted: ' + modal.innerHTML)
      assert(el.querySelector('.pc-got').textContent === '2', 'PARENT: ' + el.querySelector('.pc-got').textContent)
      assert([...modal.querySelectorAll('li')].map((li) => li.textContent).join() === 'r1,r2,r3', 'rows: ' + modal.innerHTML)
      await click(`${id} .pc-close`)
      assert(!modal.querySelector('.pc-dialog'), 'removed: ' + modal.innerHTML)
      assert(disposed.join() === '2', 'disposed: ' + disposed)
    } finally { app.dispose() }
  })
}
