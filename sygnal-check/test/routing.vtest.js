/**
 * PLAN-3 1-D: routed requests in the static checker. SYG102 counts ok/error (and
 * `connections`) names as triggers, SYG112 flags a routed name with no model entry,
 * strict SYG508 flags the select()/errors() round trip, HYDRATE is an ordinary action,
 * and --graph reports the 'routed' trigger. (Fixture expectations: fixtures.vtest.js,
 * strict.vtest.js.)
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { check, graph } from '../src/index.js'

let dir
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null })

/** check() one source string (written to a temp .jsx file) */
function checkSource(source, opts = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-routing-'))
  const file = path.join(dir, 'App.jsx')
  fs.writeFileSync(file, source)
  return { diags: check([file], { cwd: dir, ...opts }), file }
}
const codes = (diags, code) => diags.filter(d => d.code === code)

const quote = (http, extra = '') => `
function Quote({ state }) { return <button className="load">{state.status}</button> }
Quote.initialState = { status: 'idle' }
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
Quote.model = {
  LOAD: { HTTP: ${http} },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),
  FAILED: (state) => ({ ...state, status: 'error' }),${extra}
}
`

describe('SYG102: routed names are triggers', () => {
  it('ok/error string literals in a request trigger their actions', () => {
    const { diags } = checkSource(quote(`(state) => ({ url: '/q', ok: 'LOADED', error: 'FAILED' })`))
    expect(diags).toEqual([])
  })

  it('block bodies, conditionals and module-level request builders count too', () => {
    const { diags } = checkSource(`
const req = (state) => state.id ? { url: '/q/' + state.id, ok: 'LOADED' } : { url: '/q', error: 'FAILED' }
` + quote('req'))
    expect(diags).toEqual([])
  })

  it('a request built with a non-literal name downgrades SYG102 to info', () => {
    const { diags } = checkSource(`const OK = 'LOADED'\n` + quote(`(state) => ({ url: '/q', ok: OK })`))
    const found = codes(diags, 'SYG102')
    expect(found.map(d => [d.data.action, d.severity]).sort()).toEqual([['FAILED', 'info'], ['LOADED', 'info']])
    expect(found[0].message).toMatch(/non-literal ok\/error/)
  })

  it('ok/error values returned to STATE or EVENTS are not triggers', () => {
    const { diags } = checkSource(quote(`(state) => ({ url: '/q' })`, `
  RESET: { STATE: (state) => ({ ...state, ok: 'DONE' }), EVENTS: () => ({ type: 'X', ok: 'DONE' }) },
  DONE: (state) => state,`))
    expect(codes(diags, 'SYG102').map(d => d.data.action).sort()).toEqual(['DONE', 'FAILED', 'LOADED', 'RESET'])
    expect(codes(diags, 'SYG112')).toEqual([])
  })
})

describe('SYG112: routed action with no model entry', () => {
  it('is an error that names the closest model key', () => {
    const { diags } = checkSource(quote(`(state) => ({ url: '/q', ok: 'LAODED', error: 'FAILED' })`))
    const [d] = codes(diags, 'SYG112')
    expect(d.severity).toBe('error')
    expect(d.component).toBe('Quote')
    expect(d.data).toEqual({ action: 'LAODED', key: 'ok', suggestion: 'LOADED' })
    expect(d.message).toContain("did you mean 'LOADED'?")
    expect(d.fix).toContain("ok: 'LOADED'")
    // the misspelt request leaves LOADED untriggered
    expect(codes(diags, 'SYG102').map(d => d.data.action)).toEqual(['LOADED'])
  })

  it('a case slip is a typo too', () => {
    const { diags } = checkSource(quote(`(state) => ({ url: '/q', ok: 'Loaded', error: 'FAILED' })`))
    expect(codes(diags, 'SYG112')[0].data.suggestion).toBe('LOADED')
  })

  it('an action-like name with no near model key asks for a model entry', () => {
    const { diags } = checkSource(quote(`(state) => ({ url: '/q', ok: 'LOADED', error: 'NOT_FOUND_AT_ALL' })`))
    const [d] = codes(diags, 'SYG112')
    expect(d.data.suggestion).toBeUndefined()
    expect(d.fix).toContain('NOT_FOUND_AT_ALL: (state, data) =>')
  })

  it('free-text error fields (not action-like, not near a key) are data', () => {
    const { diags } = checkSource(quote(`(state) => ({ url: '/q', ok: 'LOADED', error: 'FAILED' })`, `
  LOG_IT: { LOG: () => ({ level: 'warn', error: 'Something went wrong' }) },`))
    expect(codes(diags, 'SYG112')).toEqual([])
  })

  it('shorthand keys and object methods are read', () => {
    const { diags } = checkSource(`
function A() { return <button className="go">go</button> }
A.intent = ({ DOM }) => ({ GO: DOM.click('.go'), STOP: DOM.click('.go') })
A.model = {
  'GO | HTTP': () => ({ url: '/a', ok: 'DOEN' }),
  STOP: { API(state) { return { ok: 'DONE_TOO' } } },
  DONE: (s) => s,
}
`)
    expect(codes(diags, 'SYG112').map(d => d.data.action).sort()).toEqual(['DOEN', 'DONE_TOO'])
  })

  it('connections names (message/open/close/error) are checked', () => {
    const { diags } = checkSource(`
function Chat({ state }) { return <ul className="m">{state.n}</ul> }
Chat.connections = (state) => ({ room: { socket: '/ws', message: 'RECIEVED', error: 'SOCKET_ERROR' } })
Chat.model = { RECEIVED: (s) => s, SOCKET_ERROR: (s) => s }
`)
    const found = codes(diags, 'SYG112')
    expect(found).toHaveLength(1)
    expect(found[0].data).toEqual({ action: 'RECIEVED', key: 'message', suggestion: 'RECEIVED' })
    expect(codes(diags, 'SYG102').map(d => d.data.action)).toEqual(['RECEIVED'])
  })
})

describe('HYDRATE is an ordinary action (D66)', () => {
  it('a HYDRATE entry nothing triggers is SYG102', () => {
    const { diags } = checkSource(`
function A({ state }) { return <p>{state.x}</p> }
A.model = { HYDRATE: (state, data) => ({ ...state, ...data }) }
`)
    expect(codes(diags, 'SYG102').map(d => d.data.action)).toEqual(['HYDRATE'])
  })

  it('an intent HYDRATE action without a model entry is SYG101', () => {
    const { diags } = checkSource(`
function A() { return <button className="h">h</button> }
A.intent = ({ DOM }) => ({ HYDRATE: DOM.click('.h') })
A.model = {}
`)
    expect(codes(diags, 'SYG101').map(d => d.data.action)).toEqual(['HYDRATE'])
  })

  it('--graph no longer calls HYDRATE built in', () => {
    const { file } = checkSource(`
function A({ state }) { return <p>{state.x}</p> }
A.model = { HYDRATE: (state, data) => ({ ...state, ...data }), INITIALIZE: (s) => s }
`)
    const actions = Object.fromEntries(graph([file], { cwd: dir }).components[0].actions.map(a => [a.name, a.trigger]))
    expect(actions).toEqual({ HYDRATE: 'unknown', INITIALIZE: 'builtin' })
  })
})

describe('--graph: routed trigger', () => {
  it('actions named by a request or a connection are routed', () => {
    const { file } = checkSource(quote(`(state) => ({ url: '/q', ok: 'LOADED', error: 'FAILED' })`))
    const actions = Object.fromEntries(graph([file], { cwd: dir }).components[0].actions.map(a => [a.name, a.trigger]))
    expect(actions).toEqual({ LOAD: 'intent', LOADED: 'routed', FAILED: 'routed' })
  })
})

describe('SYG508 (strict): select()/errors() round trip', () => {
  const roundTrip = (drivers = '') => `
import { run, makeFetchDriver, driverFromAsync } from 'sygnal'
function Search({ state }) { return <input className="q" value={state.q} /> }
Search.initialState = { q: '', results: [] }
Search.intent = ({ DOM, HTTP }) => ({
  SEARCH:  DOM.input('.q').value(),
  RESULTS: HTTP.select('search'),
  FAILED:  HTTP.errors('search'),
})
Search.model = {
  SEARCH: {
    STATE: (state, q) => ({ ...state, q }),
    HTTP: (state, q) => ({ category: 'search', url: '/api/search', query: { q }, latest: true }),
  },
  RESULTS: (state, { value }) => ({ ...state, results: value }),
  FAILED: (state) => ({ ...state, results: [] }),
}
${drivers}`

  it('flags both calls with the routed before/after, using the intent action names', () => {
    const { diags } = checkSource(roundTrip(), { strict: true })
    const found = codes(diags, 'SYG508')
    expect(found.map(d => d.data.method)).toEqual(['select', 'errors'])
    expect(found[0].severity).toBe('warn')
    expect(found[0].data).toMatchObject({ source: 'HTTP', category: 'search', sender: 'SEARCH', ok: 'RESULTS', error: 'FAILED' })
    expect(found[0].fix).toContain("before `SEARCH: { HTTP: (state) => ({ category: 'search', … }) }` + `RESULTS: HTTP.select('search')`")
    expect(found[0].fix).toContain("after `SEARCH: { HTTP: (state) => ({ …, ok: 'RESULTS', error: 'FAILED' }) }`")
  })

  it('is strict only', () => {
    expect(codes(checkSource(roundTrip()).diags, 'SYG508')).toEqual([])
  })

  it('leaves HTTP alone when it is registered as another driver (e.g. @cycle/http)', () => {
    const { diags } = checkSource(roundTrip(`run(Search, { HTTP: makeHTTPDriver() })`), { strict: true })
    expect(codes(diags, 'SYG508')).toEqual([])
  })

  it('does not flag a request that is already routed, an abort, or a category the component never sends', () => {
    const { diags } = checkSource(`
function A({ state }) { return <button className="go">{state.n}</button> }
A.initialState = { n: 0 }
A.intent = ({ DOM, HTTP }) => ({
  GO: DOM.click('.go'),
  STOP: DOM.click('.go'),
  OTHER: HTTP.select('other'),
  MINE: HTTP.select('mine'),
})
A.model = {
  GO: { HTTP: () => ({ category: 'mine', url: '/a', ok: 'MINE' }) },
  STOP: { HTTP: () => ({ category: 'other', abort: true }) },
  OTHER: (s) => s,
  MINE: (s) => s,
}
`, { strict: true })
    expect(codes(diags, 'SYG508')).toEqual([])
  })
})
