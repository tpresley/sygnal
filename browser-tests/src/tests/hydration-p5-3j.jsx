// PLAN-5 3-J (G-456, G-466, D217; BROWSER=chromium|firefox|webkit): the app's first patch over
// server markup adopts the matching elements in a real engine. The server's HTML (renderToString)
// goes into an on-screen mount point; the user types, checks, focuses and scrolls before run();
// then the same elements are on the page with the server's attributes, the focus, the typed text,
// the checked box and the scroll position.
import { run, renderToString, Collection } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Hydration adopts server markup (PLAN-5 3-J)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

function Item({ state }) { return <li className="it" data-t={'item-' + state.id}>{state.label}</li> }
function Child() { return <section className="cc" data-t="comp"><span>child</span></section> }

function Page({ state }) {
  return (
    <main className="page" data-t="root">
      <p data-t="plain">plain</p>
      <p className="c1 c2" id="p3j-id" data-t="classId">class and id</p>
      <a href="#p3j-anchor" title="go" data-t="href">link</a>
      <div style={{ color: 'rgb(255, 0, 0)' }} role="note" aria-label="Note" data-t="style">style</div>
      <input className="f" data-t="input" />
      <input type="checkbox" className="cb" data-t="checkbox" />
      <input className="ctl" value={state.v} data-t="controlled" />
      <select className="sel" data-t="select"><option value="a">A</option><option value="b">B</option></select>
      <div className="scroller" style={{ height: '40px', overflow: 'auto' }} data-t="scroller"><div style={{ height: '400px' }}>tall</div></div>
      <svg viewBox="0 0 10 10" className="icon" data-t="svg"><circle cx="5" cy="5" r="2" /></svg>
      <ul className="list" data-t="list"><Collection of={Item} from="items" /></ul>
      <Child />
    </main>
  )
}
Page.initialState = { v: 'ctl', items: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] }

const attrs = (el) => el ? [...el.attributes].map(a => a.name + '=' + a.value).sort().join(' ') : 'GONE'

export async function hydrationTestsP5_3J() {
  await runTest('every server element is adopted, with its attributes, focus, typed text, checked box, scroll', async () => {
    const { id, el } = mountOnScreen()
    el.innerHTML = renderToString(Page, { state: Page.initialState })
    const before = new Map([...el.querySelectorAll('[data-t]')].map(e => [e.dataset.t, [e, attrs(e)]]))
    const all = [...el.querySelectorAll('*')]
    // real input before start-up
    await window.__pw('type', `${id} [data-t="input"]`, 'typed')
    await window.__pw('click', `${id} [data-t="checkbox"]`)
    el.querySelector('[data-t="scroller"]').scrollTop = 100
    await window.__pw('focus', `${id} [data-t="input"]`)
    const app = run(Page, {}, { mountPoint: id })
    try {
      await waitFor(() => !el.querySelector('[data-sygnal-ssr]'))
      await wait(50)
      const gone = all.filter(e => !e.isConnected).map(e => e.localName + '.' + e.className)
      assert(gone.length == 0, 'replaced: ' + gone.join(', '))
      for (const [t, [e, a]] of before) {
        const now = el.querySelector(`[data-t="${t}"]`)
        assert(now === e, t + ' was replaced')
        // (the root loses data-sygnal-ssr)
        const want = t == 'root' ? a.replace(/ data-sygnal-ssr=/, '') : a
        assert(attrs(now) === want, `${t}: ${attrs(now)} (server: ${want})`)
      }
      const q = (t) => el.querySelector(`[data-t="${t}"]`)
      assert(q('input').value === 'typed', 'typed text: ' + q('input').value)
      assert(document.activeElement === q('input'), 'focus on ' + document.activeElement?.outerHTML?.slice(0, 60))
      assert(q('checkbox').checked && q('checkbox').type === 'checkbox', 'checkbox')
      assert(q('scroller').scrollTop === 100, 'scrollTop ' + q('scroller').scrollTop)
      assert(q('controlled').value === 'ctl', 'controlled value')
      assert(getComputedStyle(q('style')).color === 'rgb(255, 0, 0)', 'style')
      assert(q('href').getAttribute('href') === '#p3j-anchor' && q('href').title === 'go', 'href/title')
      // typing after start-up goes on in the same field
      await window.__pw('type', `${id} [data-t="input"]`, '!')
      assert(q('input').value === 'typed!', 'typed after start-up: ' + q('input').value)
    } finally { app.dispose() }
  })

  await runTest('a later state change patches the adopted Collection items in place', async () => {
    function List({ state }) {
      return <div className="w"><button className="rev">rev</button><ul><Collection of={Item} from="items" /></ul></div>
    }
    List.initialState = { items: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }, { id: 3, label: 'three' }] }
    List.intent = ({ DOM }) => ({ REV: DOM.click('.rev') })
    List.model = { REV: (s) => ({ items: [...s.items].reverse() }) }
    const { id, el } = mountOnScreen()
    el.innerHTML = renderToString(List, { state: List.initialState })
    const one = el.querySelector('[data-t="item-1"]'), btn = el.querySelector('.rev')
    const app = run(List, {}, { mountPoint: id })
    try {
      await waitFor(() => !el.querySelector('[data-sygnal-ssr]'))
      assert(el.querySelector('.rev') === btn && el.querySelector('[data-t="item-1"]') === one, 'adopted')
      await window.__pw('click', `${id} .rev`)
      await waitFor(() => el.querySelector('li')?.textContent === 'three')
      assert(el.querySelector('[data-t="item-1"]') === one, 'item 1 kept across the reorder')
      assert([...el.querySelectorAll('li')].map(l => l.textContent).join() === 'three,two,one', 'order')
    } finally { app.dispose() }
  })

  await runTest("G-466: the mount point's own attributes are kept", async () => {
    function P() { return <p className="k">x</p> }
    P.initialState = {}
    const { id, el } = mountOnScreen()
    el.setAttribute('data-theme', 'dark')
    el.title = 'mount'
    el.innerHTML = renderToString(P, { state: {} })
    const p = el.firstChild
    const app = run(P, {}, { mountPoint: id })
    try {
      await waitFor(() => !el.querySelector('[data-sygnal-ssr]'))
      assert(el.firstChild === p, 'adopted')
      assert(el.getAttribute('data-theme') === 'dark' && el.title === 'mount', attrs(el))
    } finally { app.dispose() }
  })
}
