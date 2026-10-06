// PLAN-5 3-Q (BROWSER=chromium|firefox|webkit): fragments and the hydration follow-ups in a real
// engine, with real clicks and typing. Each fragment case runs on a fresh client render and over
// renderToString's markup (hydrated): a Portal first in a fragment, then inserts before it (G-518:
// the app used to stop updating); Collection items returning fragments reversed / inserted /
// removed (G-522); a child added inside a fragment (G-517). Then: `Hello, {name}!` before an
// input that keeps its typed text and focus (G-520), a form-associated custom element linked to
// its <form> by the `form` attribute (G-519), a user hook's insert at hydration (G-521).
import { run, renderToString, Collection, Portal } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Fragments and hydration follow-ups (PLAN-5 3-Q)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

/** mount App fresh or over its server markup; returns the app, the mount point and the server elements */
async function start(App, mode) {
  const { id, el } = mountOnScreen()
  if (mode == 'hydrated') el.innerHTML = renderToString(App, { state: App.initialState })
  const before = [...el.querySelectorAll('*')]
  const app = run(App, {}, { mountPoint: id })
  await waitFor(() => el.querySelector('button') && !el.querySelector('[data-sygnal-ssr]'))
  await wait(30)
  return { id, el, app, before }
}
const click = async (sel) => { await window.__pw('click', sel); await wait(40) }

function Tools({ state }) {
  return (
    <main>
      <button className="p3q-more">more</button>
      <output>{String(state.n)}</output>
      <div id="p3q-target" />
      <section>
        {state.n % 2 ? <i>odd</i> : null}
        <>
          <Portal target="#p3q-target"><b className="p3q-ported">ported</b></Portal>
          <span className="p3q-after">after</span>
        </>
        <>
          <a>a</a>
          {state.n % 2 ? <em>mid</em> : null}
          <u>u</u>
          {state.n % 2 ? <s>end</s> : null}
        </>
        <input className="p3q-last" />
      </section>
    </main>
  )
}
Tools.initialState = { n: 0 }
Tools.intent = ({ DOM }) => ({ MORE: DOM.select('.p3q-more').events('click') })
Tools.model = { MORE: (s) => ({ n: s.n + 1 }) }

function Item({ state }) { return <><dt>{state.k}</dt><dd><input className={'p3q-in-' + state.k} /></dd></> }
function List() {
  return (
    <main>
      <button className="p3q-rev">reverse</button>
      <button className="p3q-add">add</button>
      <button className="p3q-rm">remove</button>
      <dl><Collection of={Item} from="items" /></dl>
    </main>
  )
}
List.initialState = { items: [{ id: 1, k: 'a' }, { id: 2, k: 'b' }, { id: 3, k: 'c' }] }
List.intent = ({ DOM }) => ({ REV: DOM.select('.p3q-rev').events('click'), ADD: DOM.select('.p3q-add').events('click'), RM: DOM.select('.p3q-rm').events('click') })
List.model = {
  REV: (s) => ({ items: [...s.items].reverse() }),
  ADD: (s) => ({ items: [s.items[0], { id: 9, k: 'z' }, ...s.items.slice(1)] }),
  RM: (s) => ({ items: s.items.slice(1) }),
}

class P3qFace extends HTMLElement {
  static formAssociated = true
  constructor() { super(); this.internals = this.attachInternals() }
  get form() { return this.internals.form }
  connectedCallback() { this.internals.setFormValue('face-value') }
}
if (!customElements.get('p3q-face')) customElements.define('p3q-face', P3qFace)

export async function fragmentTestsP5_3Q() {
  for (const mode of ['fresh', 'hydrated']) {
    await runTest(`${mode}: a Portal first in a fragment, inserts before and inside fragments (G-518, G-517)`, async () => {
      const { id, el, app } = await start(Tools, mode)
      try {
        const sec = () => el.querySelector('section').innerHTML.replace(/<div class="sygnal-portal"[^>]*><\/div>/, '[P]')
        for (let n = 1; n <= 4; n++) {
          await click(`${id} .p3q-more`)
          assert(el.querySelector('output').textContent === String(n), `n = ${n}: ` + el.querySelector('output').textContent)
          const odd = n % 2
          const want = (odd ? '<i>odd</i>' : '') + '[P]<span class="p3q-after">after</span><a>a</a>' + (odd ? '<em>mid</em>' : '') + '<u>u</u>' + (odd ? '<s>end</s>' : '') + '<input class="p3q-last">'
          assert(sec() === want, `n = ${n}: ` + sec())
        }
        assert(el.querySelectorAll('.p3q-ported').length === 1 && el.querySelector('#p3q-target .p3q-ported'), 'ported once')
      } finally { app.dispose() }
    })

    await runTest(`${mode}: Collection items returning fragments move, insert and remove (G-522)`, async () => {
      const { id, el, app, before } = await start(List, mode)
      try {
        const order = () => [...el.querySelectorAll('dt')].map(e => e.textContent).join('')
        const inA = el.querySelector('.p3q-in-a')
        if (mode == 'hydrated') assert(before.includes(inA), 'the server input adopted')
        await window.__pw('type', `${id} .p3q-in-a`, 'typed')
        await click(`${id} .p3q-rev`)
        assert(order() === 'cba', 'reversed: ' + order())
        assert(el.querySelector('.p3q-in-a') === inA && inA.value === 'typed', 'the input moved with its item')
        await click(`${id} .p3q-add`)
        assert(order() === 'czba', 'inserted: ' + order())
        await click(`${id} .p3q-rm`)
        assert(order() === 'zba', 'removed: ' + order())
        const dl = el.querySelector('dl > div')
        assert([...dl.children].map(e => e.localName).join(',') === 'dt,dd,dt,dd,dt,dd', 'dt/dd pairs: ' + dl.innerHTML)
      } finally { app.dispose() }
    })
  }

  await runTest('hydrated: `Hello, {name}! <input>` keeps the input, its typed text and focus (G-520)', async () => {
    function Greet({ state }) { return <main><button>b</button><p>Hello, {state.name}! <input className="p3q-greet" /></p></main> }
    Greet.initialState = { name: 'Bob' }
    const { id, el } = mountOnScreen()
    el.innerHTML = renderToString(Greet, { state: Greet.initialState })
    const input = el.querySelector('.p3q-greet')
    await window.__pw('type', `${id} .p3q-greet`, 'typed')
    await window.__pw('focus', `${id} .p3q-greet`)
    const app = run(Greet, {}, { mountPoint: id })
    try {
      await waitFor(() => !el.querySelector('[data-sygnal-ssr]'))
      await wait(30)
      assert(el.querySelector('.p3q-greet') === input, 'input replaced')
      assert(input.value === 'typed' && document.activeElement === input, 'value / focus: ' + input.value)
      assert(el.querySelector('p').textContent === 'Hello, Bob! ', 'text: ' + el.querySelector('p').textContent)
    } finally { app.dispose() }
  })

  await runTest('a form-associated custom element: form attribute, linked to its <form>, value submitted (G-519)', async () => {
    function F() { return <main><button>b</button><form id="p3q-form" /><p3q-face form="p3q-form" attrs={{ name: 'face' }} /></main> }
    F.initialState = {}
    for (const mode of ['fresh', 'hydrated']) {
      const { el, app } = await start(F, mode)
      try {
        const face = el.querySelector('p3q-face'), form = el.querySelector('#p3q-form')
        assert(face && face.getAttribute('form') === 'p3q-form', mode + ': attribute ' + face?.outerHTML)
        assert(face.form === form, mode + ': linked')
        assert(new FormData(form).get('face') === 'face-value', mode + ': submitted')
      } finally { app.dispose(); clearStage() }
    }
  })

  await runTest("hydrated: a user hook with insert and postpatch: insert runs on the page's element (G-521)", async () => {
    const calls = []
    function C() { return <main><button>b</button><div className="p3q-chart" hook={{ insert: (v) => calls.push(v.elm.isConnected), postpatch: () => calls.push('pp') }}>chart</div></main> }
    C.initialState = {}
    const { el, app } = await start(C, 'hydrated')
    try {
      assert(calls.length === 1 && calls[0] === true, 'calls: ' + JSON.stringify(calls))
      assert(el.querySelectorAll('.p3q-chart').length === 1, 'one chart')
    } finally { app.dispose() }
  })
}
