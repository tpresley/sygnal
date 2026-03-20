import { run, Collection, Switchable } from 'sygnal'
import xs from 'xstream'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Component Composition'

export async function compositionTests() {
  // Child component with state passing
  await runTest(CAT, 'Child component receives state slice', async () => {
    const { id, el } = mount()
    function Child({ state } = {}) {
      return <div className="child-val">{state.name}</div>
    }
    function App({ state } = {}) {
      return <div><Child state="user" /></div>
    }
    App.initialState = { user: { name: 'Alice' } }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.child-val')?.textContent === 'Alice')
  })

  // Context propagation
  await runTest(CAT, 'Context propagates to descendants', async () => {
    const { id, el } = mount()
    function Child({ state, context } = {}) {
      return <div className="ctx-val">{context.theme}</div>
    }
    function App({ state } = {}) {
      return <div><Child state="child" /></div>
    }
    App.initialState = { mode: 'dark', child: {} }
    App.context = { theme: (state) => state.mode }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.ctx-val')?.textContent === 'dark')
  })

  // EVENTS bus communication
  await runTest(CAT, 'EVENTS bus: child emits, parent receives', async () => {
    const { id, el } = mount()
    function Child({ state } = {}) {
      return <button className="child-btn">Send</button>
    }
    Child.intent = ({ DOM }) => ({ SEND: DOM.click('.child-btn') })
    Child.model = { SEND: { EVENTS: () => ({ type: 'CHILD_MSG', data: 'hello' }) } }

    function App({ state } = {}) {
      return <div><span className="msg">{state.msg}</span><Child state="c" /></div>
    }
    App.initialState = { msg: 'none', c: {} }
    App.intent = ({ DOM, EVENTS }) => ({ GOT: EVENTS.select('CHILD_MSG') })
    App.model = { GOT: (state, msg) => ({ ...state, msg }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.child-btn'))
    el.querySelector('.child-btn').click()
    await waitFor(() => el.querySelector('.msg')?.textContent === 'hello')
  })

  // PARENT/CHILD communication
  await runTest(CAT, 'PARENT/CHILD: child sends to parent via CHILD.select()', async () => {
    const { id, el } = mount()
    function Child({ state } = {}) {
      return <button className="child-send">Send to parent</button>
    }
    Child.intent = ({ DOM }) => ({ SEND: DOM.click('.child-send') })
    Child.model = { SEND: { PARENT: () => 'from-child' } }

    function App({ state } = {}) {
      return <div><span className="received">{state.received}</span><Child state="c" /></div>
    }
    App.initialState = { received: 'none', c: {} }
    App.intent = ({ CHILD }) => ({ FROM_CHILD: CHILD.select(Child) })
    App.model = { FROM_CHILD: (state, val) => ({ ...state, received: val }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.child-send'))
    el.querySelector('.child-send').click()
    await waitFor(() => el.querySelector('.received')?.textContent === 'from-child')
  })

  // Collection rendering
  await runTest(CAT, 'Collection renders items from state array', async () => {
    const { id, el } = mount()
    function Item({ state } = {}) {
      return <li className="item">{state.label}</li>
    }
    function App({ state } = {}) {
      return <div><ul><Collection of={Item} from="items" /></ul></div>
    }
    App.initialState = { items: [{ id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 3, label: 'C' }] }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelectorAll('.item').length === 3)
    const texts = Array.from(el.querySelectorAll('.item')).map(li => li.textContent)
    assert(texts.join(',') === 'A,B,C', `Expected A,B,C but got ${texts.join(',')}`)
  })

  // isolatedState guard
  await runTest(CAT, 'isolatedState: throws without flag', async () => {
    const { id, el } = mount()
    function Bad({ state } = {}) { return <div>Bad</div> }
    Bad.initialState = { x: 1 }
    function App() { return <div><Bad state="bad" /></div> }
    App.initialState = {}
    let threw = false
    try {
      run(App, {}, { mountPoint: id })
      await wait(200)
    } catch (e) {
      threw = true
    }
    // The error is caught by the error boundary, check console or data-sygnal-error
    await wait(200)
    const hasError = el.querySelector('[data-sygnal-error]') !== null || threw
    assert(hasError, 'Should error when initialState without isolatedState')
  })

  // isolatedState: works with flag
  await runTest(CAT, 'isolatedState: works with flag set', async () => {
    const { id, el } = mount()
    function Good({ state } = {}) {
      return <div className="good-val">{state.value}</div>
    }
    Good.initialState = { value: 99 }
    Good.isolatedState = true
    function App({ state } = {}) {
      return <div><Good state="good" /></div>
    }
    App.initialState = {}
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.good-val')?.textContent === '99')
  })

  // Switchable component
  await runTest(CAT, 'Switchable switches between components', async () => {
    const { id, el } = mount()
    function PageA({ state } = {}) { return <div className="page">Page A</div> }
    function PageB({ state } = {}) { return <div className="page">Page B</div> }
    function App({ state } = {}) {
      return <div>
        <button className="switch-btn">Switch</button>
        <Switchable of={{ a: PageA, b: PageB }} current={state.current} state="pageState" />
      </div>
    }
    App.initialState = { current: 'a', pageState: {} }
    App.intent = ({ DOM }) => ({ SWITCH: DOM.click('.switch-btn') })
    App.model = {
      SWITCH: (state) => ({ ...state, current: state.current === 'a' ? 'b' : 'a' }),
    }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.page')?.textContent === 'Page A')
    el.querySelector('.switch-btn').click()
    await waitFor(() => el.querySelector('.page')?.textContent === 'Page B')
    el.querySelector('.switch-btn').click()
    await waitFor(() => el.querySelector('.page')?.textContent === 'Page A')
  })
}
