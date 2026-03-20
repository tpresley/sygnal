import { run } from 'sygnal'
import xs from 'xstream'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Event Handling'

export async function eventTests() {
  // Event shorthand proxy
  await runTest(CAT, 'DOM.click() shorthand works', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.n}</span><button className="btn">+</button></div>
    }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.btn') })
    App.model = { INC: (state) => ({ n: state.n + 1 }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.btn'))
    el.querySelector('.btn').click()
    await waitFor(() => el.querySelector('.val')?.textContent === '1')
  })

  // .value() enrichment
  await runTest(CAT, '.value() extracts e.target.value', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="name">{state.name}</span><input className="inp" value={state.name} /></div>
    }
    App.initialState = { name: 'init' }
    App.intent = ({ DOM }) => ({ SET: DOM.input('.inp').value() })
    App.model = { SET: (_, name) => ({ name }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.inp'))
    const inp = el.querySelector('.inp')
    inp.value = 'hello'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => el.querySelector('.name')?.textContent === 'hello')
  })

  // .value(fn) with transform
  await runTest(CAT, '.value(Number) transforms value', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{typeof state.num}:{state.num}</span><input className="inp" type="number" /></div>
    }
    App.initialState = { num: 0 }
    App.intent = ({ DOM }) => ({ SET: DOM.input('.inp').value(Number) })
    App.model = { SET: (_, num) => ({ num }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.inp'))
    const inp = el.querySelector('.inp')
    inp.value = '42'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => el.querySelector('.val')?.textContent === 'number:42')
  })

  // .checked() enrichment
  await runTest(CAT, '.checked() extracts e.target.checked', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{String(state.on)}</span><input className="cb" type="checkbox" /></div>
    }
    App.initialState = { on: false }
    App.intent = ({ DOM }) => ({ TOG: DOM.change('.cb').checked() })
    App.model = { TOG: (_, on) => ({ on }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.cb'))
    const cb = el.querySelector('.cb')
    cb.checked = true
    cb.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => el.querySelector('.val')?.textContent === 'true')
  })

  // .data() enrichment
  await runTest(CAT, '.data(name) extracts dataset property', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div>
        <span className="val">{state.selected}</span>
        <button className="item" data-id="abc">Item</button>
      </div>
    }
    App.initialState = { selected: 'none' }
    App.intent = ({ DOM }) => ({ SEL: DOM.click('.item').data('id') })
    App.model = { SEL: (_, selected) => ({ selected }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.item'))
    el.querySelector('.item').click()
    await waitFor(() => el.querySelector('.val')?.textContent === 'abc')
  })

  // .key() enrichment
  await runTest(CAT, '.key() extracts e.key', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.lastKey}</span><input className="inp" /></div>
    }
    App.initialState = { lastKey: 'none' }
    App.intent = ({ DOM }) => ({ KEY: DOM.keydown('.inp').key() })
    App.model = { KEY: (_, lastKey) => ({ lastKey }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.inp'))
    el.querySelector('.inp').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await waitFor(() => el.querySelector('.val')?.textContent === 'Enter')
  })

  // .target() enrichment
  await runTest(CAT, '.target() extracts e.target element', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.tag}</span><button className="btn">go</button></div>
    }
    App.initialState = { tag: 'none' }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.btn').target() })
    App.model = { GO: (_, target) => ({ tag: target?.tagName || 'unknown' }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.btn'))
    el.querySelector('.btn').click()
    await waitFor(() => el.querySelector('.val')?.textContent === 'BUTTON')
  })

  // Document-level events
  await runTest(CAT, 'DOM.select("document").events() captures document events', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.captured}</span></div>
    }
    App.initialState = { captured: 'no' }
    App.intent = ({ DOM }) => ({
      CAP: DOM.select('document').events('click')
        .filter(e => e.target?.closest?.('.doc-test-btn'))
    })
    App.model = { CAP: () => ({ captured: 'yes' }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.val'))
    // Create a button outside this component's mount
    const outsideBtn = document.createElement('button')
    outsideBtn.className = 'doc-test-btn'
    outsideBtn.textContent = 'Outside'
    document.body.appendChild(outsideBtn)
    outsideBtn.click()
    await waitFor(() => el.querySelector('.val')?.textContent === 'yes')
    outsideBtn.remove()
  })
}
