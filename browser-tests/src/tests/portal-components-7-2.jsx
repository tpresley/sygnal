// Components inside a <Portal> (BROWSER=chromium|firefox|webkit): instantiated like any child (they
// rendered as a literal <kid> tag): the child renders into the target, re-renders with its state,
// a Collection inside the portal follows its array, and the portal's removal disposes them. Its own
// clicks reach it through document-level selection, as before; Sift #4: and through its own DOM
// source, as the owner's do (events from a portal's content bubble to its placeholder).
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

// Sift #4: the owner's DOM source hears its portal's content (a click, a focus, an element
// around the placeholder), and a child inside the portal its own elements, through select()
function Kid({ state }) { return <button className="pe-kid">kid {state.n}</button> }
Kid.intent = ({ DOM }) => ({ INC: DOM.select('.pe-kid').events('click') })
Kid.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
function Owner({ state }) {
  return (
    <main className="pe-owner">
      <output className="pe-got">{`${state.hint}/${state.wrap}/${state.focus}`}</output>
      <Portal target="#pc-modal">
        <section>
          <button className="pe-hint">hint</button>
          <input className="pe-field" aria-label="field" />
          <Kid state="kid" />
        </section>
      </Portal>
    </main>
  )
}
Owner.initialState = { hint: 0, wrap: 0, focus: 0, kid: { n: 0 } }
Owner.intent = ({ DOM }) => ({
  HINT: DOM.select('.pe-hint').events('click'),
  WRAP: DOM.select('.pe-owner').events('click'),
  FOCUS: DOM.select('.pe-field').events('focus'),
})
Owner.model = {
  HINT: (s) => ({ ...s, hint: s.hint + 1 }),
  WRAP: (s) => ({ ...s, wrap: s.wrap + 1 }),
  FOCUS: (s) => ({ ...s, focus: s.focus + 1 }),
}

export async function portalEventTests7_2() {
  await runTest("the owner's select() hears its portal's content; a child in it keeps its scope", async () => {
    const modal = document.createElement('div')
    modal.id = 'pc-modal'
    document.body.appendChild(modal)
    const { id, el } = mountOnScreen()
    const app = run(Owner, {}, { mountPoint: id })
    const got = () => el.querySelector('.pe-got').textContent
    try {
      await waitFor(() => modal.querySelector('.pe-hint'))
      await click('#pc-modal .pe-hint')
      assert(got() === '1/1/0', 'click: ' + got())
      await window.__pw('focus', '#pc-modal .pe-field')
      await waitFor(() => got() === '1/1/1')
      await click('#pc-modal .pe-kid')
      assert(modal.querySelector('.pe-kid').textContent === 'kid 1', 'kid: ' + modal.innerHTML)
      assert(got() === '1/2/1', "the kid's click bubbles to the owner, not to its .pe-hint: " + got())
    } finally { app.dispose() }
  })
}
