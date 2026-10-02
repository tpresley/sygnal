// PLAN-2 E2: makeFetchDriver() with the browser's real fetch (a detached window.fetch would
// throw "Illegal invocation"; jsdom/Node can't catch that).
import { run, makeFetchDriver } from 'sygnal'
import { mount, assert, runTest, waitFor } from '../harness.js'

const CAT = 'Fetch driver (E2)'

export async function fetchDriverTestsE2() {
  await runTest(CAT, 'makeFetchDriver: a GET with the real fetch reaches select() as parsed JSON', async () => {
    const { id, el } = mount()
    function Quote({ state }) { return <div><button className="get">get</button><p className="q">{state.text}</p></div> }
    Quote.initialState = { text: 'none' }
    Quote.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.get'), LOADED: HTTP.select('quote'), FAILED: HTTP.errors('quote') })
    Quote.model = {
      LOAD: { HTTP: () => ({ category: 'quote', url: '/e2-quote.json', query: { v: 1 } }) },
      LOADED: (s, { value, status }) => ({ ...s, text: `${value.text} — ${value.author} (${status})` }),
      FAILED: (s, { error }) => ({ ...s, text: `failed: ${error}` }),
    }
    const app = run(Quote, { HTTP: makeFetchDriver() }, { mountPoint: id })
    await waitFor(() => el.querySelector('.get'))
    el.querySelector('.get').click()
    await waitFor(() => el.querySelector('.q').textContent !== 'none')
    const text = el.querySelector('.q').textContent
    app.dispose()
    assert(text === 'Simplicity — Dijkstra (200)', `got '${text}'`)
  })

  await runTest(CAT, 'makeFetchDriver: latest: true aborts the request in flight (real AbortController)', async () => {
    const { id, el } = mount()
    function Search({ state }) { return <div><button className="go">go</button><p className="n">{state.n}</p></div> }
    Search.initialState = { n: 0, q: 0 }
    Search.intent = ({ DOM, HTTP }) => ({ GO: DOM.click('.go'), DONE: HTTP.select('s') })
    Search.model = {
      GO: { STATE: s => ({ ...s, q: s.q + 1 }), HTTP: s => ({ category: 's', url: '/e2-quote.json', query: { q: s.q + 1 }, latest: true }) },
      DONE: (s, { request }) => ({ ...s, n: s.n + 1, last: request.query.q }),
    }
    const app = run(Search, { HTTP: makeFetchDriver() }, { mountPoint: id })
    await waitFor(() => el.querySelector('.go'))
    el.querySelector('.go').click()
    el.querySelector('.go').click()
    el.querySelector('.go').click()
    await waitFor(() => el.querySelector('.n').textContent !== '0')
    await new Promise(r => setTimeout(r, 100))
    const n = el.querySelector('.n').textContent
    app.dispose()
    assert(n === '1', `expected only the latest reply, got ${n}`)
  })
}
