// A view that returns null, false or undefined renders nothing, as in React (BROWSER=chromium|
// firefox|webkit): an empty comment holds its place, so the view patches to and from an element in
// position among its siblings, with real clicks, on a fresh render and over renderToString's
// markup (hydration adopts the server's comment); as a Collection item; and `title={on && 'x'}`
// sets no title while `on` is false.
import { run, renderToString, Collection } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'A view that returns nothing (7.2)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)
const click = async (sel) => { await window.__pw('click', sel); await wait(40) }
const nodesOf = (el) => [...el.childNodes].map((n) => (n.nodeType == 1 ? n.localName : n.nodeName))

function Maybe({ state }) { return state.show ? <button className="nv-own">own {state.n}</button> : state.empty }
Maybe.intent = ({ DOM }) => ({ OWN: DOM.select('.nv-own').events('click') })
Maybe.model = { OWN: (s) => ({ ...s, n: s.n + 1 }) }

function Page({ state }) {
  return (
    <main>
      <button className="nv-toggle" title={state.kid.show && 'hide it'}>toggle</button>
      <section className="nv-wrap"><i>a</i><Maybe state="kid" /><b>z</b></section>
    </main>
  )
}
Page.intent = ({ DOM }) => ({ TOGGLE: DOM.select('.nv-toggle').events('click') })
Page.model = { TOGGLE: (s) => ({ ...s, kid: { ...s.kid, show: !s.kid.show } }) }
const pageWith = (empty) => Object.assign((p) => Page(p), Page, { initialState: { kid: { show: false, n: 0, empty } } })

function Item({ state }) { return state.hidden ? null : <li>{state.label}</li> }
function List() { return <main><button className="nv-show">show</button><ul><Collection of={Item} from="items" /></ul></main> }
List.initialState = { items: [{ id: 1, label: 'a' }, { id: 2, label: 'b', hidden: true }, { id: 3, label: 'c' }] }
List.intent = ({ DOM }) => ({ SHOW: DOM.select('.nv-show').events('click') })
List.model = { SHOW: (s) => ({ ...s, items: s.items.map((x) => ({ ...x, hidden: !x.hidden })) }) }

export async function nullViewTests7_2() {
  for (const [name, empty] of [['null', null], ['false', false], ['undefined', undefined]]) {
    for (const mode of ['fresh', 'hydrated']) {
      await runTest(`${name}, ${mode}: nothing in its place, then the element, then nothing; its own clicks count`, async () => {
        const App = pageWith(empty)
        const { id, el } = mountOnScreen()
        if (mode == 'hydrated') el.innerHTML = renderToString(App)
        const comment = el.querySelector('.nv-wrap')?.childNodes[1]
        const app = run(App, {}, { mountPoint: id })
        try {
          await waitFor(() => el.querySelector('.nv-wrap') && !el.querySelector('[data-sygnal-ssr]'))
          await wait(30)
          const wrap = el.querySelector('.nv-wrap'), toggle = el.querySelector('.nv-toggle')
          assert(nodesOf(wrap).join() === 'i,#comment,b', 'start: ' + nodesOf(wrap))
          if (mode == 'hydrated') assert(wrap.childNodes[1] === comment, 'the server comment is adopted')
          assert(!toggle.hasAttribute('title'), 'no title for false: ' + toggle.outerHTML)
          const [i, , b] = wrap.childNodes
          for (let round = 1; round <= 2; round++) {
            await click(`${id} .nv-toggle`)
            assert(nodesOf(wrap).join() === 'i,button,b', `round ${round} shown: ` + nodesOf(wrap))
            assert(toggle.getAttribute('title') === 'hide it', 'title: ' + toggle.outerHTML)
            await click(`${id} .nv-own`)
            assert(wrap.querySelector('.nv-own').textContent === 'own ' + round, 'own click: ' + wrap.textContent)
            await click(`${id} .nv-toggle`)
            assert(nodesOf(wrap).join() === 'i,#comment,b', `round ${round} hidden: ` + nodesOf(wrap))
            assert(!toggle.hasAttribute('title'), 'title removed: ' + toggle.outerHTML)
          }
          assert(wrap.firstChild === i && wrap.lastChild === b, 'the siblings are kept')
        } finally { app.dispose() }
      })
    }
  }

  await runTest('Collection items that render nothing keep their place', async () => {
    const { id, el } = mountOnScreen()
    const app = run(List, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('ul'))
      await wait(30)
      const ul = el.querySelector('ul')
      assert(nodesOf(ul).join() === 'li,#comment,li', 'start: ' + nodesOf(ul))
      await click(`${id} .nv-show`)
      assert(nodesOf(ul).join() === '#comment,li,#comment', 'flipped: ' + nodesOf(ul))
      assert(ul.textContent === 'b', 'text: ' + ul.textContent)
      await click(`${id} .nv-show`)
      assert(ul.textContent === 'ac', 'back: ' + ul.textContent)
    } finally { app.dispose() }
  })
}
