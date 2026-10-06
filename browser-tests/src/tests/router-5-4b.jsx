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

  // G-555: the guard owner's initial ROUTE is part of the first flush (before the first patch),
  // not a task later, where it undid an edit made right after the first render
  await runTest(CAT, 'initial ROUTE before the first patch; an edit right after it is kept (G-555)', async () => {
    const start = location.pathname + location.search
    history.pushState(null, '', '/rt/tasks/1/edit')
    const router = makeRouter({ routes: { list: '/', edit: '/tasks/:id/edit' }, base: '/rt' })
    function App({ state }) {
      return <section><input name="title" value={state.draft ?? 'Write the report'} /><i>{String(state.routes)}</i></section>
    }
    App.route = 'ROUTE'
    App.initialState = { route: router.current(), draft: null, routes: 0 }
    App.intent = ({ DOM }) => ({ TYPE: DOM.input('input[name="title"]').value() })
    App.model = {
      ROUTE: (s, route) => ({ ...s, route, draft: null, routes: s.routes + 1 }),
      TYPE: (s, draft) => ({ ...s, draft }),
    }
    const { id, el } = mount()
    let atFirstPatch = null
    // a MutationObserver callback is a microtask: it runs before any task (a timer) does
    const mo = new MutationObserver(() => {
      const input = el.querySelector('input[name="title"]')
      if (!input || atFirstPatch != null) return
      atFirstPatch = el.querySelector('i').textContent
      input.value = 'Write the final report'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    mo.observe(el, { childList: true, subtree: true })
    const app = run(App, { ROUTER: router.driver }, { mountPoint: id })
    try {
      await waitFor(() => atFirstPatch != null)
      assert(atFirstPatch === '1', `ROUTE count at the first patch: ${atFirstPatch}`)
      await wait(50)
      const input = el.querySelector('input[name="title"]')
      assert(input.value === 'Write the final report', `field kept the edit: ${input.value}`)
      assert(app.__runtime.getState().draft === 'Write the final report', `draft: ${app.__runtime.getState().draft}`)
      assert(el.querySelector('i').textContent === '1', `one ROUTE: ${el.querySelector('i').textContent}`)
    } finally {
      mo.disconnect()
      app.dispose()
      await wait(10)
      history.replaceState(null, '', start)
    }
  }, 4000)
}
