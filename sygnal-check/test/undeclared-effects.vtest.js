// SYG265 / SYG266 (a side effect outside a declared output) and, under --strict, SYG511 (a network
// request in an EFFECT) and SYG512 (a module-level write). Research: dev-plans/research/undeclared-effects.
import { describe, expect, it } from 'vitest'
import { checkFiles, coreRules, strictRules } from '../src/index.js'

const CODES = new Set(['SYG265', 'SYG266', 'SYG511', 'SYG512', 'SYG900'])
const dir = '/virtual/app'
const run = (files, opts = {}) => {
  const sources = Object.fromEntries(Object.entries(typeof files === 'string' ? { 'App.jsx': files } : files).map(([k, v]) => [`${dir}/${k}`, v]))
  return checkFiles(Object.keys(sources), { cwd: dir, sources, strict: true, ...opts }).filter(d => CODES.has(d.code))
}
const codes = (ds) => ds.map(d => d.code)

const component = ({ view = 'return <p className="x">{state.a}</p>', statics = '', top = '' }) => `import { run, set, event } from 'sygnal'
${top}
function App({ state }) { ${view} }
App.initialState = { a: 0 }
${statics}
`
const model = (m, top = '') => component({ top, statics: `App.intent = ({ DOM }) => ({ GO: DOM.click('.x') })\nApp.model = ${m}` })
const inView = (code, top = '') => component({ view: `${code}\n  return <p className="x">{state.a}</p>`, top })

describe('what counts as an effect', () => {
  it.each([
    ["fetch('/x')", 'fetch'],
    ["window.fetch('/x')", 'fetch'],
    ["globalThis.fetch?.('/x')", 'fetch'],
    ["window['fetch']('/x')", 'fetch'],
    ["globalThis['fe' + 'tch']('/x')", 'fetch'],
    ["fetch.call(null, '/x')", 'fetch'],
    ["new XMLHttpRequest()", 'XMLHttpRequest'],
    ["navigator.sendBeacon('/x', 'y')", 'navigator.sendBeacon'],
    ["new WebSocket('wss://x')", 'WebSocket'],
    ["new EventSource('/x')", 'EventSource'],
    ["new Image().src = '/x?y'", 'Image'],
    ["import('https://cdn.example/x.js')", "import('https://cdn.example/x.js')"],
    ['import(state.url)', 'import() of a computed URL'],
  ])('network: %s', (code, name) => {
    const ds = run(inView(code))
    expect(ds[0]).toMatchObject({ code: 'SYG265', severity: 'error', data: { place: 'view', kind: 'network' } })
    expect(ds[0].data.effects).toContain(name)
  })

  it.each([
    ["localStorage.setItem('a', '1')", 'storage'],
    ["sessionStorage.removeItem('a')", 'storage'],
    ['localStorage.x = 1', 'storage'],
    ["indexedDB.open('d')", 'storage'],
    ["document.cookie = 'a=1'", 'storage'],
    ["location.href = '/x'", 'navigation'],
    ["window.location = '/x'", 'navigation'],
    ["location.assign('/x')", 'navigation'],
    ["history.pushState({}, '', '/x')", 'navigation'],
    ["window.open('/x')", 'navigation'],
    ['setTimeout(() => {}, 1)', 'timer'],
    ['setInterval(() => {}, 1)', 'timer'],
    ['requestAnimationFrame(() => {})', 'timer'],
    ['queueMicrotask(() => {})', 'timer'],
    ["window.parent.postMessage('x', '*')", 'message'],
    ["new BroadcastChannel('c')", 'message'],
    ["document.title = 'x'", 'dom'],
    ["document.body.classList.add('x')", 'dom'],
    ["document.getElementById('a').textContent = 'x'", 'dom'],
    ["document.querySelector('.a').focus()", 'dom'],
    ["window.addEventListener('resize', () => {})", 'dom'],
    ["addEventListener('resize', () => {})", 'dom'],
    ['window.scrollTo(0, 0)', 'dom'],
    ['window.__leak = state', 'dom'],
    ["navigator.clipboard.writeText('x')", 'device'],
    ["eval('1')", 'dynamic'],
    ["new Function('return 1')()", 'dynamic'],
    ["globalThis[state.name]('x')", 'dynamic'],
  ])('SYG266: %s', (code, kind) => {
    expect(run(inView(code))[0]).toMatchObject({ code: 'SYG266', severity: 'warn', data: { kind } })
  })

  it('aliases: a const, a destructured method, a module-level binding, an imported one, bind', () => {
    expect(codes(run(inView("const f = fetch; f('/x')")))).toEqual(['SYG265'])
    expect(codes(run(inView("const { sendBeacon: b } = navigator; b('/x')")))).toEqual(['SYG265'])
    expect(codes(run(inView("f('/x')", 'const f = window.fetch')))).toEqual(['SYG265'])
    expect(codes(run(inView("const f = fetch.bind(window); f('/x')")))).toEqual(['SYG265'])
    expect(codes(run({ 'App.jsx': inView("f('/x')", "import { f } from './net.js'"), 'net.js': 'export const f = globalThis.fetch\n' }))).toEqual(['SYG265'])
  })

  it('handing the function over is the same as calling it', () => {
    expect(codes(run(inView("['/a'].forEach(fetch)")))).toEqual(['SYG265'])
    expect(codes(run(inView('const r = wrap(setTimeout)', 'const wrap = (f) => f')))).toEqual(['SYG266'])
  })

  it('a package on the list counts; others do not', () => {
    expect(codes(run(inView("axios.post('/x')", "import axios from 'axios'")))).toEqual(['SYG265'])
    expect(codes(run(inView("Cookies.set('a', 1)", "import Cookies from 'js-cookie'")))).toEqual(['SYG266'])
    expect(run(inView('_.sum([1])', "import _ from 'lodash'"))).toEqual([])
  })

  it('not effects: reads, console, a local binding, typeof, detached elements, relative import()', () => {
    for (const code of [
      'const h = location.href', "const v = localStorage.getItem('a')", "console.log('x')", 'console.warn(state)',
      "function fetch(u) { return u }\n fetch('/x')", "if (typeof fetch === 'undefined') return null",
      "const c = document.createElement('canvas').getContext('2d'); c.font = '1px x'", "const el = document.querySelector('.a')",
      "const m = import('./x.js')", 'const p = import(`./pages/${state.a}.js`)',
      'state.open()', 'const t = Date.now()', "const a = []; a.push(1)", 'const o = {}; o.x = 1',
    ]) expect(run(inView(code)), code).toEqual([])
  })
})

describe('where effects may not appear', () => {
  const FETCH = "fetch('/x')"
  it.each([
    ['a STATE reducer (shorthand)', model(`{ GO: (s) => { ${FETCH}; return s } }`), 'state'],
    ['a STATE reducer (object form)', model(`{ GO: { STATE: (s) => { ${FETCH}; return s } } }`), 'state'],
    ['set(fn)', model(`{ GO: { STATE: set((s) => { ${FETCH}; return { a: 1 } }) } }`), 'state'],
    ['an HTTP handler', model(`{ GO: { HTTP: (s) => { ${FETCH}; return { url: '/y' } } } }`), 'sink'],
    ["event()'s payload", model(`{ GO: { EVENTS: event('T', (s) => { ${FETCH}; return 1 }) } }`), 'sink'],
    ['a resolved handler', model('{ GO: { STATE: h } }', `const h = (s) => { ${FETCH}; return s }`), 'state'],
    ['a spread of entries', model('{ ...more }', `const more = { GO: (s) => { ${FETCH}; return s } }`), 'state'],
    ['calculated', component({ statics: `App.calculated = { b: (s) => { ${FETCH}; return 1 } }` }), 'calculated'],
    ['context', component({ statics: `App.context = { b: (s) => { ${FETCH}; return 1 } }` }), 'context'],
    ['resources', component({ statics: `App.resources = { b: (s) => { ${FETCH}; return { url: '/y' } } }` }), 'static'],
    ['timers', component({ statics: `App.timers = (s) => { ${FETCH}; return {} }` }), 'static'],
    ['connections', component({ statics: `App.connections = (s) => { ${FETCH}; return {} }` }), 'static'],
    ['head', component({ statics: `App.head = (s) => { ${FETCH}; return {} }` }), 'static'],
    ['an intent', component({ statics: `App.intent = ({ DOM }) => { ${FETCH}; return { GO: DOM.click('.x') } }\nApp.model = { GO: (s) => s }` }), 'intent'],
    ['an intent callback', component({ statics: `App.intent = ({ DOM }) => ({ GO: DOM.click('.x').map((e) => { ${FETCH}; return 1 }) })\nApp.model = { GO: (s) => s }` }), 'intent'],
    ['a callback in a view', inView(`[1].forEach(() => ${FETCH})`), 'view'],
    ['a callback to a widget', component({ top: 'const W = (p) => null', view: `return <W onReady={() => ${FETCH}} />` }), 'view'],
  ])('%s', (_, src, place) => {
    expect(run(src)[0]).toMatchObject({ code: 'SYG265', data: { place } })
  })

  it('a view run() is given with no statics', () => {
    expect(run(`import { run } from 'sygnal'\nfunction App() { ${FETCH}; return <p>x</p> }\nrun(App)\n`)[0]).toMatchObject({ code: 'SYG265', data: { place: 'view' } })
  })

  it('a component file at import time: outward kinds only', () => {
    expect(run(component({ top: FETCH }))[0]).toMatchObject({ code: 'SYG265', data: { place: 'module' } })
    expect(codes(run(component({ top: "localStorage.setItem('a', '1')" })))).toEqual(['SYG266'])
    expect(run(component({ top: "document.addEventListener('x', () => {})\nwindow.__ready = true" }))).toEqual([])
    expect(run(`fetch('/x')\nexport const a = 1\n`)).toEqual([]) // not a component file
    expect(codes(run(component({ top: `(() => { ${FETCH} })()` })))).toEqual(['SYG265'])
  })

  it('not model handlers: an unrelated module function, a driver', () => {
    expect(run(component({ top: `function save() { ${FETCH} }\nexport const driver = () => save` }))).toEqual([])
  })

  it('reports each place once', () => {
    expect(run(model(`{ GO: { STATE: (s) => { ${FETCH}; ${FETCH}; return s } } }`))).toHaveLength(2)
  })
})

describe('following helpers', () => {
  const helper = 'export function track(x) { fetch("/x", { body: x }) }\n'
  it('through a relative import, at the call, with the effect as related', () => {
    const ds = run({ 'App.jsx': model('{ GO: (s) => { track(s.a); return s } }', "import { track } from './h.js'"), 'h.js': helper })
    expect(ds).toHaveLength(1)
    expect(ds[0]).toMatchObject({ code: 'SYG265', file: 'App.jsx', line: 6 })
    expect(ds[0].message).toContain('track(s.a)')
    expect(ds[0].related[0]).toMatchObject({ file: 'h.js', line: 1 })
  })

  it('deep chains, re-exports, a namespace, an object of helpers, recursion', () => {
    const files = {
      'App.jsx': inView('a(state); n.c(); api.go(); r()', "import { a, r } from './a.js'\nimport * as n from './b.js'\nimport { api } from './o.js'"),
      'a.js': "import { c } from './b.js'\nexport const a = (s) => c(s)\nexport function r() { r2() }\nfunction r2() { r(); c() }\n",
      'b.js': "export { d as c } from './d.js'\n",
      'd.js': "export function d() { fetch('/x') }\n",
      'o.js': "export const api = { go() { navigator.sendBeacon('/x') } }\n",
    }
    expect(run(files).filter(d => d.code === 'SYG265')).toHaveLength(4)
  })

  it('a helper handed to map, a plain JSX view, a getter on a literal', () => {
    expect(codes(run(inView('[1].map(h)', "function h() { fetch('/x') }")))).toEqual(['SYG265'])
    expect(codes(run(component({ top: "function Sub() { fetch('/x'); return <i /> }", view: 'return <Sub />' })))).toEqual(['SYG265'])
    expect(codes(run(inView('const v = o.x', "const o = { get x() { fetch('/x'); return 1 } }")))).toEqual(['SYG265'])
  })

  it('a child with statics is checked as itself, not through the tag', () => {
    const src = `function Child() { fetch('/x'); return <i /> }\nChild.initialState = {}\n` + component({ view: 'return <Child />' })
    const ds = run(src)
    expect(ds).toHaveLength(1)
    expect(ds[0].message).toContain("view of 'Child'")
  })

  it('a sygnal-ignore at the call or at the effect', () => {
    expect(run({ 'App.jsx': model('{ GO: (s) => {\n// sygnal-ignore SYG265\ntrack(s.a); return s } }', "import { track } from './h.js'"), 'h.js': helper })).toEqual([])
    expect(run({ 'App.jsx': model('{ GO: (s) => { track(s.a); return s } }', "import { track } from './h.js'"), 'h.js': 'export function track() {\n// sygnal-ignore SYG265\nfetch("/x") }\n' })).toEqual([])
  })
})

describe('EFFECT, the declared escape hatch (SYG511)', () => {
  it('a network call is strict-only', () => {
    const src = model("{ GO: { EFFECT: () => { fetch('/x') } } }")
    expect(run(src, { strict: false })).toEqual([])
    expect(run(src)[0]).toMatchObject({ code: 'SYG511', severity: 'warn', data: { place: 'effect', kind: 'network' } })
    expect(run(src)[0].fix).toContain('HTTP')
  })
  it('through a helper, a callback, a socket', () => {
    expect(codes(run(model('{ GO: { EFFECT: () => { save() } } }', "function save() { navigator.sendBeacon('/x') }")))).toEqual(['SYG511'])
    expect(codes(run(model("{ GO: { EFFECT: () => { setTimeout(() => fetch('/x'), 1) } } }")))).toEqual(['SYG511'])
    expect(codes(run(model("{ GO: { EFFECT: () => { new WebSocket('wss://x') } } }")))).toEqual(['SYG511'])
  })
  it('everything else is allowed there', () => {
    expect(run(model(`{ GO: { EFFECT: (s) => {
      localStorage.setItem('a', '1'); document.title = 'x'; setTimeout(() => {}, 1); location.href = '/y'; window.scrollTo(0, 0)
    } } }`))).toEqual([])
  })
})

describe('module-level writes (SYG512, strict only)', () => {
  it('assignment, update, a property, an array method, an imported object', () => {
    expect(run(inView('n++', 'let n = 0'), { strict: false })).toEqual([])
    expect(codes(run(inView('n++', 'let n = 0')))).toEqual(['SYG512'])
    expect(codes(run(inView('n = 2', 'let n = 0')))).toEqual(['SYG512'])
    expect(codes(run(inView('o.x = 2', 'const o = {}')))).toEqual(['SYG512'])
    expect(codes(run(inView('a.push(2)', 'const a = []')))).toEqual(['SYG512'])
    expect(codes(run(inView('m.set(1, 2)', 'const m = new Map()')))).toEqual(['SYG512'])
    expect(codes(run({ 'App.jsx': inView('s.x = 2', "import { s } from './s.js'"), 's.js': 'export const s = {}\n' }))).toEqual(['SYG512'])
  })
  it('a memo (read and written in one function) is not reported; in an EFFECT nothing is', () => {
    expect(run(inView('f(1)', 'const c = new Map()\nfunction f(k) { if (c.has(k)) return c.get(k); const v = k + 1; c.set(k, v); return v }'))).toEqual([])
    expect(run(model('{ GO: { EFFECT: () => { n++ } } }', 'let n = 0'))).toEqual([])
  })
  it('a local variable of the same name is not module state', () => {
    expect(run(inView('let n = 0; n++', 'let m = 0'))).toEqual([])
  })
})

describe('rule registry and messages', () => {
  it('SYG265/266 are core rules; SYG511/512 strict', () => {
    expect(coreRules.some(r => r.codes.includes('SYG265') && r.codes.includes('SYG266'))).toBe(true)
    expect(strictRules.some(r => r.codes.includes('SYG511') && r.codes.includes('SYG512'))).toBe(true)
  })
  it('each message says what to do instead', () => {
    const fixOf = (code, top) => run(inView(code, top))[0].fix
    expect(fixOf("fetch('/x')")).toContain('HTTP')
    expect(fixOf("new WebSocket('wss://x')")).toContain('connections')
    expect(fixOf("localStorage.setItem('a', '1')")).toContain('persist')
    expect(fixOf('setTimeout(() => {}, 1)')).toContain('timers')
    expect(fixOf("location.href = '/x'")).toContain('ROUTER')
    expect(fixOf("document.querySelector('.a').focus()")).toContain('ELEMENT')
    expect(fixOf("document.title = 'x'")).toContain('head')
    expect(fixOf("window.addEventListener('x', () => {})")).toContain('browser')
    expect(fixOf("window.parent.postMessage('x', '*')")).toContain('driver')
  })
})

// The attempts of research/undeclared-effects §5. "Caught" is the rule's promise; each miss is written
// down, and asserted, so a change in what the rule sees is a decision rather than an accident.
describe('trying to fool it', () => {
  it.each([
    ["const k = 'fe' + 'tch'; globalThis[k]('/x')", 'SYG265'],
    ["globalThis[state.a]('/x')", 'SYG266'],
    ["Reflect.apply(fetch, null, ['/x'])", 'SYG265'],
    ["Reflect.get(window, state.a)('/x')", 'SYG266'],
    ["const g = window; g.fetch('/x')", 'SYG265'],
    ["let f; f = fetch; f('/x')", 'SYG265'],
    ["const i = document.createElement('img'); i.src = '/x?' + state.a", 'SYG265'],
    ["new Proxy({}, { get() { fetch('/x') } })", 'SYG265'],
    ["Promise.resolve().then(() => fetch('/x'))", 'SYG265'],
    ["setTimeout(\"fetch('/x')\", 0)", 'SYG266'],
  ])('caught: %s', (code, expected) => {
    expect(codes(run(inView(code)))).toContain(expected)
  })

  it('caught: an object of aliases, an instance method, a static method, a getter in initialState', () => {
    expect(codes(run(inView("api.send('/x')", 'const api = { send: window.fetch }')))).toEqual(['SYG265'])
    expect(codes(run(inView('new T().go()', "class T { go() { fetch('/x') } }")))).toEqual(['SYG265'])
    expect(codes(run(inView('t.go()', "class T { go() { fetch('/x') } }\nconst t = new T()")))).toEqual(['SYG265'])
    expect(codes(run(inView('T.go()', "class T { static go() { fetch('/x') } }")))).toEqual(['SYG265'])
    expect(codes(run(`function App({ state }) { return <p>{state.x}</p> }\nApp.initialState = { get x() { fetch('/x'); return 1 } }\n`))).toEqual(['SYG265'])
  })

  it('a local behavior may have an EFFECT of its own', () => {
    expect(run(component({ top: "const b = () => ({ model: { LOG: { EFFECT: () => { fetch('/x') } } } })", statics: 'App.uses = { b: b() }' }))).toEqual([])
  })

  it.each([
    ['the constructor trick', "[].constructor.constructor('return fetch')()('/x')"],
    ['a function from a parameter', 'state.send()'],
    ['a function from state', 'const f = state.f; f()'],
    ['a package not on the list', "wrap('/x')", "import wrap from 'some-sdk'"],
    ['a callback a package calls', "lib(() => 1)", "import lib from 'some-sdk'"],
    ['a method of a package object', 'sdk.track()', "import { sdk } from 'some-sdk'"],
    ['Object.defineProperty on a module object', 'const v = o.x', "const o = {}\nObject.defineProperty(o, 'x', { get() { return 1 } })"],
    ['a declarative pixel', "const v = <img src={'https://t.example/?e=' + state.a} />"],
  ])('known miss (the dev backstop or nothing): %s', (_, code, top = '') => {
    expect(run(inView(code, top))).toEqual([])
  })

  it('known miss: a model the checker cannot read, defineComponent', () => {
    expect(run(component({ top: "const build = () => ({ GO: (s) => { fetch('/x'); return s } })", statics: 'App.model = build()' }))).toEqual([])
    expect(run("import { defineComponent } from 'sygnal'\nexport const X = defineComponent({ view: () => { fetch('/x'); return null }, model: {} })\n")).toEqual([])
  })
})
