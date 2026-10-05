/**
 * PLAN-5 W-1: defineWidget tags in sygnal-check (from spike 0-S1), and the widget rule
 * (rules/syg140-widgets.js: SYG140-SYG144).
 *
 *   a widget tag renders its host in the using view's scope (not a child component), so
 *   SYG110 / SYG640 see its className; its host tag drives the a11y rules (SYG702); its value
 *   prop is not a controlled field (SYG111); controls({ Due: DatePicker }) resolves to the host
 *   tag with kind 'widget' and the widget's commands, also across an import.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-widgets-'))
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp })
}
const codes = (ds) => ds.map(d => d.code).sort()

const WIDGET = `
import { defineWidget } from 'sygnal'
export const DatePicker = defineWidget({
  tag: 'input',
  mount: (el, props, emit) => ({ el, emit }),
  update: (fp, props) => {},
  events: ['pick'],
  commands: { open: (fp) => fp.open() },
})
`

describe('widget tags', () => {
  it('a selector on a widget tag matches its host; the ELEMENT target exists', () => {
    const ds = check({
      'picker.js': WIDGET,
      'Form.jsx': `
import { DatePicker } from './picker.js'
export function Form({ state }) {
  return <form><label>Due <DatePicker className="due" value={state.due} /></label></form>
}
Form.initialState = { due: null }
Form.intent = ({ DOM }) => ({ DUE: DOM.select('.due').events('pick').detail(), OPEN: DOM.select('.due').events('dblclick') })
Form.model = { DUE: (s, due) => ({ ...s, due }), OPEN: { ELEMENT: { open: '.due' } } }
`,
    })
    expect(codes(ds)).toEqual([])
  })

  it('an input-hosted widget needs a label (SYG702), tag and control forms', () => {
    const ds = check({
      'picker.js': WIDGET,
      'Form.jsx': `
import { controls } from 'sygnal'
import { DatePicker } from './picker.js'
const { Due } = controls({ Due: DatePicker })
export function Form({ state }) {
  return <form><DatePicker className="due" value={state.due} /><Due value={state.due} /></form>
}
Form.initialState = { due: null }
Form.intent = ({ DOM }) => ({ DUE: DOM.select('.due').events('pick'), DUE2: DOM.select(Due).events('pick') })
Form.model = { DUE: (s, due) => ({ ...s, due }), DUE2: (s, due) => ({ ...s, due }) }
`,
    })
    expect(codes(ds)).toEqual(['SYG702', 'SYG702'])
    expect(ds.map(d => d.message.split(' has')[0]).sort()).toEqual(['widget <DatePicker> (a <input>)', 'widget <Due> (a <input>)'])
  })

  it('a div-hosted widget needs no label; a missing class is still SYG110', () => {
    const ds = check({
      'Chart.jsx': `
import { defineWidget } from 'sygnal'
const Chart = defineWidget({ mount: (el) => ({}), events: ['hover'] })
export function Page() { return <main><Chart className="chart" data={[1, 2]} /></main> }
Page.initialState = {}
Page.intent = ({ DOM }) => ({ H: DOM.select('.chart').events('hover'), X: DOM.select('.nope').events('hover') })
Page.model = { H: (s) => s, X: (s) => s }
`,
    })
    expect(codes(ds)).toEqual(['SYG110'])
    expect(ds[0].message).toMatch(/'\.nope'/)
  })
})

const PICKER = (extra = '') => `
import { defineWidget } from 'sygnal'
export const DatePicker = defineWidget({
  tag: 'input',
  mount(el, props, emit) { el.onclick = () => emit('pick', 1); return { el } },
  events: ['pick'],
  commands: { open: (fp) => fp.open()${extra} },
})
`
const FORM = (intent, model = '{ DUE: (s, due) => ({ ...s, due }) }') => `
import { controls } from 'sygnal'
import { DatePicker } from './picker.js'
const { Due } = controls({ Due: DatePicker })
export function Form({ state }) {
  return <form><label>Due <DatePicker className="due" value={state.due} /></label><label>Other <Due /></label><button className="go">go</button></form>
}
Form.initialState = { due: null }
Form.intent = ({ DOM }) => (${intent})
Form.model = ${model}
`

describe('SYG140–SYG144 (rules/syg140-widgets.js)', () => {
  it('SYG140: mount() emits a literal name its events do not list', () => {
    const ds = check({
      'w.js': `
import { defineWidget } from 'sygnal'
export const Stars = defineWidget({
  mount(el, props, emit) { el.onclick = () => { emit('rate', 1); emit('rtae', 2) }; return {} },
  events: ['rate'],
})
`,
    })
    expect(codes(ds)).toEqual(['SYG140'])
    expect(ds[0].message).toMatch(/widget Stars's mount\(\) dispatches 'rtae', which is not one of its declared events \('rate'\) \(did you mean 'rate'\?\)/)
    expect(ds[0].fix).toBe("emit('rate', …)")
  })

  it('SYG141: listening for an undeclared, non-native event on a widget host (selector and control)', () => {
    const ds = check({
      'picker.js': PICKER(),
      'Form.jsx': FORM(`{ DUE: DOM.select('.due').events('pikc').detail(), D2: DOM.select(Due).events('pik'), OK: DOM.select('.due').events('pick'), CLICK: DOM.select('.due').events('click'), GO: DOM.click('.go') }`,
        `{ DUE: (s, due) => ({ ...s, due }), D2: (s) => s, OK: (s) => s, CLICK: (s) => s, GO: (s) => s }`),
    })
    expect(codes(ds)).toEqual(['SYG141', 'SYG141'])
    const m = ds.map(d => d.message).sort()
    expect(m[0]).toMatch(/listens for 'pik' on the widget control Due, which doesn't declare that event \(it declares 'pick'\): did you mean 'pick'\?/)
    expect(m[1]).toMatch(/listens for 'pikc' on '\.due' \(widget DatePicker\)/)
  })

  it('SYG141: silent when a plain element shares the class, or a class is dynamic', () => {
    const ds = check({
      'picker.js': PICKER(),
      'Form.jsx': `
import { DatePicker } from './picker.js'
export function Form({ state }) {
  return <form><label>Due <DatePicker className="due" /></label><span className="due">x</span><i className={state.c}>y</i></form>
}
Form.initialState = { c: 'a' }
Form.intent = ({ DOM }) => ({ X: DOM.select('.due').events('custom') })
Form.model = { X: (s) => s }
`,
    })
    expect(codes(ds)).toEqual([])
  })

  it('D200: close / togglePopover are ordinary command names (no SYG142)', () => {
    const ds = check({ 'picker.js': PICKER(', close: (fp) => fp.close(), togglePopover: () => {}') })
    expect(codes(ds)).toEqual([])
  })

  it('SYG142: an ELEMENT command the targeted widget does not declare (selector and control); native methods are fine', () => {
    const ds = check({
      'picker.js': PICKER(),
      'Form.jsx': FORM(`{ GO: DOM.click('.go') }`, `{ GO: { ELEMENT: [{ opne: '.due' }, { open: '.due' }, { focus: '.due' }, { showPicker: Due }, { shut: Due }] } }`),
    })
    expect(codes(ds)).toEqual(['SYG142', 'SYG142'])
    const m = ds.slice().sort((a, b) => a.message < b.message ? -1 : 1)
    expect(m[0].message).toMatch(/command 'opne' .* targets '\.due' \(widget DatePicker\), which declares no 'opne' command \(did you mean 'open'\?\); it declares: open$/)
    expect(m[0].severity).toBe('error')
    // G-366: not a near-typo of a declared command: info (the library may add the method)
    expect(m[1].message).toMatch(/command 'shut' .* targets the widget control Due.*fine if the library adds shut\(\) to the host element/)
    expect(m[1].severity).toBe('info')
  })

  it('G-366: a library-driven host (Choices.js on a <select>) fires its own events: no SYG141 for a non-typo name', () => {
    const ds = check({
      'App.jsx': `
import { defineWidget } from 'sygnal'
import Choices from 'choices.js'
export const Picker = defineWidget({ name: 'Picker', tag: 'select', mount: (el) => new Choices(el), unmount: (c) => c.destroy(), events: [], commands: {} })
export function App({ state }) { return <div><label>Tags <Picker className="tags" /></label></div> }
App.initialState = { tags: [] }
App.intent = ({ DOM }) => ({ ADD: DOM.select('.tags').events('addItem').detail() })
App.model = { ADD: (s, d) => ({ ...s, tags: [...s.tags, d.value] }) }
`,
    })
    expect(codes(ds)).toEqual([])
  })

  it('G-366: a custom element host (my-editor) is skipped by SYG141 and SYG142 (its own events and methods)', () => {
    const ds = check({
      'App.jsx': `
import { defineWidget } from 'sygnal'
export const Editor = defineWidget({ name: 'Editor', tag: 'my-editor', mount: (el) => el, events: ['save'], commands: { save: (ed) => ed.save() } })
export function App() { return <div><Editor className="ed" /><button className="undo">Undo</button></div> }
App.initialState = {}
App.intent = ({ DOM }) => ({ EDITED: DOM.select('.ed').events('my-input'), SAVD: DOM.select('.ed').events('svae'), UNDO: DOM.click('.undo') })
App.model = { EDITED: (s) => s, SAVD: (s) => s, UNDO: { ELEMENT: [{ undo: '.ed' }, { svae: '.ed' }] } }
`,
    })
    expect(codes(ds)).toEqual([])
  })

  it('SYG143: the widget tag as a selector or command target (and no SYG110 for it)', () => {
    const ds = check({
      'picker.js': PICKER(),
      'Form.jsx': FORM(`{ DUE: DOM.select(DatePicker).events('pick'), GO: DOM.click('.go') }`, `{ DUE: (s, due) => ({ ...s, due }), GO: { ELEMENT: { open: DatePicker } } }`),
    })
    // (SYG126: the fixture's control Due is rendered but not listened to here)
    expect(codes(ds)).toEqual(['SYG126', 'SYG143', 'SYG143'])
    expect(ds.filter(d => d.code === 'SYG143').map(d => d.message).sort()[0]).toMatch(/DOM\.select\(DatePicker\) is given the widget DatePicker tag itself/)
  })

  it('SYG144 (info): a declared event name elements fire natively', () => {
    const ds = check({
      'w.js': `
import { defineWidget } from 'sygnal'
export const Picker = defineWidget({ tag: 'input', mount: (el, p, emit) => ({}), events: ['change', 'pick'] })
`,
    })
    expect(codes(ds)).toEqual(['SYG144'])
    expect(ds[0].severity).toBe('info')
    expect(ds[0].message).toMatch(/declares 'change', which elements fire natively/)
  })
})
