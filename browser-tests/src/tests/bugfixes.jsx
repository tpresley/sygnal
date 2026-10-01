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
}
