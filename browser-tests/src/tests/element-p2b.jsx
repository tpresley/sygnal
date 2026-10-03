// PLAN-4 P-2b (GS-13, D127): 'sygnal/element' defineElement in a plain page (real browser).
// Props/attributes → state, sinks → CustomEvents, connect/disconnect/reconnect, open and
// closed shadow roots with adopted styles, lazy properties, private instance fields, the HMR
// swap (defineElement again for the same tag), and an element next to a host run() app (G-212).
import { run } from 'sygnal'
import { defineElement } from 'sygnal/element'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Custom elements (sygnal/element)'

function Board({ state, uid }) {
  return (
    <div className="board" id={uid('board')}>
      <h3 className="title">{state.heading}</h3>
      <p className="meta">{`${state.count + 1}|${state.readonly}|${state.tasks.length}|${state.clicks}`}</p>
      <ul>{state.tasks.map((t) => <li className="task" data-id={t.id}>{t.name}</li>)}</ul>
      <button className="btn">+</button>
    </div>
  )
}
Board.initialState = { heading: 'none', count: 0, readonly: false, tasks: [], clicks: 0 }
Board.intent = ({ DOM }) => ({
  CLICK: DOM.select('.btn').events('click'),
  PICK: DOM.select('.task').events('click').map((e) => e.target.dataset.id),
})
Board.model = {
  CLICK: (state) => ({ ...state, clicks: state.clicks + 1 }),
  PICK: { PARENT: (state, id) => ({ id }) },
}

const props = { heading: String, count: Number, readonly: Boolean, tasks: Array }
const events = { PARENT: 'task-picked' }
defineElement('p2b-board', Board, { props, events })
defineElement('p2b-board-shadow', Board, { props, events, shadow: true, styles: '.title { color: rgb(255, 0, 0); }' })
const sheet = new CSSStyleSheet()
sheet.replaceSync('.title { color: rgb(0, 0, 255); }')
defineElement('p2b-board-closed', Board, { props, events, shadow: 'closed', styles: [sheet] })

const q = (root, sel) => root.querySelector(sel)
const meta = (root) => q(root, '.meta')?.textContent
async function place(html) {
  const { el } = mount()
  el.innerHTML = html
  const host = el.firstElementChild
  return { el, host }
}

export async function elementTestsP2b() {
  await runTest(CAT, 'attributes → typed state (string, number, boolean, JSON)', async () => {
    const { host } = await place(`<p2b-board heading="Hi" count="41" readonly tasks='[{"id":"a","name":"A"}]'></p2b-board>`)
    await waitFor(() => meta(host) === '42|true|1|0')
    assert(q(host, '.title').textContent === 'Hi', 'heading from attribute')
    host.setAttribute('count', '9'); host.removeAttribute('readonly')
    await waitFor(() => meta(host) === '10|false|1|0')
    host.remove()
  })

  await runTest(CAT, 'properties after upgrade; private instance fields', async () => {
    const { host } = await place('<p2b-board></p2b-board>')
    await waitFor(() => meta(host) === '1|false|0|0')
    host.tasks = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]
    host.heading = 'Prop'
    await waitFor(() => meta(host) === '1|false|2|0' && q(host, '.title').textContent === 'Prop')
    assert(host.tasks.length === 2, 'getter returns the property')
    assert(Object.getOwnPropertyNames(host).length === 0, 'no own fields')
    assert(!('app' in host) && !('p' in host) && !('root' in host), 'no public internals')
    host.remove()
  })

  await runTest(CAT, 'lazy property: set before the element is defined', async () => {
    const { el } = mount()
    const host = document.createElement('p2b-board-lazy')
    host.tasks = [{ id: 'z', name: 'Z' }]
    el.appendChild(host)
    defineElement('p2b-board-lazy', Board, { props, events })
    await waitFor(() => meta(host) === '1|false|1|0')
    assert(!Object.prototype.hasOwnProperty.call(host, 'tasks'), 'own property moved to the accessor')
    host.remove()
  })

  await runTest(CAT, 'PARENT → CustomEvent (detail, bubbles, composed) from light DOM', async () => {
    const { el, host } = await place(`<p2b-board tasks='[{"id":"t1","name":"T1"}]'></p2b-board>`)
    let got = null
    el.addEventListener('task-picked', (e) => { got = e })
    await waitFor(() => q(host, '.task'))
    q(host, '.task').click()
    await waitFor(() => got)
    assert(got.detail.id === 't1' && got.bubbles && got.composed, `detail ${JSON.stringify(got.detail)}`)
    host.remove()
  })

  await runTest(CAT, 'two light-DOM instances get distinct ids (uid root per instance)', async () => {
    const { el } = await place('<p2b-board></p2b-board><p2b-board></p2b-board>')
    await waitFor(() => el.querySelectorAll('.board').length === 2)
    const [a, b] = [...el.querySelectorAll('.board')].map((n) => n.id)
    assert(a && b && a !== b && a.startsWith('p2b-board-'), `ids ${a} ${b}`)
    el.innerHTML = ''
  })

  await runTest(CAT, 'shadow: open + string styles; delegated DOM events fire inside the shadow root', async () => {
    const { el, host } = await place(`<p2b-board-shadow tasks='[{"id":"s1","name":"S1"}]'></p2b-board-shadow>`)
    const root = host.shadowRoot
    await waitFor(() => root && meta(root) === '1|false|1|0')
    assert(!q(host, '.board'), 'nothing rendered in light DOM')
    assert(getComputedStyle(q(root, '.title')).color === 'rgb(255, 0, 0)', 'adopted string style applies')
    q(root, '.btn').click(); q(root, '.btn').click()
    await waitFor(() => meta(root) === '1|false|1|2')
    let got = null
    el.addEventListener('task-picked', (e) => { got = e })
    q(root, '.task').click()
    await waitFor(() => got)
    assert(got.detail.id === 's1' && got.target === host, 'event crosses the shadow boundary, retargeted to host')
    host.remove()
  })

  await runTest(CAT, "shadow: 'closed' + CSSStyleSheet", async () => {
    const orig = HTMLElement.prototype.attachShadow
    let root = null
    HTMLElement.prototype.attachShadow = function (init) { return (root = orig.call(this, init)) }
    try {
      const { host } = await place('<p2b-board-closed heading="C"></p2b-board-closed>')
      assert(host.shadowRoot === null && root, 'closed root is not exposed')
      await waitFor(() => meta(root) === '1|false|0|0')
      assert(!q(host, '.board'), 'nothing in light DOM')
      assert(getComputedStyle(q(root, '.title')).color === 'rgb(0, 0, 255)', 'adopted CSSStyleSheet applies')
      q(root, '.btn').click()
      await waitFor(() => meta(root) === '1|false|0|1')
      host.remove()
    } finally { HTMLElement.prototype.attachShadow = orig }
  })

  await runTest(CAT, 'disconnect disposes; reconnect runs fresh; a move keeps state', async () => {
    const { el, host } = await place('<p2b-board></p2b-board>')
    await waitFor(() => meta(host) === '1|false|0|0')
    q(host, '.btn').click()
    await waitFor(() => meta(host) === '1|false|0|1')
    const other = document.createElement('div'); el.appendChild(other)
    other.appendChild(host)                       // move: disconnected + connected in one task
    await wait(30)
    assert(meta(host) === '1|false|0|1', `move keeps state: ${meta(host)}`)
    q(host, '.btn').click()
    await waitFor(() => meta(host) === '1|false|0|2')
    host.remove()
    await wait(30)
    assert(host.childElementCount === 0, 'disposed and cleared')
    el.appendChild(host)
    await waitFor(() => meta(host) === '1|false|0|0')
    q(host, '.btn').click()
    await waitFor(() => meta(host) === '1|false|0|1')
    host.remove()
  })

  await runTest(CAT, 'shadow root: reconnect after removal renders and handles events again', async () => {
    const { el, host } = await place('<p2b-board-shadow></p2b-board-shadow>')
    const root = host.shadowRoot
    await waitFor(() => meta(root) === '1|false|0|0')
    q(root, '.btn').click()
    await waitFor(() => meta(root) === '1|false|0|1')
    host.remove()
    await wait(30)
    assert(root.childElementCount === 0, 'shadow root cleared')
    el.appendChild(host)
    await waitFor(() => meta(root) === '1|false|0|0')
    q(root, '.btn').click()
    await waitFor(() => meta(root) === '1|false|0|1')
    host.remove()
  })

  await runTest(CAT, 'HMR: defineElement again swaps live instances, keeping each one’s state', async () => {
    defineElement('p2b-board-hmr', Board, { props, events })
    const { el } = mount()
    el.innerHTML = '<p2b-board-hmr heading="one"></p2b-board-hmr><p2b-board-hmr heading="two"></p2b-board-hmr>'
    const [a, b] = el.children
    await waitFor(() => meta(a) && meta(b))
    q(a, '.btn').click()
    await waitFor(() => meta(a) === '1|false|0|1')
    function Board2({ state }) {
      return <div className="board"><h3 className="title">{'v2:' + state.heading}</h3><p className="meta">{String(state.clicks)}</p><button className="btn">+</button></div>
    }
    Object.assign(Board2, { initialState: Board.initialState, intent: Board.intent, model: Board.model })
    const Ctor = defineElement('p2b-board-hmr', Board2, { props, events })
    assert(Ctor === customElements.get('p2b-board-hmr'), 'same constructor')
    await waitFor(() => q(a, '.title')?.textContent === 'v2:one' && q(b, '.title')?.textContent === 'v2:two', 1500)
    await wait(60)
    assert(meta(a) === '1' && meta(b) === '0', `per-instance state kept: ${meta(a)} ${meta(b)}`)
    q(b, '.btn').click()
    await waitFor(() => meta(b) === '1')
    a.heading = 'uno'
    await waitFor(() => q(a, '.title').textContent === 'v2:uno')
    el.innerHTML = ''
    await wait(150)                                // the swap's HMR window closes
  })

  await runTest(CAT, 'G-212: next to a host run() app, an element HMR swap leaves the host alone', async () => {
    function Host({ state }) {
      return <div className="host"><span className="n">{String(state.n)}</span><p2b-board-g212 heading="in host"></p2b-board-g212></div>
    }
    Host.initialState = { n: 1 }
    defineElement('p2b-board-g212', Board, { props, events })
    const { id, el } = mount()
    const prior = window.__SYGNAL_DEVTOOLS_APP__   // an earlier suite's app may still be live
    const app = run(Host, {}, { mountPoint: id })
    try {
      await waitFor(() => q(el, '.n')?.textContent === '1' && meta(q(el, 'p2b-board-g212')) === '1|false|0|0')
      app.sinks.STATE.shamefullySendNext((s) => ({ ...s, n: 7 }))
      await waitFor(() => q(el, '.n').textContent === '7')
      const inner = q(el, 'p2b-board-g212')
      q(inner, '.btn').click()
      await waitFor(() => meta(inner) === '1|false|0|1')
      assert(window.__SYGNAL_DEVTOOLS_APP__ === (prior || app), 'the element does not take the DevTools slot')
      defineElement('p2b-board-g212', Board, { props, events })   // the element's module re-ran
      await wait(80)
      assert(meta(inner) === '1|false|0|1', `element kept its state: ${meta(inner)}`)
      // the host's own swap keeps the host's state (not the element's)
      app.hmr(Host)
      await wait(80)
      assert(q(el, '.n').textContent === '7', `host state kept: ${q(el, '.n').textContent}`)
    } finally {
      app.dispose()
      await wait(150)
    }
  })
}
