import { run, Slot } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Slots'

export async function slotTests() {
  // Named slot renders in correct location
  await runTest(CAT, 'Named slot content renders in correct location', async () => {
    const { id, el } = mount()
    function Card({ state, slots } = {}) {
      return <div className="card">
        <header className="card-header">{...(slots.header || [])}</header>
        <main className="card-body">{...(slots.default || [])}</main>
      </div>
    }
    function App({ state } = {}) {
      return <div>
        <Card state="card">
          <Slot name="header"><h2 className="title">Card Title</h2></Slot>
          <p className="body-text">Body content</p>
        </Card>
      </div>
    }
    App.initialState = { card: {} }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.title'))
    assert(
      el.querySelector('.card-header .title')?.textContent === 'Card Title',
      'Header slot content should be inside card-header'
    )
    assert(
      el.querySelector('.card-body .body-text')?.textContent === 'Body content',
      'Default slot content should be inside card-body'
    )
  })

  // Multiple named slots
  await runTest(CAT, 'Multiple named slots distribute correctly', async () => {
    const { id, el } = mount()
    function Layout({ state, slots } = {}) {
      return <div className="layout">
        <nav className="layout-nav">{...(slots.nav || [])}</nav>
        <main className="layout-main">{...(slots.default || [])}</main>
        <footer className="layout-footer">{...(slots.footer || [])}</footer>
      </div>
    }
    function App({ state } = {}) {
      return <div>
        <Layout state="layout">
          <Slot name="nav"><a className="nav-link">Home</a></Slot>
          <Slot name="footer"><span className="copyright">2026</span></Slot>
          <p className="main-content">Main</p>
        </Layout>
      </div>
    }
    App.initialState = { layout: {} }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.nav-link'))
    assert(el.querySelector('.layout-nav .nav-link')?.textContent === 'Home', 'Nav slot')
    assert(el.querySelector('.layout-footer .copyright')?.textContent === '2026', 'Footer slot')
    assert(el.querySelector('.layout-main .main-content')?.textContent === 'Main', 'Default slot')
  })

  // Multiple children in one named slot
  await runTest(CAT, 'Multiple children in a single named slot', async () => {
    const { id, el } = mount()
    function Toolbar({ state, slots } = {}) {
      return <div className="toolbar">{...(slots.actions || [])}</div>
    }
    function App({ state } = {}) {
      return <div>
        <Toolbar state="toolbar">
          <Slot name="actions">
            <button className="btn-save">Save</button>
            <button className="btn-cancel">Cancel</button>
          </Slot>
        </Toolbar>
      </div>
    }
    App.initialState = { toolbar: {} }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.btn-save'))
    assert(el.querySelector('.toolbar .btn-save')?.textContent === 'Save', 'First action button')
    assert(el.querySelector('.toolbar .btn-cancel')?.textContent === 'Cancel', 'Second action button')
  })

  // Backward compatibility: no slots, just children
  await runTest(CAT, 'Components without Slot tags receive children normally', async () => {
    const { id, el } = mount()
    function Wrapper({ state, children } = {}) {
      return <div className="wrapper">{...children}</div>
    }
    function App({ state } = {}) {
      return <div>
        <Wrapper state="w">
          <span className="plain-child">Hello</span>
        </Wrapper>
      </div>
    }
    App.initialState = { w: {} }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.plain-child'))
    assert(
      el.querySelector('.wrapper .plain-child')?.textContent === 'Hello',
      'Plain children should render inside wrapper'
    )
  })

  // Slot with no name goes to default
  await runTest(CAT, 'Slot without name contributes to default slot', async () => {
    const { id, el } = mount()
    function Box({ state, slots } = {}) {
      return <div className="box">{...(slots.default || [])}</div>
    }
    function App({ state } = {}) {
      return <div>
        <Box state="box">
          <Slot><em className="emphasized">Emphasis</em></Slot>
        </Box>
      </div>
    }
    App.initialState = { box: {} }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.emphasized'))
    assert(
      el.querySelector('.box .emphasized')?.textContent === 'Emphasis',
      'Unnamed Slot content should be in default slot'
    )
  })

  // Slot content updates when parent state changes
  await runTest(CAT, 'Slot content updates reactively with parent state', async () => {
    const { id, el } = mount()
    function Display({ state, slots } = {}) {
      return <div className="display">
        <div className="display-header">{...(slots.header || [])}</div>
      </div>
    }
    function App({ state } = {}) {
      return <div>
        <button className="toggle-btn">Toggle</button>
        <Display state="d">
          <Slot name="header">
            <span className="dynamic">{state.label}</span>
          </Slot>
        </Display>
      </div>
    }
    App.initialState = { label: 'Before', d: {} }
    App.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle-btn') })
    App.model = { TOGGLE: (state) => ({ ...state, label: state.label === 'Before' ? 'After' : 'Before' }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.dynamic')?.textContent === 'Before')
    el.querySelector('.toggle-btn').click()
    await waitFor(() => el.querySelector('.dynamic')?.textContent === 'After')
  })
}
