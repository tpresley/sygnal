// PLAN-4 3-B (GS-5): persist() in a real browser: the root restores from localStorage before its
// first render, saves the picked keys (flushed on dispose and on pagehide), PERSIST: { clear }
// removes the entry, and with hydrate: true the first render keeps the server-rendered HTML and
// RESTORE follows.
import { run, renderToString, controls, persist } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Persist (PLAN-4 3-B)'
const KEY = 'sygnal-browser-persist'

const { Add, Clear } = controls({ Add: 'button', Clear: 'button' })

function Notes({ state }) {
  return <div><ul>{state.notes.map(n => <li>{n}</li>)}</ul><p className="draft">{state.draft}</p><Add>Add</Add><Clear>Clear</Clear></div>
}
Notes.initialState = { notes: [], draft: 'scratch' }
Notes.intent = ({ DOM }) => ({ ADD: DOM.click(Add), CLEAR: DOM.click(Clear) })
Notes.model = {
  ADD: (s) => ({ ...s, notes: [...s.notes, 'n' + (s.notes.length + 1)] }),
  CLEAR: { STATE: (s) => ({ ...s, notes: [] }), PERSIST: { clear: true } },
}
Notes.persist = persist({ key: KEY, pick: ['notes'], debounceMs: 5000 })

const stored = () => JSON.parse(localStorage.getItem(KEY) || 'null')

export async function persistTests3B() {
  await runTest(CAT, 'restores before the first render, saves on pagehide and dispose, clears', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, state: { notes: ['saved'], draft: 'not picked' } }))
    const { id, el } = mount()
    const texts = []
    const observer = new MutationObserver(() => texts.push(el.querySelector('ul')?.textContent))
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    let app = run(Notes, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('li'), 2000)
      assert(el.querySelector('ul').textContent === 'saved', 'the stored note is in the first render')
      assert(!texts.some(t => t === ''), `no empty list was rendered first (${JSON.stringify(texts)})`)
      assert(el.querySelector('.draft').textContent === 'scratch', 'an unpicked key keeps its initial value')
      el.querySelector('[data-control="Add"]').click()
      await waitFor(() => el.querySelectorAll('li').length === 2, 1000)
      assert(stored().state.notes.length === 1, 'not written yet (debounceMs 5000)')
      window.dispatchEvent(new Event('pagehide'))
      assert(JSON.stringify(stored()) === JSON.stringify({ version: 1, state: { notes: ['saved', 'n2'] } }), `pagehide flushes: ${localStorage.getItem(KEY)}`)
      el.querySelector('[data-control="Add"]').click()
      await waitFor(() => el.querySelectorAll('li').length === 3, 1000)
      app.dispose()
      assert(stored().state.notes.length === 3, 'dispose flushes')
      const { id: id2, el: el2 } = mount()
      app = run(Notes, {}, { mountPoint: id2 })
      await waitFor(() => el2.querySelectorAll('li').length === 3, 2000)
      el2.querySelector('[data-control="Clear"]').click()
      await waitFor(() => el2.querySelectorAll('li').length === 0, 1000)
      await wait(30)
      assert(localStorage.getItem(KEY) === null, 'PERSIST: { clear: true } removed the entry')
    } finally {
      observer.disconnect()
      app.dispose()
      localStorage.removeItem(KEY)
    }
  })

  await runTest(CAT, 'hydrate: true keeps the server HTML for the first render, then RESTORE', async () => {
    const seen = []
    function Themed({ state }) { seen.push(state.theme); return <p className="theme">{state.theme}</p> }
    Themed.initialState = { theme: 'light' }
    Themed.persist = persist({ key: KEY, pick: ['theme'], hydrate: true })
    localStorage.setItem(KEY, JSON.stringify({ version: 1, state: { theme: 'dark' } }))
    const { id, el } = mount()
    el.innerHTML = renderToString(Themed, { state: { theme: 'light' } })
    seen.length = 0
    const app = run(Themed, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.theme')?.textContent === 'dark', 2000)
      assert(seen[0] === 'light', `the first render used the server state (${seen.join(' → ')})`)
      assert(seen.at(-1) === 'dark', 'RESTORE applied the stored theme')
    } finally {
      app.dispose()
      localStorage.removeItem(KEY)
    }
  })
}
