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

  // PLAN-11 U-4: progress over the browser's real XMLHttpRequest (every engine)
  await runTest(CAT, 'progress: a multipart upload reports upload steps over XMLHttpRequest, then the reply', async () => {
    const { id, el } = mount()
    function Up({ state }) { return <div><button className="send">send</button><p className="out">{state.out}</p></div> }
    Up.initialState = { out: '', steps: [] }
    Up.intent = ({ DOM }) => ({ SEND: DOM.click('.send') })
    Up.model = {
      SEND: { HTTP: () => ({ url: '/__upload', multipart: { file: new File([new Uint8Array(3 * 1024 * 1024)], 'a.bin'), note: 'x' }, progress: 'STEP', ok: 'DONE', error: 'FAILED' }) },
      STEP: (s, p) => ({ ...s, steps: [...s.steps, [p.phase, p.fraction]] }),
      DONE: (s, body) => ({ ...s, out: `${body.type}:${body.bytes > 3 * 1024 * 1024}` }),
      FAILED: (s, { error }) => ({ ...s, out: `failed: ${error}` }),
    }
    let last
    const app = run(Up, { HTTP: makeFetchDriver() }, { mountPoint: id })
    await waitFor(() => el.querySelector('.send'))
    el.querySelector('.send').click()
    await waitFor(() => el.querySelector('.out').textContent !== '', 15000)
    last = app.__runtime.getState()
    const out = el.querySelector('.out').textContent
    app.dispose()
    const up = last.steps.filter(s => s[0] === 'upload')
    assert(out === 'multipart/form-data:true', `got '${out}'`)
    // A fast localhost upload may emit only completion. Scripted XHR tests cover intermediate steps and throttling.
    assert(up.length >= 1, `expected an upload step, got ${JSON.stringify(last.steps)}`)
    assert(up[up.length - 1][1] === 1, `the last upload step is fraction 1: ${JSON.stringify(up)}`)
    assert(last.steps.some(s => s[0] === 'download'), `a download step: ${JSON.stringify(last.steps)}`)
  })
}
