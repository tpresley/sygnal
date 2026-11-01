// record/replay: SYG258 (default mode, STATE reducers) and SYG509 (--strict, every model handler):
// Date.now() / new Date() / Math.random() / crypto.randomUUID() read from a global in a handler,
// where the canonical form takes now() / random() / uuid() from the handler's 4th argument.
import { describe, expect, it } from 'vitest'
import { checkFiles, fixFiles, strictRules, coreRules } from '../src/index.js'
import { selectRules } from '../src/rules/index.js'

const file = '/virtual/app/App.jsx'
const CODES = new Set(['SYG258', 'SYG509', 'SYG900'])
const run = (source, opts = {}, path = file) =>
  checkFiles([path], { cwd: '/virtual/app', sources: { [path]: source }, ...opts }).filter(d => CODES.has(d.code))
const strict = (source, path) => run(source, { strict: true }, path)
const fix = (source, path = file) => fixFiles([path], { cwd: '/virtual/app', sources: { [path]: source } })

const app = (model, extra = '') => `import { run, ABORT, event } from 'sygnal'
${extra}
function App({ state }) { return <main><button className="add">add</button><p>{state.count}</p></main> }
App.initialState = { count: 0, tasks: [] }
App.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
App.model = ${model}
run(App)
`

describe('rule registry', () => {
  it('SYG258 is a core rule left out under --strict; SYG509 a strict rule', () => {
    const r258 = coreRules.find(r => r.codes.includes('SYG258'))
    const r509 = strictRules.find(r => r.codes.includes('SYG509'))
    expect(r258.notStrict).toBe(true)
    expect(r509.strict).toBe(true)
    expect(selectRules({ strict: false })).toContain(r258)
    expect(selectRules({ strict: false })).not.toContain(r509)
    expect(selectRules({ strict: true })).toContain(r509)
    expect(selectRules({ strict: true })).not.toContain(r258)
  })
})

describe('SYG258 (default mode)', () => {
  it('Date.now(), new Date(), Math.random() and crypto.randomUUID() in a STATE reducer', () => {
    const diags = run(app(`{
  ADD: (state) => ({ ...state, at: Date.now(), d: new Date(), r: Math.random(), id: crypto.randomUUID() }),
}`))
    expect(diags.map(d => `${d.code} ${d.severity} ${d.data.read}`)).toEqual(['SYG258 warn now', 'SYG258 warn now', 'SYG258 warn random', 'SYG258 warn uuid'])
    expect(diags[0].message).toContain("the STATE reducer for 'ADD' reads the clock from a global (`Date.now()`)")
    expect(diags[0].message).toContain('replaying')
    expect(diags[0].fix).toContain('`ADD: (state, data, next, { now, random, uuid }) => …` with `now()` in place of `Date.now()`')
    expect(diags[1].fix).toContain('`new Date(now())` in place of `new Date()`')
  })

  it('globalThis. / window. / self. prefixes, object-form STATE and a function declaration', () => {
    const diags = run(app(`{
  ADD: { STATE: function (state) { return { ...state, id: globalThis.crypto.randomUUID(), r: window.Math.random(), t: self.Date.now() } } },
}`))
    expect(diags.map(d => d.data.read)).toEqual(['uuid', 'random', 'now'])
  })

  it('not in EFFECT or other sinks (strict only), views, intents or nested functions', () => {
    expect(run(app(`{ ADD: { EFFECT: (state) => { localStorage.setItem('at', String(Date.now())) } } }`))).toEqual([])
    const view = app(`{ ADD: (state) => state }`).replace('<p>{state.count}</p>', '<p>{Date.now()}</p>')
    expect(run(view)).toEqual([])
    expect(strict(view)).toEqual([])
    const intent = app(`{ ADD: (state, at) => ({ ...state, at }) }`).replace("DOM.click('.add')", "DOM.click('.add').map(() => Date.now())")
    expect(run(intent)).toEqual([])
    expect(strict(intent)).toEqual([])
    const nested = app(`{ ADD: (state) => ({ ...state, tasks: state.tasks.map(t => ({ ...t, id: crypto.randomUUID() })) }) }`)
    expect(run(nested)).toEqual([])
    expect(strict(nested)).toEqual([])
    const helper = app(`{ ADD: (state) => ({ ...state, at: stamp() }) }`, 'const stamp = () => Date.now()')
    expect(run(helper)).toEqual([])
    expect(strict(helper)).toEqual([])
  })

  it('new Date(x), a local Date / Math / crypto, and the canonical form are not reported', () => {
    expect(strict(app(`{ ADD: (state, data) => ({ ...state, d: new Date(data), s: new Date(state.at).toISOString() }) }`))).toEqual([])
    expect(strict(app(`{ ADD: (state) => ({ ...state, at: Date.now(), r: Math.random(), id: crypto.randomUUID() }) }`,
      `const Date = { now: () => 0 }\nconst Math = { random: () => 0 }\nimport crypto from './crypto.js'`))).toEqual([])
    expect(strict(app(`{ ADD: (state, data, next, { now, uuid }) => ({ ...state, tasks: [...state.tasks, { id: uuid(), created: now() }] }) }`))).toEqual([])
  })

  it('can be ignored with a comment', () => {
    expect(run(app(`{
  // sygnal-ignore SYG258
  ADD: (state) => ({ ...state, at: Date.now() }),
}`))).toEqual([])
  })
})

describe('SYG509 (--strict)', () => {
  it('EFFECT, other sinks and event() payloads too; one code per read (no SYG258 under --strict)', () => {
    const diags = strict(app(`{
  ADD: {
    STATE: (state) => ({ ...state, at: Date.now() }),
    EFFECT: (state, data, next) => { localStorage.setItem('savedAt', String(Date.now())) },
    EVENTS: event('ADDED', (state) => ({ id: crypto.randomUUID() })),
    HTTP: (state) => ({ url: '/log?r=' + Math.random() }),
  },
}`))
    expect(diags.map(d => `${d.code} ${d.severity} ${d.data.sink} ${d.data.read}`)).toEqual([
      'SYG509 warn STATE now', 'SYG509 warn EFFECT now', 'SYG509 warn EVENTS uuid', 'SYG509 warn HTTP random',
    ])
    expect(diags[1].message).toContain("the EFFECT handler of 'ADD' reads the clock from a global (`Date.now()`)")
    expect(diags[1].fix).toContain('`EFFECT: (state, data, next, { now }) => …`')
  })

  it('a named 4th parameter: props.now()', () => {
    const [d] = strict(app(`{ ADD: { EFFECT: (state, data, next, props) => { console.log(props.name, Date.now()) } } }`))
    expect(d.fix).toContain('`props.now()` in place of `Date.now()`')
  })
})

describe('--fix', () => {
  const fixed = (model, extra, path) => fix(app(model, extra), path).texts.get(path || file)

  it('adds the missing parameters and rewrites every read of a handler', () => {
    expect(fixed(`{ ADD: (state) => ({ ...state, at: Date.now(), d: new Date(), id: crypto.randomUUID() }) }`))
      .toContain('ADD: (state, data, next, { now, uuid }) => ({ ...state, at: now(), d: new Date(now()), id: uuid() })')
    expect(fixed(`{ ADD: state => ({ ...state, r: Math.random() }) }`)).toContain('ADD: (state, data, next, { random }) => ({ ...state, r: random() })')
    expect(fixed(`{ ADD: { EFFECT: () => { console.log(Date.now()) } } }`)).toContain('EFFECT: (state, data, next, { now }) => { console.log(now()) }')
    expect(fixed(`{ ADD: { EFFECT() { console.log(Date.now()) } } }`)).toContain('EFFECT(state, data, next, { now }) { console.log(now()) }')
  })

  it('uses an existing 4th parameter: a name, or a pattern it adds to', () => {
    expect(fixed(`{ ADD: { EFFECT: (s, d, n, props) => { console.log(Date.now()) } } }`)).toContain('console.log(props.now())')
    expect(fixed(`{ ADD: (s, d, n, { previousState }) => ({ ...s, at: Date.now() }) }`)).toContain('ADD: (s, d, n, { now, previousState }) => ({ ...s, at: now() })')
    expect(fixed(`{ ADD: (s, d, n, { now: clock }) => ({ ...s, at: Date.now() }) }`)).toContain('ADD: (s, d, n, { now: clock }) => ({ ...s, at: clock() })')
  })

  it('a name the new parameters would shadow: data → _data; now already used: no fix', () => {
    expect(fixed(`{ ADD: (state) => ({ ...state, at: Date.now(), d: data }) }`, 'const data = 1'))
      .toContain('ADD: (state, _data, next, { now }) => ({ ...state, at: now(), d: data })')
    const [d] = strict(app(`{ ADD: (state) => ({ ...state, at: Date.now(), n: now }) }`, 'const now = 1'))
    expect(d.code).toBe('SYG509')
    expect(d.fixes).toBeUndefined()
  })

  it('no fix for a rest parameter or a typed TypeScript handler', () => {
    expect(strict(app(`{ ADD: (...args) => ({ ...args[0], at: Date.now() }) }`))[0].fixes).toBeUndefined()
    const ts = '/virtual/app/App.tsx'
    expect(strict(app(`{ ADD: (state: any) => ({ ...state, at: Date.now() }) }`), ts)[0].fixes).toBeUndefined()
  })

  it('is idempotent', () => {
    const once = fix(app(`{ ADD: (state) => ({ ...state, a: Date.now(), b: Date.now() }) }`)).texts.get(file)
    expect(once).toContain('ADD: (state, data, next, { now }) => ({ ...state, a: now(), b: now() })')
    const twice = fixFiles([file], { cwd: '/virtual/app', sources: { [file]: once } })
    expect(twice.fixed).toBe(0)
  })
})
