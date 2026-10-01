// Regression tests for PLAN-1 workstream 1H (Phase 1 close-review fixes), real DOM.
import { run } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Bug fixes (1H)'

export async function bugfixTests1H() {
  // #1: non-STATE sinks run synchronously with the event when no STATE reducer is pending,
  // so EFFECT can call preventDefault() / use dataTransfer on the live event.
  await runTest(CAT, '1H-1: EFFECT preventDefault() on a real click (root with initialState)', async () => {
    const { id, el } = mount()
    function App({ state }) {
      return <div><a className="link" href="#nowhere">go</a><span className="n">{state.n}</span></div>
    }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.link') })
    App.model = { GO: { EFFECT: (_s, e) => e.preventDefault(), STATE: s => ({ ...s, n: s.n + 1 }) } }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.link'))
    await wait(20)
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.querySelector('.link').dispatchEvent(ev)
    assert(ev.defaultPrevented === true, 'preventDefault() inside EFFECT did not affect the event')
    await waitFor(() => el.querySelector('.n').textContent === '1')
  })

  await runTest(CAT, '1H-1: EFFECT preventDefault() and dataTransfer.setData() in a sub-component', async () => {
    const { id, el } = mount()
    function Card({ state }) {
      return <div className="card" draggable="true">{state.title}</div>
    }
    Card.intent = ({ DOM }) => ({ DRAG: DOM.select('.card').events('dragstart'), CTX: DOM.select('.card').events('contextmenu') })
    Card.model = {
      DRAG: { EFFECT: (s, e) => e.dataTransfer.setData('text/plain', s.title) },
      CTX: { EFFECT: (_s, e) => e.preventDefault() },
    }
    function App() { return <div><Card state="card" /></div> }
    App.initialState = { card: { title: 'task-7' } }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.card'))
    await wait(20)
    const dt = new DataTransfer()
    el.querySelector('.card').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    assert(dt.getData('text/plain') === 'task-7', `dataTransfer had '${dt.getData('text/plain')}'`)
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.querySelector('.card').dispatchEvent(ev)
    assert(ev.defaultPrevented === true, 'preventDefault() inside a sub-component EFFECT did not affect the event')
  })

  await runTest(CAT, '1H-1: a custom sink function also runs synchronously; B-003 still holds for same-tick actions', async () => {
    const { id, el } = mount()
    const seen = []
    // the driver gets sink values in a microtask (Cycle's sink replication); the sink function
    // itself must run synchronously with the event
    const spy = (sink$) => { sink$.addListener({ next: () => {} }); return {} }
    function App({ state }) {
      return <div><input className="draft" value={state.draft} /><button className="save">Save</button><span className="saved">{state.saved}</span></div>
    }
    App.initialState = { draft: '', saved: '' }
    App.intent = ({ DOM }) => ({ EDIT: DOM.input('.draft').value(), SAVE: DOM.click('.save') })
    App.model = {
      EDIT: (s, draft) => ({ ...s, draft }),
      SAVE: { STATE: s => ({ ...s, saved: s.draft }), SPY: s => { seen.push(s.draft); return s.draft } },
    }
    run(App, { SPY: spy }, { mountPoint: id })
    await waitFor(() => el.querySelector('.save'))
    await wait(20)
    el.querySelector('.save').click()
    assert(JSON.stringify(seen) === '[""]', `SPY not synchronous: ${JSON.stringify(seen)}`)
    await wait(20)
    const inp = el.querySelector('.draft')
    inp.value = 'abc'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    el.querySelector('.save').click()
    await waitFor(() => el.querySelector('.saved').textContent === 'abc')
    assert(JSON.stringify(seen) === '["","abc"]', `SPY saw ${JSON.stringify(seen)}`)
  })

  // #7: the controlled-input module only controls form fields
  await runTest(CAT, '1H-7: re-rendering <input type=file> and <progress value> does not throw or reset them', async () => {
    const { id, el } = mount()
    const errors = []
    const onErr = e => errors.push(e.message)
    window.addEventListener('error', onErr)
    function App({ state }) {
      return <div>
        <input className="file" type="file" value="" />
        <progress className="p" value={state.p} max="10" />
        <button className="tick">{state.n}</button>
      </div>
    }
    App.initialState = { n: 0, p: 3 }
    App.intent = ({ DOM }) => ({ TICK: DOM.click('.tick') })
    App.model = { TICK: s => ({ ...s, n: s.n + 1 }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.tick'))
    el.querySelector('.p').value = 7
    el.querySelector('.tick').click()
    await waitFor(() => el.querySelector('.tick').textContent === '1')
    await wait(20)
    window.removeEventListener('error', onErr)
    assert(errors.length === 0, `errors: ${errors.join('; ')}`)
    assert(el.querySelector('.p').value === 7, `progress value was reset to ${el.querySelector('.p').value}`)
  })
}
