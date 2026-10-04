// P45-C: one render scheduler per app. In a real browser: an update is on the page within the
// event's own task (microtasks, no timer); a cross-Collection move leaves no in-between DOM state;
// the DOM source emits after a patch, not on DOM changes made outside Sygnal; two apps on a page
// flush independently.
import { run, Collection } from 'sygnal'
import { mount, assert, runTest, waitFor, wait } from '../harness.js'

const CAT = 'P45-C (render scheduler)'
const microtasks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }

function Echo({ state }) {
  return (
    <div>
      <input className="draft" value={state.draft} />
      <p className="echo">{state.draft}</p>
      <button className="inc">{state.n}</button>
    </div>
  )
}
Echo.initialState = { draft: '', n: 0 }
Echo.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), INC: DOM.click('.inc') })
Echo.model = { DRAFT: (s, draft) => ({ ...s, draft }), INC: (s) => ({ ...s, n: s.n + 1 }) }

const Item = ({ state }) => <li className="item">{state.id}</li>
function Board() {
  return (
    <div>
      <button className="mv">move</button>
      <ul className="a"><Collection of={Item} from="a" /></ul>
      <ul className="b"><Collection of={Item} from="b" /></ul>
    </div>
  )
}
Board.initialState = { a: [{ id: 'x' }, { id: 'y' }], b: [{ id: 'z' }] }
Board.intent = ({ DOM }) => ({ MV: DOM.click('.mv') })
Board.model = { MV: (s) => s.a.length ? { a: s.a.slice(1), b: [...s.b, s.a[0]] } : { a: [...s.a, s.b[0]], b: s.b.slice(1) } }

export async function schedulerTestsP45C() {
  await runTest(CAT, 'a click and a keystroke are on the page after microtasks only (no timer, no frame)', async () => {
    const { id, el } = mount()
    const app = run(Echo, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.inc'))
      await wait(30)
      el.querySelector('.inc').click()
      await microtasks()
      assert(el.querySelector('.inc').textContent == '1', `after the click: ${el.querySelector('.inc').textContent}`)
      const input = el.querySelector('.draft')
      input.value = 'a'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await microtasks()
      assert(el.querySelector('.echo').textContent == 'a', `after the keystroke: ${el.querySelector('.echo').textContent}`)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'a cross-Collection move leaves no in-between DOM state', async () => {
    const { id, el } = mount()
    const app = run(Board, {}, { mountPoint: id })
    let partial = 0, records = 0
    const mo = new MutationObserver(() => { records++; if (el.querySelectorAll('.item').length != 3) partial++ })
    try {
      await waitFor(() => el.querySelectorAll('.item').length == 3)
      await wait(30)
      mo.observe(el, { childList: true, subtree: true })
      for (let i = 0; i < 6; i++) { el.querySelector('.mv').click(); await wait(i % 2 ? 1 : 20) }
      await wait(50)
      assert(records > 0, 'the moves changed the DOM')
      assert(partial == 0, `${partial} DOM states without the moved item`)
      assert(el.querySelectorAll('.item').length == 3, 'three items at the end')
    } finally { mo.disconnect(); app.dispose() }
  })

  await runTest(CAT, 'the DOM source emits after a patch, not on a DOM change made outside Sygnal', async () => {
    const { id, el } = mount()
    const app = run(Echo, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.inc'))
      await wait(30)
      const seen = []
      app.sources.DOM.select('.inc').elements().addListener({ next: (els) => seen.push(els[0]?.textContent) })
      el.querySelector('.inc').parentNode.appendChild(document.createElement('hr'))
      await wait(30)
      assert(seen.join() == '0', `outside change: ${seen.join()}`)
      el.querySelector('.inc').click()
      await waitFor(() => seen.length == 2)
      assert(seen.join() == '0,1', `after the patch: ${seen.join()}`)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'two apps on one page update independently in the same task', async () => {
    const a = mount(), b = mount()
    const appA = run(Echo, {}, { mountPoint: a.id }), appB = run(Echo, {}, { mountPoint: b.id })
    try {
      await waitFor(() => a.el.querySelector('.inc') && b.el.querySelector('.inc'))
      await wait(30)
      a.el.querySelector('.inc').click()
      b.el.querySelector('.inc').click()
      b.el.querySelector('.inc').click()
      await microtasks()
      assert(a.el.querySelector('.inc').textContent == '1' && b.el.querySelector('.inc').textContent == '2',
        `a ${a.el.querySelector('.inc').textContent}, b ${b.el.querySelector('.inc').textContent}`)
      appA.dispose()
      b.el.querySelector('.inc').click()
      await microtasks()
      assert(b.el.querySelector('.inc').textContent == '3', `b after a's dispose: ${b.el.querySelector('.inc').textContent}`)
    } finally { appA.dispose(); appB.dispose() }
  })
}
