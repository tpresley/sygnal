// Regression tests for PLAN-1 workstream 1F (framework bug fixes), real DOM.
import { run, Collection } from 'sygnal'
import xs from 'xstream'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Bug fixes (1F)'

const spyDriver = (out) => (sink$) => {
  sink$.addListener({ next: v => out.push(v), error: () => {}, complete: () => {} })
  return { select: () => xs.never() }
}

export async function bugfixTests() {
  // B-003: EDIT (input) and SAVE (click) dispatched in the same tick
  await runTest(CAT, 'B-003: every sink of SAVE sees the draft from a same-tick EDIT (root)', async () => {
    const { id, el } = mount()
    const spied = []
    function App({ state }) {
      return <div>
        <input className="draft" value={state.draft} />
        <button className="save">Save</button>
        <span className="saved">{state.saved}</span>
      </div>
    }
    App.initialState = { draft: '', saved: '' }
    App.intent = ({ DOM }) => ({ EDIT: DOM.input('.draft').value(), SAVE: DOM.click('.save') })
    App.model = {
      EDIT: (s, draft) => ({ ...s, draft }),
      SAVE: { STATE: s => ({ ...s, saved: s.draft }), SPY: s => s.draft.length },
    }
    run(App, { SPY: spyDriver(spied) }, { mountPoint: id })
    await waitFor(() => el.querySelector('.save'))
    const inp = el.querySelector('.draft')
    inp.value = 'hello'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    el.querySelector('.save').click()
    await waitFor(() => el.querySelector('.saved').textContent === 'hello')
    await wait(30)
    assert(JSON.stringify(spied) === '[5]', `SPY saw ${JSON.stringify(spied)}, expected [5]`)
  })

  await runTest(CAT, 'B-003: same for a sub-component that gets its state from the parent', async () => {
    const { id, el } = mount()
    const spied = []
    function Editor({ state }) {
      return <div>
        <textarea className="draft" value={state.draft} />
        <button className="save">Save</button>
      </div>
    }
    Editor.intent = ({ DOM }) => ({ EDIT: DOM.input('.draft').value(), SAVE: DOM.click('.save') })
    Editor.model = {
      EDIT: (s, draft) => ({ ...s, draft }),
      SAVE: {
        STATE: s => ({ ...s, saved: s.draft }),
        EVENTS: s => ({ type: 'SAVED', data: s.draft.split(/\s+/).filter(Boolean).length }),
      },
    }
    function App({ state }) {
      return <div><Editor /><span className="words">{state.words}</span></div>
    }
    App.initialState = { draft: '', saved: '', words: -1 }
    App.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('SAVED') })
    App.model = { GOT: (s, words) => { spied.push(words); return { ...s, words } } }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.save'))
    const ta = el.querySelector('.draft')
    ta.value = 'hello big world'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    el.querySelector('.save').click()
    await waitFor(() => el.querySelector('.words').textContent !== '-1')
    await wait(30)
    assert(JSON.stringify(spied) === '[3]', `EVENTS carried ${JSON.stringify(spied)}, expected [3]`)
  })

  // B-004: controlled input must reflect state after coalesced same-tick renders
  await runTest(CAT, 'B-004: typing then ADD in one tick clears a controlled <input value>', async () => {
    const { id, el } = mount()
    function App({ state }) {
      return <div>
        <input className="draft" value={state.draft} />
        <button className="add">Add</button>
        <ul>{state.items.map(i => <li>{i}</li>)}</ul>
      </div>
    }
    App.initialState = { draft: '', items: [] }
    App.intent = ({ DOM }) => ({ EDIT: DOM.input('.draft').value(), ADD: DOM.click('.add') })
    App.model = {
      EDIT: (s, draft) => ({ ...s, draft }),
      ADD: s => ({ ...s, items: [...s.items, s.draft], draft: '' }),
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.add'))
    const inp = el.querySelector('.draft')
    inp.value = 'milk'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    el.querySelector('.add').click()
    await waitFor(() => el.querySelectorAll('li').length === 1)
    await wait(30)
    assert(el.querySelector('li').textContent === 'milk', `item is '${el.querySelector('li').textContent}'`)
    assert(inp.value === '', `input still shows '${inp.value}'`)
  })

  // B-009: two Collections in one parent whose items share ids
  await runTest(CAT, 'B-009: clicking an item in one Collection does not fire the same-id item of another', async () => {
    const { id, el } = mount()
    function Item({ state }) { return <li><button className="hit">{state.n}</button></li> }
    Item.intent = ({ DOM }) => ({ HIT: DOM.click('.hit') })
    Item.model = { HIT: s => ({ ...s, n: s.n + 1 }) }
    function App({ state }) {
      return <div>
        <Collection of={Item} from="a" className="list-a" />
        <Collection of={Item} from="b" className="list-b" />
        <span className="sum">{state.a[0].n}/{state.b[0].n}</span>
      </div>
    }
    App.initialState = { a: [{ id: 1, n: 0 }], b: [{ id: 1, n: 0 }] }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.list-b .hit'))
    el.querySelector('.list-b .hit').click()
    await waitFor(() => el.querySelector('.sum').textContent !== '0/0')
    await wait(50)
    const sum = el.querySelector('.sum').textContent
    assert(sum === '0/1', `a/b counters are ${sum}, expected 0/1`)
    el.querySelector('.list-a .hit').click()
    await waitFor(() => el.querySelector('.sum').textContent !== '0/1')
    await wait(50)
    const sum2 = el.querySelector('.sum').textContent
    assert(sum2 === '1/1', `a/b counters are ${sum2}, expected 1/1`)
  })

  await runTest(CAT, 'B-004: a controlled checkbox reflects state after a same-tick toggle + reset', async () => {
    const { id, el } = mount()
    function App({ state }) {
      return <div>
        <input className="cb" type="checkbox" checked={state.on} />
        <button className="reset">Reset</button>
        <span className="n">{state.n}</span>
      </div>
    }
    App.initialState = { on: false, n: 0 }
    App.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.cb').checked(), RESET: DOM.click('.reset') })
    App.model = {
      TOGGLE: (s, on) => ({ ...s, on }),
      RESET: s => ({ ...s, on: false, n: s.n + 1 }),
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.reset'))
    const cb = el.querySelector('.cb')
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    el.querySelector('.reset').click()
    await waitFor(() => el.querySelector('.n').textContent === '1')
    await wait(30)
    assert(cb.checked === false, 'checkbox is still checked')
  })
}
