// The router, BROWSER=chromium|firefox|webkit: a blocker that answers a back/forward at once with
// its `proceed` (found by the wizard spike). The router undoes the traversal first; a second
// history.go() in the same task while that is pending is dropped by Chromium, so the proceed waits
// for the undo to land, and nothing forced is left for the next traversal (asked about again).
import { run, makeRouter } from 'sygnal'
import { mountOnScreen, clearStage, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Router traversal (7.2)'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

export async function routerTraversalTests() {
  await runTest('a blocked back answered at once lands; the next traversal is still guarded', async () => {
    const start = location.pathname + location.search
    history.pushState(null, '', '/wzr/a')
    const router = makeRouter({ routes: { a: '/a', b: '/b', notFound: '*' }, base: '/wzr', scroll: false, focus: false })
    let asks = 0
    function App({ state }) { return <p className="wzr">{state.route.name}</p> }
    App.route = 'ROUTE'
    App.initialState = { route: router.current() }
    App.model = {
      ROUTE: (s, route) => ({ ...s, route }),
      ASK: { ROUTER: (_s, attempt) => (asks++, { ...attempt.proceed, block: 'ASK' }) },
      BOOTSTRAP: { ROUTER: () => ({ block: 'ASK' }) },
    }
    const { id, el } = mountOnScreen()
    const app = run(App, { ROUTER: router.driver }, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.wzr')?.textContent == 'a')
      await wait(30)
      // a link to b: asked (the block), answered at once, made
      const link = document.body.appendChild(document.createElement('a'))
      link.href = '/wzr/b'
      link.click()
      link.remove()
      await waitFor(() => asks == 1 && el.querySelector('.wzr')?.textContent == 'b', 2000)
      asks = 0
      history.back()
      await waitFor(() => asks == 1, 2000)
      await waitFor(() => location.pathname == '/wzr/a' && el.querySelector('.wzr')?.textContent == 'a', 2000)
      asks = 0
      history.forward()
      await waitFor(() => asks == 1, 2000)
      await waitFor(() => location.pathname == '/wzr/b' && el.querySelector('.wzr')?.textContent == 'b', 2000)
    } finally {
      app.dispose()
      await wait(10)
      history.replaceState(null, '', start)
    }
  }, 8000)
}
