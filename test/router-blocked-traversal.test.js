// @vitest-environment jsdom
// A blocked back/forward whose proceed the blocker sends at once (found by the wizard spike): the
// router replied before undoing the traversal, so the proceed and the undo were two history.go()
// calls in one task and Chromium dropped one (the fake history drops it too); a forced go() the
// browser dropped left the next traversal unguarded.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter } from '../src/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))

describe('router: a blocked back/forward whose proceed is sent at once', () => {
  const router = makeRouter({ routes: { a: '/a', b: '/b', notFound: '*' } })
  function App({ state }) { return h('p', null, state.route.name) }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/a') }
  App.intent = ({ DOM }) => ({ ARM: DOM.click('p') })
  App.model = {
    ROUTE: (s, route) => ({ ...s, route }),
    ARM: { ROUTER: () => ({ block: 'ASK' }) },
    ASK: { ROUTER: (_s, attempt) => (asks++, { ...attempt.proceed, block: 'ASK' }) },
  }
  let asks = 0

  it('lands where the traversal was going', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/a' })
    await t.ready()
    await t.navigate('/b'); await tick()
    t.query('p').click(); await tick()
    await t.back(); await tick(40)
    expect(t.location.path).toBe('/a')
    expect(t.state.route.name).toBe('a')
    // the next traversal is still guarded (nothing forced is left over): ASK again, then made
    asks = 0
    await t.forward(); await tick(40)
    expect(asks).toBe(1)
    expect(t.location.path).toBe('/b')
  })
})

