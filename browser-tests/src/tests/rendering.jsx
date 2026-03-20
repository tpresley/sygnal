import { run } from 'sygnal'
import xs from 'xstream'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Rendering'

export async function renderingTests() {
  // Conditional rendering
  await runTest(CAT, 'Conditional rendering toggles elements', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div>
        <button className="tog">Toggle</button>
        {state.show && <div className="conditional">Visible</div>}
      </div>
    }
    App.initialState = { show: false }
    App.intent = ({ DOM }) => ({ TOG: DOM.click('.tog') })
    App.model = { TOG: (state) => ({ show: !state.show }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.tog'))
    assert(!el.querySelector('.conditional'), 'Should not be visible initially')
    el.querySelector('.tog').click()
    await waitFor(() => el.querySelector('.conditional'))
    assert(el.querySelector('.conditional').textContent === 'Visible')
    el.querySelector('.tog').click()
    await waitFor(() => !el.querySelector('.conditional'))
  })

  // List rendering with map
  await runTest(CAT, 'Array.map renders list items with keys', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <ul>{state.items.map(item => <li key={item.id} className="li">{item.text}</li>)}</ul>
    }
    App.initialState = { items: [{ id: 1, text: 'X' }, { id: 2, text: 'Y' }] }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelectorAll('.li').length === 2)
    const texts = Array.from(el.querySelectorAll('.li')).map(li => li.textContent)
    assert(texts.join(',') === 'X,Y')
  })

  // Dynamic class binding
  await runTest(CAT, 'Dynamic className updates on state change', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div>
        <div className={state.active ? 'box active' : 'box'}>Box</div>
        <button className="tog">Toggle</button>
      </div>
    }
    App.initialState = { active: false }
    App.intent = ({ DOM }) => ({ TOG: DOM.click('.tog') })
    App.model = { TOG: (state) => ({ active: !state.active }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.box'))
    assert(!el.querySelector('.box').classList.contains('active'))
    el.querySelector('.tog').click()
    await waitFor(() => el.querySelector('.box.active'))
  })

  // Style binding
  await runTest(CAT, 'Inline styles update reactively', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div>
        <div className="styled" style={{ color: state.color }}>Styled</div>
        <button className="change">Change</button>
      </div>
    }
    App.initialState = { color: 'red' }
    App.intent = ({ DOM }) => ({ CHANGE: DOM.click('.change') })
    App.model = { CHANGE: () => ({ color: 'blue' }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.styled'))
    assert(el.querySelector('.styled').style.color === 'red')
    el.querySelector('.change').click()
    await waitFor(() => el.querySelector('.styled').style.color === 'blue')
  })

  // Multiple state updates in sequence
  await runTest(CAT, 'Rapid state updates apply correctly', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div><span className="val">{state.n}</span><button className="btn">+</button></div>
    }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.btn') })
    App.model = { INC: (state) => ({ n: state.n + 1 }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.btn'))
    for (let i = 0; i < 5; i++) el.querySelector('.btn').click()
    await waitFor(() => el.querySelector('.val')?.textContent === '5', 2000)
  })

  // Attribute binding
  await runTest(CAT, 'HTML attributes bind correctly', async () => {
    const { id, el } = mount()
    function App({ state } = {}) {
      return <div>
        <input className="inp" type="text" placeholder={state.ph} disabled={state.dis} />
        <button className="tog">Toggle</button>
      </div>
    }
    App.initialState = { ph: 'Enter text', dis: false }
    App.intent = ({ DOM }) => ({ TOG: DOM.click('.tog') })
    App.model = { TOG: (state) => ({ ...state, dis: !state.dis }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.inp'))
    assert(el.querySelector('.inp').placeholder === 'Enter text')
    assert(!el.querySelector('.inp').disabled)
    el.querySelector('.tog').click()
    await waitFor(() => el.querySelector('.inp').disabled === true)
  })
}
