// Real-browser regression tests for G-144 (fragment-root isolation), G-145 (events bubble out
// of children) and G-146 (controlled inputs keep fast keystrokes).
import { run, Collection } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'DOM isolation and controlled inputs (G-144..G-146)'
const bump = (k) => (s) => ({ ...s, [k]: s[k] + 1 })

async function start(App) {
  const { id, el } = mount()
  const app = run(App, {}, { mountPoint: id })
  await waitFor(() => el.firstElementChild)
  await wait(30)
  return { el, id, app }
}

// Real keystrokes from Playwright (run-headless.mjs exposes window.__pwType); in a hand-run
// browser the same key events are typed with dispatchEvent instead.
async function typeKeys(selector, text, delay = 0) {
  if (window.__pwType) return window.__pwType(selector, text, delay)
  const input = document.querySelector(selector)
  for (const ch of text) {
    input.value += ch
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }))
    await new Promise(r => setTimeout(r, delay))
  }
}

export async function domIsolationTests() {
  // ─── G-144 ─────────────────────────────────────────────────────────────────
  await runTest(CAT, 'G-144: a fragment-root child hears its own clicks; the parent does not', async () => {
    function Frag({ state }) { return <><button className="fa">fa</button><span className="fn">{state.fragHits}</span></> }
    Frag.intent = ({ DOM }) => ({ OWN: DOM.click('.fa') })
    Frag.model = { OWN: bump('fragHits') }
    function Box() { return <div className="box"><button className="ba">ba</button></div> }
    Box.intent = ({ DOM }) => ({ OWN: DOM.click('.ba') })
    Box.model = { OWN: bump('boxHits') }
    function Parent({ state }) {
      return <div><Frag /><Box /><p className="out">{`${state.fragHits} ${state.boxHits} ${state.leakFrag} ${state.leakBox}`}</p></div>
    }
    Parent.initialState = { fragHits: 0, boxHits: 0, leakFrag: 0, leakBox: 0 }
    Parent.intent = ({ DOM }) => ({ LF: DOM.click('.fa'), LB: DOM.click('.ba') })
    Parent.model = { LF: bump('leakFrag'), LB: bump('leakBox') }
    const { el, app } = await start(Parent)
    el.querySelector('.fa').click(); await wait(30)
    el.querySelector('.ba').click(); await wait(30)
    const out = el.querySelector('.out').textContent
    app.dispose()
    assert(out === '1 1 0 0', `fragHits boxHits leakFrag leakBox: ${out}`)
  })

  await runTest(CAT, 'G-144: Collection items that return fragments stay isolated', async () => {
    function Row({ state }) { return <><dt>{state.id}</dt><dd><button className="hit" data-id={state.id}>{state.n}</button></dd></> }
    Row.intent = ({ DOM }) => ({ HIT: DOM.click('.hit') })
    Row.model = { HIT: (s) => ({ ...s, n: s.n + 1 }) }
    function List({ state }) { return <div><dl><Collection of={Row} from="rows" /></dl><p className="leak">{state.leak}</p></div> }
    List.initialState = { rows: [{ id: 'r1', n: 0 }, { id: 'r2', n: 0 }], leak: 0 }
    List.intent = ({ DOM }) => ({ LEAK: DOM.click('.hit') })
    List.model = { LEAK: bump('leak') }
    const { el, app } = await start(List)
    el.querySelector('.hit[data-id="r2"]').click(); await wait(30)
    const counts = [...el.querySelectorAll('.hit')].map(b => b.textContent).join(',')
    const leak = el.querySelector('.leak').textContent
    app.dispose()
    assert(counts === '0,1' && leak === '0', `counts ${counts}, leak ${leak}`)
  })

  // ─── G-145 ─────────────────────────────────────────────────────────────────
  await runTest(CAT, "G-145: the parent's wrapper hears clicks from inside the children it wraps", async () => {
    function Child() { return <div className="child"><button className="inner">inner</button><span className="txt">t</span></div> }
    Child.intent = ({ DOM }) => ({ INNER: DOM.click('.inner') })
    Child.model = { INNER: { PARENT: () => 'inner-clicked' } }
    function FragChild() { return <><button className="a">a</button><p className="b">b</p></> }
    function Parent({ state }) {
      return <div>
        <div className="slot"><Child state="c" /></div>
        <div className="slot"><FragChild /></div>
        <p className="log">{state.log.join(' | ')}</p>
      </div>
    }
    Parent.initialState = { c: {}, log: [] }
    Parent.intent = ({ DOM, CHILD }) => ({ WRAP: DOM.click('.slot'), FROM: CHILD.select(Child), PEEK: DOM.click('.inner') })
    Parent.model = {
      WRAP: (s, e) => ({ ...s, log: [...s.log, 'wrap:' + e.target.tagName] }),
      FROM: (s, v) => ({ ...s, log: [...s.log, 'child:' + v] }),
      PEEK: (s) => ({ ...s, log: [...s.log, 'peek'] }),
    }
    const { el, app } = await start(Parent)
    for (const sel of ['.inner', '.txt', '.a', '.b']) { el.querySelector(sel).click(); await wait(30) }
    const log = el.querySelector('.log').textContent
    app.dispose()
    assert(log === 'child:inner-clicked | wrap:BUTTON | wrap:SPAN | wrap:BUTTON | wrap:P', log)
  })

  // ─── G-146 ─────────────────────────────────────────────────────────────────
  await runTest(CAT, 'G-146: a controlled input keeps every key, pressSequentially delay 0', async () => {
    function F({ state }) { return <div><input className="draft" value={state.draft} /><p className="echo">{state.draft}</p></div> }
    F.initialState = { draft: '' }
    F.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value() })
    F.model = { DRAFT: (s, draft) => ({ ...s, draft }) }
    const { el, id, app } = await start(F)
    await typeKeys(`${id} .draft`, 'Hello world, typed quickly')
    await wait(50)
    const value = el.querySelector('.draft').value, echo = el.querySelector('.echo').textContent
    app.dispose()
    assert(value === 'Hello world, typed quickly' && echo === value, `input "${value}", state "${echo}"`)
  }, 10000)

  // On main these lost keys in Chromium ('Helworl ty quickly', 'Heo wldtyd icy', ...). A slow
  // view (busy-waiting, like a large render) widens the window to human typing speeds.
  for (const [label, delay, slow] of [['2 ms apart', 2, 0], ['delay 0, slow view (8 ms)', 0, 8], ['5 ms apart, slow view (8 ms)', 5, 8], ['30 ms apart, slow view (40 ms)', 30, 40]]) {
    await runTest(CAT, `G-146: a controlled input keeps every key, ${label}`, async () => {
      function F({ state }) {
        const end = performance.now() + slow; while (performance.now() < end) {}
        return <div><input className="draft" value={state.draft} /><p className="echo">{state.draft}</p></div>
      }
      F.initialState = { draft: '' }
      F.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value() })
      F.model = { DRAFT: (s, draft) => ({ ...s, draft }) }
      const { el, id, app } = await start(F)
      await typeKeys(`${id} .draft`, 'Hello world, typed quickly', delay)
      await wait(100)
      const value = el.querySelector('.draft').value
      app.dispose()
      assert(value === 'Hello world, typed quickly', `input "${value}"`)
    }, 15000)
  }

  await runTest(CAT, 'G-146: inputs in Collection items keep every key, 2 ms apart', async () => {
    function Row({ state }) { return <li><input className="name" data-id={state.id} value={state.name} /></li> }
    Row.intent = ({ DOM }) => ({ NAME: DOM.input('.name').value() })
    Row.model = { NAME: (s, name) => ({ ...s, name }) }
    function Rows({ state }) { return <div><ul><Collection of={Row} from="rows" /></ul><p className="names">{state.rows.map(r => r.name).join('|')}</p></div> }
    Rows.initialState = { rows: [{ id: 'a', name: '' }, { id: 'b', name: '' }] }
    const { el, id, app } = await start(Rows)
    await typeKeys(`${id} .name[data-id="b"]`, 'quick brown fox', 2)
    await wait(50)
    const value = el.querySelector('.name[data-id="b"]').value, names = el.querySelector('.names').textContent
    app.dispose()
    assert(value === 'quick brown fox' && names === '|quick brown fox', `input "${value}", state "${names}"`)
  }, 10000)

  await runTest(CAT, 'G-146: value={null} still clears and a model rewrite still lands', async () => {
    function U({ state }) { return <div><input className="u" value={state.v} /><button className="clear">c</button></div> }
    U.initialState = { v: '' }
    U.intent = ({ DOM }) => ({ V: DOM.input('.u').value(), CLEAR: DOM.click('.clear') })
    U.model = { V: (s, v) => ({ ...s, v: v.toUpperCase().slice(0, 5) }), CLEAR: (s) => ({ ...s, v: null }) }
    const { el, id, app } = await start(U)
    await typeKeys(`${id} .u`, 'abcdefgh')
    await wait(50)
    const typed = el.querySelector('.u').value
    el.querySelector('.clear').click(); await wait(50)
    const cleared = el.querySelector('.u').value
    app.dispose()
    assert(typed === 'ABCDE' && cleared === '', `typed "${typed}", cleared "${cleared}"`)
  }, 10000)
}
