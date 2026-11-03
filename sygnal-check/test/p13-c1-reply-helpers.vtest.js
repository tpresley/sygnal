// PLAN-13 C-1 (#25, #43): reply action names through request helpers and consts. SYG102 counts
// them as triggers, SYG112 checks them, and --graph lists them as reply actions.
import { describe, expect, it } from 'vitest'
import { checkFiles, graph } from '../src/index.js'

const DIR = '/virtual/app'
function run(sources, fn = checkFiles) {
  const files = Object.keys(sources).map(f => `${DIR}/${f}`)
  return fn(files.filter(f => /App\.jsx$/.test(f)), { cwd: DIR, sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [`${DIR}/${k}`, v])) })
}
const codes = (d, ...cs) => d.filter(x => cs.includes(x.code)).map(x => `${x.code} ${x.data?.action}`)

const app = (http, { extra = '', model = '', head = '' } = {}) => `${head}
function App({ state }) { return <button className="load">{state.status}</button> }
App.initialState = { status: 'idle' }
App.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
App.model = {
  LOAD: { HTTP: ${http} },
  GOT: (state, v) => ({ ...state, status: 'done', v }),
  FAILED: (state) => ({ ...state, status: 'error' }),${model}
}
${extra}`

describe('C-1: reply names in a request helper call', () => {
  const helper = `const req = (url, opts) => ({ url, ...opts })\n`

  it('the options object of a local helper: triggers, so no SYG102', () => {
    expect(codes(run({ 'App.jsx': app(`(s) => req('/a', { ok: 'GOT', error: 'FAILED' })`, { head: helper }) }), 'SYG102', 'SYG112')).toEqual([])
  })

  it('a misspelled name in the options is SYG112 (and the entry it meant is SYG102)', () => {
    const d = run({ 'App.jsx': app(`(s) => req('/a', { ok: 'GOTT', error: 'FAILED' })`, { head: helper }) })
    expect(codes(d, 'SYG102', 'SYG112').sort()).toEqual(['SYG102 GOT', 'SYG112 GOTT'])
    expect(d.find(x => x.code === 'SYG112').data.suggestion).toBe('GOT')
  })

  it('a method of an imported client (api.get_run(args, { ok }))', () => {
    const d = run({
      'App.jsx': app(`(s) => api.get_run({ id: s.id }, { ok: 'GOT', error: 'FAILD' })`, { head: `import { api } from './api.js'\n` }),
      'api.js': `export const api = { get_run: (args, opts) => ({ url: '/run/' + args.id, ...opts }) }\n`,
    })
    expect(codes(d, 'SYG102', 'SYG112').sort()).toEqual(['SYG102 FAILED', 'SYG112 FAILD'])
  })

  it('an options object held in a const', () => {
    const d = run({ 'App.jsx': app(`(s) => req('/a', OPTS)`, { head: helper + `const OPTS = { ok: 'GOT', error: 'FAILED' }\n` }) })
    expect(codes(d, 'SYG102', 'SYG112')).toEqual([])
  })

  it('an object argument with no reply key is not a request (SYG508 and SYG152 see nothing new)', () => {
    const d = run({ 'App.jsx': app(`(s) => req('/a', { headers: { a: 1 } })`, { head: helper, model: `\n  OTHER: (s) => s,` }) })
    expect(codes(d, 'SYG112', 'SYG152')).toEqual([])
  })
})

describe('C-1: a request returned through a const', () => {
  it('HTTP: () => SNAP', () => {
    const head = `const SNAP = { url: '/snap', ok: 'GOT', error: 'FAILED' }\n`
    expect(codes(run({ 'App.jsx': app(`() => SNAP`, { head }) }), 'SYG102', 'SYG112')).toEqual([])
    const bad = `const SNAP = { url: '/snap', ok: 'GOT', error: 'FALED' }\n`
    expect(codes(run({ 'App.jsx': app(`() => SNAP`, { head: bad }) }), 'SYG112')).toEqual(['SYG112 FALED'])
  })

  it('--graph lists them as reply actions', () => {
    const g = run({ 'App.jsx': app(`(s) => req('/a', { ok: 'GOT', error: 'FAILED' })`, { head: `const req = (url, opts) => ({ url, ...opts })\n` }) }, graph)
    const actions = Object.fromEntries(g.components[0].actions.map(a => [a.name, a.trigger]))
    expect(actions).toEqual({ LOAD: 'intent', GOT: 'reply', FAILED: 'reply' })
  })
})

describe('C-1: connections through consts', () => {
  const chat = (connections, head = '') => `${head}
function Feed({ state }) { return <ul>{state.n}</ul> }
Feed.initialState = { n: 0 }
Feed.connections = ${connections}
Feed.model = { TICK: (s) => s, PRICE: (s) => s, HALTED: (s) => s }
`
  it('an SSE events map in a const', () => {
    const head = `const EVENTS = { 'price-update': 'PRICE', halt: 'HALTED' }\n`
    expect(codes(run({ 'App.jsx': chat(`() => ({ feed: { sse: '/events', message: 'TICK', events: EVENTS } })`, head) }), 'SYG102', 'SYG112')).toEqual([])
    const bad = `const EVENTS = { 'price-update': 'PRICE', halt: 'HALTD' }\n`
    expect(codes(run({ 'App.jsx': chat(`() => ({ feed: { sse: '/events', message: 'TICK', events: EVENTS } })`, bad) }), 'SYG102', 'SYG112').sort()).toEqual(['SYG102 HALTED', 'SYG112 HALTD'])
  })

  it('a whole spec in a const, and a returned const', () => {
    const head = `const FEED = { sse: '/events', message: 'TICK', events: { 'price-update': 'PRICE', halt: 'HALTED' } }\n`
    expect(codes(run({ 'App.jsx': chat(`() => ({ feed: FEED })`, head) }), 'SYG102', 'SYG112')).toEqual([])
    const all = head + `const CONNS = { feed: FEED }\n`
    expect(codes(run({ 'App.jsx': chat(`() => CONNS`, all) }), 'SYG102', 'SYG112')).toEqual([])
  })
})

describe('reply names through ?:, helper parameters and spreads', () => {
  const sev = (d, code, action) => d.find(x => x.code === code && x.data?.action === action)?.severity

  it('a conditional value: its literals are names (block: now ? NAME : false), no dynamic', () => {
    const d = run({ 'App.jsx': app(`(s) => s.busy ? null : { url: '/a', ok: s.fast ? 'GOT' : false, error: s.quiet || 'FAILED' }`) })
    expect(codes(d, 'SYG102', 'SYG112')).toEqual([])
    // a ROUTER block through ?:, as written in the router guide
    const r = run({ 'App.jsx': `import { ABORT } from 'sygnal'
function App({ state }) { return <button className="go">go</button> }
App.initialState = { dirty: false, now: true }
App.intent = ({ DOM }) => ({ NAV: DOM.click('.go') })
App.model = {
  NAV: { ROUTER: (state) => state.dirty ? ABORT : { block: state.now ? 'CONFIRM_LEAVE' : false } },
  CONFIRM_LEAVE: (s) => s,
  NEVER: (s) => s,
}` })
    expect(codes(r, 'SYG102')).toEqual(['SYG102 NEVER'])
    // only literals left, so the finding stays a warning
    expect(sev(r, 'SYG102', 'NEVER')).toBe('warn')
  })

  it('a misspelled literal in a branch is SYG112', () => {
    const d = run({ 'App.jsx': app(`(s) => ({ url: '/a', ok: s.fast ? 'GOTT' : 'GOT', error: 'FAILED' })`) })
    expect(codes(d, 'SYG102', 'SYG112')).toEqual(['SYG112 GOTT'])
  })

  it("a helper's parameter is bound to the call's argument (get('/x', 'GOT'))", () => {
    const head = `const get = (url, ok, error = 'FAILED') => ({ url, ok, error })\n`
    expect(codes(run({ 'App.jsx': app(`() => get('/a', 'GOT')`, { head }) }), 'SYG102', 'SYG112')).toEqual([])
    // the same helper twice in one sink, and a const string argument
    const two = run({ 'App.jsx': app(`(s) => s.x ? get('/a', 'GOT') : get('/b', NAME)`, { head: head + `const NAME = 'GOT'\n`, model: `\n  NEVER: (s) => s,` }) })
    expect(codes(two, 'SYG102', 'SYG112')).toEqual(['SYG102 NEVER'])
    expect(sev(two, 'SYG102', 'NEVER')).toBe('warn')
    const bad = run({ 'App.jsx': app(`() => get('/a', 'GOTT')`, { head }) })
    expect(codes(bad, 'SYG102', 'SYG112').sort()).toEqual(['SYG102 GOT', 'SYG112 GOTT'])
  })

  it('a spread of a helper call, a const object or a literal is followed', () => {
    const head = `const streamRequest = (s) => ({ url: '/s/' + s.id, ok: 'GOT', error: 'FAILED' })\nconst BASE = { error: 'FAILED' }\n`
    expect(codes(run({ 'App.jsx': app(`(s) => ({ ...streamRequest(s), key: 'k', latest: true })`, { head }) }), 'SYG102', 'SYG112')).toEqual([])
    expect(codes(run({ 'App.jsx': app(`(s) => ({ ...BASE, ...{ ok: 'GOT' }, url: '/a' })`, { head }) }), 'SYG102', 'SYG112')).toEqual([])
    const bad = run({ 'App.jsx': app(`(s) => ({ ...BASE, url: '/a', ok: 'GOTT' })`, { head }) })
    expect(codes(bad, 'SYG102', 'SYG112').sort()).toEqual(['SYG102 GOT', 'SYG112 GOTT'])
  })

  it('an unresolvable spread makes the entry dynamic (SYG102 is info)', () => {
    const d = run({ 'App.jsx': app(`(s) => ({ ...s.opts, url: '/a', ok: 'GOT' })`, { head: '' }) })
    expect(codes(d, 'SYG102')).toEqual(['SYG102 FAILED'])
    expect(sev(d, 'SYG102', 'FAILED')).toBe('info')
  })
})
