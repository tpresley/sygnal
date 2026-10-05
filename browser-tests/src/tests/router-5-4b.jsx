// PLAN-3 5-4b: makeRouter with the browser's real history: link click (no reload), back,
// scroll restoration and focus after render; makeHeadDriver sets document.title.
import { run, makeRouter, makeHeadDriver, Switchable } from 'sygnal'
import { mount, assert, runTest, waitFor, wait } from '../harness.js'

const CAT = 'Router (5-4b)'
const step = (name, pred, ms) => waitFor(pred, ms).catch(() => { throw new Error(`waitFor timeout: ${name} (path ${location.pathname}, scrollY ${window.scrollY}, title ${document.title}, focus ${document.activeElement?.tagName})`) })

export async function routerTests5_4b() {
  await runTest(CAT, 'link click, back, scroll restore, focus, document.title', async () => {
    const start = location.pathname + location.search
    const title0 = document.title
    // G-355: the test's own history entry and page height, so earlier suites don't matter.
    // - An earlier suite navigates an iframe it then removes (rendering-1a, G-095), which adds a
    //   session-history entry for that iframe; replacing the current entry (the one after it) and
    //   pushing from there, WebKit's history.back() went past it to the entry before the iframe
    //   navigation ('/', no router key, scrollRestoration 'auto': the browser's own scroll). A
    //   pushed entry is the test's own.
    // - The test mounts off-screen (left: -9999px), which adds no scrollable height: the page was
    //   tall enough only because of the results table; a spacer makes it scroll to 600 alone.
    history.pushState(null, '', '/rt')
    const spacer = document.body.appendChild(document.createElement('div'))
    spacer.style.height = '4000px'
    const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', notFound: '*' }, base: '/rt' })
    const { href } = router
    const Home = () => <div><h1 className="h">Home</h1><div style={{ height: '3000px' }}>tall</div><a className="t2" href={href('task', { id: 2 })}>two</a></div>
    const Task = ({ state }) => <div><h1 className="h">Task {state.route.params.id}</h1><div style={{ height: '3000px' }}>tall</div></div>
    function App({ state }) {
      return <main><Switchable of={{ home: Home, task: Task, notFound: Home }} current={state.route.name} /></main>
    }
    App.route = 'ROUTE'
    App.initialState = { route: router.current() }
    App.head = s => ({ title: s.route.name == 'task' ? 'Task ' + s.route.params.id : 'Home' })
    App.model = { ROUTE: (s, route) => ({ ...s, route }) }
    const { id, el } = mount()
    const marker = Math.random()
    window.__routerMarker = marker // survives only without a reload
    const app = run(App, { ROUTER: router.driver, HEAD: makeHeadDriver() }, { mountPoint: id })
    try {
      await step('1', () => el.querySelector('.t2') && document.title == 'Home')
      assert(history.state && typeof history.state.key == 'string', 'history.state has a key')
      window.scrollTo(0, 600)
      await step('2', () => window.scrollY == 600)
      el.querySelector('.t2').click()
      assert(location.pathname == '/rt/tasks/2', `pushed: ${location.pathname}`)
      await step('3', () => el.querySelector('.h')?.textContent == 'Task 2')
      assert(window.scrollY == 0, `top after push: ${window.scrollY}`)
      await step('4', () => document.activeElement?.className == 'h' && document.activeElement.textContent == 'Task 2')
      await step('5', () => document.title == 'Task 2')
      history.back()
      await step('6', () => el.querySelector('.h')?.textContent == 'Home')
      await step('7', () => window.scrollY == 600, 2000)
      assert(location.pathname == '/rt', `back: ${location.pathname}`)
      await step('8', () => document.title == 'Home')
      assert(window.__routerMarker === marker, 'no reload')
    } finally {
      app.dispose()
      await wait(10)
      spacer.remove()
      window.scrollTo(0, 0)
      history.replaceState(null, '', start)
      document.title = title0
    }
  }, 6000)
}
