// Helpers followed where the Sift console port had to inline literals: SYG102 (timer actions
// spread from a helper, ok / error names from a helper or a shared entry object), SYG110 (a class
// passed to a view helper), SYG702 (a field a view helper wraps in its <label>). A helper the
// checker can't follow stays silent (or info) as before.
import { describe, expect, it } from 'vitest'
import { checkFiles } from '../src/index.js'

const DIR = '/virtual/app'
function run(sources) {
  const files = Object.keys(sources).map(f => `${DIR}/${f}`)
  return checkFiles(files.filter(f => /App\.jsx$/.test(f)), { cwd: DIR, sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [`${DIR}/${k}`, v])) })
}
const codes = (d, ...cs) => d.filter(x => cs.includes(x.code)).map(x => `${x.code}${x.severity === 'info' ? '/info' : ''} ${x.data?.action || x.data?.selector || x.data?.element || ''}`.trim())

const app = ({ head = '', view = '<button className="load">x</button>', intent = `LOAD: DOM.click('.load')`, model = '', statics = '' } = {}) => `${head}
function App({ state }) { return ${view} }
App.initialState = { status: 'idle' }
App.intent = ({ DOM }) => ({ ${intent} })
App.model = {
  LOAD: (state) => state,${model}
}
${statics}`

describe('SYG102: timer actions spread from a helper', () => {
  const model = `\n  POLL: (s) => s,\n  TICK: (s) => s,`

  it('timers: () => ({ ...pollers(), … }) with a same-module helper', () => {
    const d = run({ 'App.jsx': app({ model, head: `const pollers = () => ({ poll: { every: 1000, action: 'POLL' } })`, statics: `App.timers = () => ({ ...pollers(), tick: { every: 100, action: 'TICK' } })` }) })
    expect(codes(d, 'SYG102', 'SYG112')).toEqual([])
  })

  it('an imported helper, with a ternary', () => {
    const d = run({
      'App.jsx': app({ model, head: `import { pollers } from './timers.js'`, statics: `App.timers = (state) => ({ ...pollers(state), tick: { every: 100, action: 'TICK' } })` }),
      'timers.js': `export const pollers = (state) => ({ poll: state.on ? { every: 1000, action: 'POLL' } : false })\n`,
    })
    expect(codes(d, 'SYG102', 'SYG112')).toEqual([])
  })

  it('a const map spread into the object form', () => {
    const d = run({ 'App.jsx': app({ model, head: `const POLLERS = { poll: () => ({ every: 1000, action: 'POLL' }) }`, statics: `App.timers = { ...POLLERS, tick: () => ({ every: 100, action: 'TICK' }) }` }) })
    expect(codes(d, 'SYG102', 'SYG112')).toEqual([])
  })

  it('a misspelled action in the helper is SYG112, and the entry it meant SYG102', () => {
    const d = run({ 'App.jsx': app({ model, head: `const pollers = () => ({ poll: { every: 1000, action: 'POLLL' } })`, statics: `App.timers = () => ({ ...pollers(), tick: { every: 100, action: 'TICK' } })` }) })
    expect(codes(d, 'SYG102', 'SYG112').sort()).toEqual(['SYG102 POLL', 'SYG112 POLLL'])
  })

  it('a helper it can\'t follow stays info', () => {
    const d = run({ 'App.jsx': app({ model, head: `import { pollers } from 'some-package'`, statics: `App.timers = () => ({ ...pollers(), tick: { every: 100, action: 'TICK' } })` }) })
    expect(codes(d, 'SYG102')).toEqual(['SYG102/info POLL'])
  })
})

describe('SYG102: ok / error names from a helper or a shared entry object', () => {
  const intent = `LOAD: DOM.click('.load'), FETCH: DOM.click('.load')`
  const replies = `\n  GOT: (s) => s,\n  FAILED: (s) => s,`
  const fetchApp = (http, head = '') => app({ intent, head, model: `\n  FETCH: { HTTP: ${http} },${replies}` })

  it('ok: replyOf(\'GOT\') (a helper returning the name)', () => {
    const d = run({ 'App.jsx': fetchApp(`() => ({ url: '/x', ok: replyOf('GOT'), error: 'FAILED' })`, `const replyOf = (name) => name`) })
    expect(codes(d, 'SYG102', 'SYG112')).toEqual([])
  })

  it('ok: NAMES.ok (a const object) and names().error (a helper\'s object)', () => {
    const head = `const NAMES = { ok: 'GOT' }\nconst names = () => ({ error: 'FAILED' })`
    expect(codes(run({ 'App.jsx': fetchApp(`() => ({ url: '/x', ok: NAMES.ok, error: names().error })`, head) }), 'SYG102', 'SYG112')).toEqual([])
  })

  it('a misspelled name in the const object is SYG112', () => {
    const d = run({ 'App.jsx': fetchApp(`() => ({ url: '/x', ok: NAMES.ok, error: 'FAILED' })`, `const NAMES = { ok: 'GOTT' }`) })
    expect(codes(d, 'SYG102', 'SYG112').sort()).toEqual(['SYG102 GOT', 'SYG112 GOTT'])
  })

  it('a shared entry object (FETCH: loadEntry), same module and imported', () => {
    const same = app({ intent, head: `const loadEntry = { HTTP: () => ({ url: '/x', ok: 'GOT', error: 'FAILED' }) }`, model: `\n  FETCH: loadEntry,${replies}` })
    expect(codes(run({ 'App.jsx': same }), 'SYG102', 'SYG112')).toEqual([])
    const imported = app({ intent, head: `import { loadEntry } from './entries.js'`, model: `\n  FETCH: loadEntry,${replies}` })
    expect(codes(run({ 'App.jsx': imported, 'entries.js': `export const loadEntry = { HTTP: () => ({ url: '/x', ok: 'GOT', error: 'FAILED' }) }\n` }), 'SYG102', 'SYG112')).toEqual([])
  })

  it('an entry made by a helper, its reply name a parameter (FETCH: fetching(\'GOT\'))', () => {
    const head = `const fetching = (ok) => ({ HTTP: () => ({ url: '/x', ok, error: 'FAILED' }) })`
    expect(codes(run({ 'App.jsx': app({ intent, head, model: `\n  FETCH: fetching('GOT'),${replies}` }) }), 'SYG102', 'SYG112')).toEqual([])
    const bad = run({ 'App.jsx': app({ intent, head, model: `\n  FETCH: fetching('GOTT'),${replies}` }) })
    expect(codes(bad, 'SYG102', 'SYG112').sort()).toEqual(['SYG102 GOT', 'SYG112 GOTT'])
  })

  it('a name helper it can\'t follow stays info', () => {
    const d = run({ 'App.jsx': fetchApp(`() => ({ url: '/x', ok: replyOf('GOT'), error: 'FAILED' })`, `import { replyOf } from 'some-package'`) })
    expect(codes(d, 'SYG102')).toEqual(['SYG102/info GOT'])
  })
})

describe('SYG110: a class passed to a view helper', () => {
  const intent = `LOAD: DOM.click('.load'), PICK: DOM.click('.pick')`
  const model = `\n  PICK: (s) => s,`

  it('row({ className: \'pick\' }) with a destructured parameter', () => {
    const head = `const row = ({ className, label }) => <li className={className}>{label}</li>`
    const d = run({ 'App.jsx': app({ intent, model, head, view: `<ul><button className="load">x</button>{row({ className: 'pick', label: 'A' })}</ul>` }) })
    expect(codes(d, 'SYG110', 'SYG104')).toEqual([])
  })

  it('a plain parameter, props.className, a template and an imported helper', () => {
    const d = run({
      'App.jsx': app({ intent: `${intent}, OPEN: DOM.click('.row-open'), EDIT: DOM.click('.edit')`, model: `${model}\n  OPEN: (s) => s,\n  EDIT: (s) => s,`,
        head: `import { cell } from './cells.jsx'\nconst row = (cls) => <li className={\`row-\${cls}\`}>x</li>\nconst item = (props) => <span className={props.className}>x</span>`,
        view: `<ul><button className="load">x</button>{row('open')}{item({ className: 'pick' })}{cell('edit')}</ul>` }),
      'cells.jsx': `export const cell = (kind) => <td className={kind}>x</td>\n`,
    })
    expect(codes(d, 'SYG110', 'SYG104')).toEqual([])
  })

  it('a misspelled class at the call is now a warning, with the helper followed', () => {
    const head = `const row = ({ className }) => <li className={className}>x</li>`
    const d = run({ 'App.jsx': app({ intent, model, head, view: `<ul><button className="load">x</button>{row({ className: 'pik' })}</ul>` }) })
    expect(codes(d, 'SYG110')).toEqual(['SYG110 .pick'])
  })

  it('a helper also passed by reference (items.map(row)) keeps its dynamic class: info', () => {
    const head = `const row = (className) => <li className={className}>x</li>`
    const d = run({ 'App.jsx': app({ intent, model, head, view: `<ul><button className="load">x</button>{row('other')}{['a'].map(row)}</ul>` }) })
    expect(codes(d, 'SYG110')).toEqual(['SYG110/info .pick'])
  })

  it('an argument object with a spread keeps the class dynamic: info', () => {
    const head = `const row = ({ className }) => <li className={className}>x</li>`
    const d = run({ 'App.jsx': app({ intent, model, head, view: `<ul><button className="load">x</button>{row({ ...state.opts })}</ul>` }) })
    expect(codes(d, 'SYG110')).toEqual(['SYG110/info .pick'])
  })
})

describe('SYG702: a label rendered by a view helper', () => {
  it('field(\'Name\', <input />) with the helper wrapping it in a <label>', () => {
    const head = `const field = (text, input) => <label>{text}{input}</label>`
    const d = run({ 'App.jsx': app({ head, view: `<div><button className="load">x</button>{field('Name', <input />)}</div>` }) })
    expect(codes(d, 'SYG702')).toEqual([])
  })

  it('an object argument (children / props.control) and an imported helper', () => {
    const d = run({
      'App.jsx': app({ head: `import { labelled } from './fields.jsx'\nconst field = ({ text, children }) => <label>{text}{children}</label>\nconst row = (props) => <p><label>{props.label}{props.control}</label></p>`,
        view: `<div><button className="load">x</button>{field({ text: 'A', children: <input /> })}{row({ label: 'B', control: <select /> })}{labelled('C', <textarea />)}</div>` }),
      'fields.jsx': `export const labelled = (text, el) => <label><span>{text}</span>{el}</label>\n`,
    })
    expect(codes(d, 'SYG702')).toEqual([])
  })

  it('a helper that renders the field outside a label still reports', () => {
    const head = `const field = (text, input) => <div>{text}{input}</div>`
    const d = run({ 'App.jsx': app({ head, view: `<div><button className="load">x</button>{field('Name', <input />)}</div>` }) })
    expect(codes(d, 'SYG702')).toEqual(['SYG702 input'])
  })

  it('a helper it can\'t follow says nothing', () => {
    const d = run({ 'App.jsx': app({ head: `import { field } from 'some-package'`, view: `<div><button className="load">x</button>{field('Name', <input />)}</div>` }) })
    expect(codes(d, 'SYG702')).toEqual([])
  })
})
