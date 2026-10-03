/**
 * PLAN-4 3-K: sygnal-check support for element commands (GS-2) and timers (GS-7).
 *
 *   ELEMENT      not a reply-action sink (`block: 'nearest'` is an option, not a reply name)
 *   SYG641       static: the first key of a literal command is a misspelled documented method
 *                (did you mean) or a method that changes the DOM Sygnal renders
 *   SYG640       static: a command's target (a control or a static selector) the sending
 *                component's view never renders, or renders only inside a child component
 *   SYG126       a control used as an ELEMENT target counts as used
 *   SYG102       timer actions (`{ every, action }`, `{ frame }`) are triggers; the native events
 *                a command causes (close, toggle) are listened to by intent actions as usual
 *   SYG112       a timer action with no model entry
 *   SYG422       static: a literal timer spec makeTimerDriver() can't run
 *   SYG643       static: timers / connections / resources declared by a component of an app
 *                whose run() call (with a literal drivers object) registers no driver for it
 *   --graph      ELEMENT commands and timers per component
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, graphFiles, validateSchema } from '../src/index.js'
import { formatGraph } from '../src/graphText.js'
import { NATIVE_COMMAND_NAMES, DOM_MUTATORS } from '../src/model/elementCommands.js'
import { STATIC_DRIVERS } from '../src/model/apps.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(fs.readFileSync(path.join(here, '../schema/inspect.schema.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

const A11Y = ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708']

function project(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-3k-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const root = tmp
  const sources = () => Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(root, f))
  return {
    root,
    check: (opts = {}) => checkFiles(sources(), { cwd: root, ignore: A11Y, ...opts }),
    graph: () => graphFiles(sources(), { cwd: root, ignore: A11Y }),
  }
}

const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()
const only = (diags, code) => diags.filter(d => d.code === code)

// ─── GS-2: element commands ──────────────────────────────────────────────────

const DIALOG = `import { controls } from 'sygnal'
const { HelpDialog, OpenHelp, CloseHelp } = controls({ HelpDialog: 'dialog', OpenHelp: 'button', CloseHelp: 'button' })
export function Help({ state }) {
  return <div><OpenHelp>Help</OpenHelp><HelpDialog><p>Keys</p><CloseHelp>Close</CloseHelp></HelpDialog><p>{state.status}</p></div>
}
Help.initialState = { status: 'closed' }
Help.intent = ({ DOM }) => ({ OPEN_HELP: DOM.click(OpenHelp), CLOSE_HELP: DOM.click(CloseHelp), HELP_CLOSED: DOM.close(HelpDialog) })
Help.model = {
  OPEN_HELP: { STATE: (s) => ({ ...s, status: 'open' }), ELEMENT: { showModal: HelpDialog } },
  CLOSE_HELP: { ELEMENT: { close: HelpDialog, returnValue: 'done' } },
  HELP_CLOSED: (s) => ({ ...s, status: 'closed' }),
}
`

describe('ELEMENT is not a reply-action sink', () => {
  it("an option like block: s.block is not a dynamic reply name (SYG102 stays a warning)", () => {
    const p = project({ 'List.jsx': `import { controls } from 'sygnal'
const { Row, Add } = controls({ Row: 'li', Add: 'button' })
export function List({ state }) { return <ul><Row>x</Row><Add>+</Add></ul> }
List.initialState = { block: 'nearest' }
List.intent = ({ DOM }) => ({ ADD: DOM.click(Add) })
List.model = {
  ADD: { ELEMENT: (s) => ({ scrollIntoView: Row, block: s.block }) },
  ORPHAN: (s) => s,
}
` })
    const d = p.check()
    expect(codes(d)).toEqual(['SYG102 warn'])
    expect(d[0].message).not.toMatch(/non-literal/)
  })

  it("block: 'nearest' is not a reply action (no SYG112 for a model-key look-alike)", () => {
    const p = project({ 'List.jsx': `import { controls } from 'sygnal'
const { Row, Add } = controls({ Row: 'li', Add: 'button' })
export function List() { return <ul><Row>x</Row><Add>+</Add></ul> }
List.intent = ({ DOM }) => ({ ADD: DOM.click(Add) })
List.model = { ADD: { ELEMENT: { scrollIntoView: Row, block: 'ADDED' } }, ADDEd: (s) => s }
` })
    expect(only(p.check(), 'SYG112')).toEqual([])
  })
})

describe('the native events commands cause', () => {
  it('a dialog opened and closed by commands, its close event in the intent: no findings', () => {
    expect(project({ 'Help.jsx': DIALOG }).check()).toEqual([])
  })

  it('popover methods and toggle: no findings', () => {
    const p = project({ 'Menu.jsx': `import { controls } from 'sygnal'
const { Menu, Open } = controls({ Menu: 'div', Open: 'button' })
export function Pop({ state }) { return <div><Open>Menu</Open><Menu attrs={{ popover: 'auto' }}>items</Menu><p>{String(state.open)}</p></div> }
Pop.initialState = { open: false }
Pop.intent = ({ DOM }) => ({ OPEN: DOM.click(Open), TOGGLED: DOM.toggle(Menu).map(e => e.newState === 'open') })
Pop.model = { OPEN: { ELEMENT: { togglePopover: Menu } }, TOGGLED: (s, open) => ({ ...s, open }) }
` })
    expect(p.check()).toEqual([])
  })
})

describe('SYG126: a control used as an ELEMENT target counts as used', () => {
  it('a dialog only commanded (never listened to): no SYG126', () => {
    const p = project({ 'Help.jsx': `import { controls } from 'sygnal'
const { HelpDialog, OpenHelp } = controls({ HelpDialog: 'dialog', OpenHelp: 'button' })
export function Help() { return <div><OpenHelp>Help</OpenHelp><HelpDialog>Keys</HelpDialog></div> }
Help.intent = ({ DOM }) => ({ OPEN_HELP: DOM.click(OpenHelp) })
Help.model = { OPEN_HELP: { ELEMENT: { showModal: HelpDialog } } }
` })
    expect(p.check()).toEqual([])
  })

  it('a field focused from a function sink (ternary, ABORT, array): no SYG126', () => {
    const p = project({ 'Form.jsx': `import { controls, ABORT } from 'sygnal'
const { Name, Email, Note, Submit } = controls({ Name: 'input', Email: 'input', Note: 'textarea', Submit: 'button' })
export function Form() { return <form><Name /><Email /><Note /><Submit>Go</Submit></form> }
Form.intent = ({ DOM }) => ({ SUBMIT: DOM.click(Submit) })
Form.model = {
  SUBMIT: { ELEMENT: (s) => {
    if (s.bad) return s.which === 'name' ? { focus: Name } : ABORT
    return [{ focus: Email, preventScroll: true }, { scrollIntoView: Note }]
  } },
}
` })
    expect(only(p.check(), 'SYG126')).toEqual([])
  })

  it('a control neither listened to nor commanded is still SYG126 (info)', () => {
    const p = project({ 'Help.jsx': `import { controls } from 'sygnal'
const { HelpDialog, OpenHelp, Spare } = controls({ HelpDialog: 'dialog', OpenHelp: 'button', Spare: 'span' })
export function Help() { return <div><OpenHelp>Help</OpenHelp><HelpDialog>Keys</HelpDialog><Spare /></div> }
Help.intent = ({ DOM }) => ({ OPEN_HELP: DOM.click(OpenHelp) })
Help.model = { OPEN_HELP: { ELEMENT: { showModal: HelpDialog } } }
` })
    const d = p.check()
    expect(codes(d)).toEqual(['SYG126 info'])
    expect(d[0].data).toEqual({ control: 'Spare' })
  })
})

describe('SYG641 (static): the method of a literal command', () => {
  const src = (cmds, spec = "'input'") => `import { controls } from 'sygnal'
const { Email, Go } = controls({ Email: ${spec}, Go: 'button' })
export function F() { return <div><Email /><Go>go</Go></div> }
F.intent = ({ DOM }) => ({ GO: DOM.click(Go) })
F.model = { GO: { ELEMENT: ${cmds} } }
`

  it('a misspelled documented method: error with the suggestion', () => {
    const d = only(project({ 'F.jsx': src('{ fokus: Email }') }).check(), 'SYG641')
    expect(codes(d)).toEqual(['SYG641 error'])
    expect(d[0].message).toContain("did you mean 'focus'")
    expect(d[0].data).toMatchObject({ method: 'fokus', suggestion: 'focus', control: 'Email' })
  })

  it('a case slip (ShowModal) and a slip inside a function sink and an array', () => {
    const d = only(project({ 'F.jsx': src("(s) => s.a ? { ShowModal: Email } : [{ focus: Email }, { scrollIntoview: '.x' }]") }).check(), 'SYG641')
    expect(d.map(x => x.data.suggestion).sort()).toEqual(['scrollIntoView', 'showModal'])
  })

  it('a DOM-mutating method: error', () => {
    const d = only(project({ 'F.jsx': src('{ remove: Email }') }).check(), 'SYG641')
    expect(codes(d)).toEqual(['SYG641 error'])
    expect(d[0].message).toMatch(/remove\(\) changes the DOM/)
    d.length = 0
    const d2 = only(project({ 'F.jsx': src("{ setAttribute: Email }") }).check(), 'SYG641')
    expect(d2).toHaveLength(1)
  })

  it('documented methods, other element methods (play, requestSubmit, closest) and unknown custom methods: nothing', () => {
    for (const m of [...NATIVE_COMMAND_NAMES, 'play', 'pause', 'requestSubmit', 'reset', 'showPicker', 'closest', 'stepUp', 'openMenu']) {
      expect(only(project({ 'F.jsx': src(`{ ${m}: Email }`) }).check(), 'SYG641'), m).toEqual([])
    }
  })

  it("a spec object's own command (D102) is not reported, even one named like a mutator; a slip of it is", () => {
    const spec = "{ kind: 'widget', vnode: (p, c, h) => h('div', {}, c), commands: { open: (el) => {}, remove: (el) => {} } }"
    expect(only(project({ 'F.jsx': src('{ open: Email }', spec) }).check(), 'SYG641')).toEqual([])
    expect(only(project({ 'F.jsx': src('{ remove: Email }', spec) }).check(), 'SYG641')).toEqual([])
    const d = only(project({ 'F.jsx': src('{ opne: Email }', spec) }).check(), 'SYG641')
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain("did you mean 'open'")
  })

  it('a spec whose commands can not be seen: nothing for a non-documented name', () => {
    expect(only(project({ 'F.jsx': src('{ fokus: Email }', 'SPEC').replace("import { controls } from 'sygnal'", "import { controls } from 'sygnal'\nimport { SPEC } from 'widgets'") }).check(), 'SYG641')).toEqual([])
  })

  it('a computed / spread first key or a non-literal command: nothing', () => {
    expect(only(project({ 'F.jsx': src('{ [s.m]: Email }'.replace('s.m', "'fokus' + ''")) }).check(), 'SYG641')).toEqual([])
    expect(only(project({ 'F.jsx': src('(s) => ({ ...s.cmd, focus: Email })') }).check(), 'SYG641')).toEqual([])
    expect(only(project({ 'F.jsx': src('(s) => s.cmd') }).check(), 'SYG641')).toEqual([])
  })
})

describe('SYG640 (static): a command target the view never renders', () => {
  it('a control declared but not rendered: warning', () => {
    const p = project({ 'Help.jsx': `import { controls } from 'sygnal'
const { HelpDialog, OpenHelp } = controls({ HelpDialog: 'dialog', OpenHelp: 'button' })
export function Help() { return <div><OpenHelp>Help</OpenHelp></div> }
Help.intent = ({ DOM }) => ({ OPEN_HELP: DOM.click(OpenHelp) })
Help.model = { OPEN_HELP: { ELEMENT: { showModal: HelpDialog } } }
` })
    const d = p.check()
    expect(codes(d)).toEqual(['SYG640 warn'])
    expect(d[0].message).toContain('never renders <HelpDialog>')
    expect(d[0].data).toMatchObject({ method: 'showModal', control: 'HelpDialog' })
  })

  it('a control rendered only inside a child component: warning naming the child', () => {
    const p = project({ 'Page.jsx': `import { controls } from 'sygnal'
const { Field, Go } = controls({ Field: 'input', Go: 'button' })
function Inner() { return <div><Field /></div> }
Inner.intent = ({ DOM }) => ({ TYPED: DOM.input(Field) })
Inner.model = { TYPED: (s) => s }
export function Page() { return <div><Inner /><Go>go</Go></div> }
Page.intent = ({ DOM }) => ({ GO: DOM.click(Go) })
Page.model = { GO: { ELEMENT: { focus: Field } } }
` })
    const d = only(p.check(), 'SYG640')
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('only rendered inside child component <Inner>')
  })

  it('a static class selector the view never renders: warning; a rendered one or a dynamic class: nothing', () => {
    const mk = (cls) => project({ 'L.jsx': `import { controls } from 'sygnal'
const { Go } = controls({ Go: 'button' })
export function L({ state }) { return <ul className={${cls}}><li className="row">x</li><Go>go</Go></ul> }
L.initialState = { c: 'a' }
L.intent = ({ DOM }) => ({ GO: DOM.click(Go) })
L.model = { GO: { ELEMENT: { scrollIntoView: '.last-row', block: 'nearest' } } }
` })
    expect(codes(mk("'list'").check())).toEqual(['SYG640 warn'])
    expect(mk('state.c').check()).toEqual([])
  })

  it('a view rendering a tag the checker can not resolve (a parameter, a package component): nothing', () => {
    const p = project({ 'Help.jsx': `import { controls } from 'sygnal'
import { Fancy } from 'fancy-ui'
const { HelpDialog, OpenHelp } = controls({ HelpDialog: 'dialog', OpenHelp: 'button' })
const wrap = (Tag) => <section><Tag>Keys</Tag></section>
export function Help() { return <div><OpenHelp>Help</OpenHelp>{wrap(HelpDialog)}</div> }
Help.intent = ({ DOM }) => ({ OPEN_HELP: DOM.click(OpenHelp) })
Help.model = { OPEN_HELP: { ELEMENT: { showModal: HelpDialog } } }
export function Other() { return <div><Fancy /><OpenHelp>Help</OpenHelp></div> }
Other.intent = ({ DOM }) => ({ OPEN_HELP: DOM.click(OpenHelp) })
Other.model = { OPEN_HELP: { ELEMENT: { showModal: HelpDialog } } }
` })
    expect(only(p.check(), 'SYG640')).toEqual([])
  })

  it('rendered in the view, injected by a parent, or a document selector: nothing', () => {
    expect(project({ 'Help.jsx': DIALOG }).check()).toEqual([])
    const p = project({ 'Shell.jsx': `import { controls } from 'sygnal'
const { Search, Go } = controls({ Search: 'input', Go: 'button' })
function Frame({ children }) { return <div>{children}<Go>go</Go></div> }
Frame.intent = ({ DOM }) => ({ GO: DOM.click(Go) })
Frame.model = { GO: { ELEMENT: [{ focus: Search }, { scrollIntoView: 'body' }] } }
export function Shell() { return <Frame><Search /></Frame> }
Shell.initialState = {}
` })
    expect(only(p.check(), 'SYG640')).toEqual([])
  })
})

// ─── GS-7: timers ────────────────────────────────────────────────────────────

const STOPWATCH = `import { controls } from 'sygnal'
const { Toggle } = controls({ Toggle: 'button' })
export function Stopwatch({ state }) { return <div><p>{state.now}</p><Toggle>go</Toggle></div> }
Stopwatch.initialState = { running: false, now: 0, armed: false, animating: false }
Stopwatch.timers = (state) => ({
  tick: state.running && { every: 100, action: 'TICK' },
  done: state.armed ? { after: 5000, action: 'EXPIRE' } : null,
  frame: state.animating && { frame: 'FRAME', background: true },
})
Stopwatch.intent = ({ DOM }) => ({ TOGGLE: DOM.click(Toggle) })
Stopwatch.model = {
  TOGGLE: (s) => ({ ...s, running: !s.running }),
  TICK: (s, { t }) => ({ ...s, now: t }),
  EXPIRE: (s) => ({ ...s, armed: false }),
  FRAME: (s, { dt }) => ({ ...s, now: s.now + dt }),
}
`

describe('timer actions are triggers', () => {
  it('every / after / frame actions: no SYG102', () => {
    expect(project({ 'Stopwatch.jsx': STOPWATCH }).check()).toEqual([])
  })

  it('the object form (a function per timer) works too', () => {
    const src = STOPWATCH.replace(/Stopwatch\.timers = [\s\S]*?\n\}\)\n/, `Stopwatch.timers = {
  tick: (state) => state.running && { every: 100, action: 'TICK' },
  done: (state) => ({ after: 5000, action: 'EXPIRE' }),
  frame(state) { return state.animating ? { frame: 'FRAME' } : null },
}
`)
    expect(src).toContain('frame(state)')
    expect(project({ 'Stopwatch.jsx': src }).check()).toEqual([])
    expect(codes(project({ 'Stopwatch.jsx': src.replace('every: 100', 'every: 0') }).check())).toEqual(['SYG422 error'])
  })

  it('a block-bodied timers function works too', () => {
    const src = STOPWATCH.replace(/Stopwatch\.timers = [\s\S]*?\n\}\)\n/, `Stopwatch.timers = (state) => {
  const on = state.running
  return { tick: on ? { every: 100, action: 'TICK' } : false, done: { after: 5000, action: 'EXPIRE' }, frame: { frame: 'FRAME' } }
}
`)
    expect(project({ 'Stopwatch.jsx': src }).check()).toEqual([])
  })

  it('an entry no timer names is still SYG102; a timer action with no entry is SYG112 (with the suggestion)', () => {
    const src = STOPWATCH.replace("action: 'TICK'", "action: 'TICKS'")
    const d = project({ 'Stopwatch.jsx': src }).check()
    expect(codes(d)).toEqual(['SYG102 warn', 'SYG112 error'])
    expect(only(d, 'SYG112')[0].message).toContain("Stopwatch.timers names 'TICKS' as a timer action")
    expect(only(d, 'SYG112')[0].data.suggestion).toBe('TICK')
  })

  it('a timers map the checker can not see into lowers SYG102 to info', () => {
    const src = STOPWATCH.replace(/Stopwatch\.timers = [\s\S]*?\n\}\)\n/, 'Stopwatch.timers = (state) => makeTimers(state)\n').replace('FRAME: (s', 'ZZZ: (s')
    const d = project({ 'Stopwatch.jsx': src }).check()
    expect(codes(d).filter(c => c.startsWith('SYG102'))).toEqual(['SYG102 info', 'SYG102 info', 'SYG102 info'])
  })
})

describe('SYG422 (static): literal timer specs', () => {
  const spec = (s) => project({ 'T.jsx': `export function T() { return <p /> }
T.timers = (state) => ({ x: state.on && ${s} })
T.model = { A: (s) => s }
` }).check().filter(d => d.code === 'SYG422')

  it.each([
    ['{ every: 0, action: "A" }', 'every must be a positive number of ms (got 0)'],
    ['{ every: -5, action: "A" }', 'every must be a positive number of ms (got -5)'],
    ['{ every: NaN, action: "A" }', 'every must be a positive number of ms (got NaN)'],
    ['{ every: Infinity, action: "A" }', 'every must be a positive number of ms'],
    ['{ after: -1, action: "A" }', 'after must be a number of ms, 0 or more (got -1)'],
    ['{ every: 100, after: 5, action: "A" }', 'has both every and after'],
    ['{ every: 100 }', 'has no action (a string)'],
    ['{ every: 100, action: "" }', 'has no action (a string)'],
    ['{ every: 100, action: 42 }', 'has no action (a string)'],
    ['{ action: "A" }', 'has neither every nor after'],
    ['{ frame: true }', 'frame must be the action name (a string)'],
    ['{ frame: 1 }', 'frame must be the action name (a string)'],
    ['100', 'is not an object'],
  ])('%s: error', (s, problem) => {
    const d = spec(s)
    expect(codes(d)).toEqual(['SYG422 error'])
    expect(d[0].message).toContain(`Timer 'x' ${problem}`)
  })

  it.each([
    '{ every: 100, action: "A" }',
    '{ after: 0, action: "A" }',
    '{ frame: "A" }',
    '{ every: state.ms, action: "A" }',
    '{ every: 100, action: state.name }',
    '{ every: 100, after: state.after, action: "A" }',
    '{ ...state.spec }',
    'state.spec',
    'false',
    'null',
  ])('%s: nothing (valid, or not decidable)', (s) => {
    expect(spec(s)).toEqual([])
  })
})

describe('SYG643 (static): no driver for timers / connections / resources', () => {
  const app = (drivers, extra = '') => ({
    'src/Stopwatch.jsx': STOPWATCH,
    'src/App.jsx': `import { Stopwatch } from './Stopwatch.jsx'
export function App() { return <main><Stopwatch /></main> }
`,
    'src/main.js': `import { run, makeTimerDriver, makeFetchDriver, makeDOMDriver } from 'sygnal'
import { App } from './App.jsx'
${extra}
run(App, ${drivers})
`,
  })

  it('run() with a literal drivers object and no timer driver: warning at the static', () => {
    const d = only(project(app('{ DOM: makeDOMDriver("#root") }')).check(), 'SYG643')
    expect(codes(d)).toEqual(['SYG643 warn'])
    expect(d[0].message).toContain('Stopwatch declares Stopwatch.timers, but')
    expect(d[0].message).toContain('makeTimerDriver()')
    expect(d[0].file).toBe('src/Stopwatch.jsx')
    expect(d[0].line).toBe(5)
  })

  it('run(App) with no drivers at all: warning', () => {
    expect(only(project(app('')).check(), 'SYG643')).toHaveLength(1)
  })

  it('makeTimerDriver() registered (any key, through a const too): nothing', () => {
    expect(only(project(app('{ TIMER: makeTimerDriver() }')).check(), 'SYG643')).toEqual([])
    expect(only(project(app('{ CLOCK: clock }', 'const clock = makeTimerDriver()')).check(), 'SYG643')).toEqual([])
  })

  it('a drivers object we can not see, a spread, or a driver from a package: nothing', () => {
    expect(only(project(app('drivers', 'import { drivers } from "./drivers.js"')).check(), 'SYG643')).toEqual([])
    expect(only(project(app('{ ...more }', 'const more = getDrivers()')).check(), 'SYG643')).toEqual([])
    expect(only(project(app('{ T: fancyTimers() }', 'import { fancyTimers } from "fancy"')).check(), 'SYG643')).toEqual([])
  })

  it('a local driver whose source mentions a static driver: nothing; a plain local driver: still a warning', () => {
    expect(only(project(app('{ T: wrapped }', 'const wrapped = (sink$) => makeTimerDriver()(sink$)')).check(), 'SYG643')).toEqual([])
    expect(only(project(app('{ LOG: log }', 'const log = (sink$) => { sink$.addListener({ next: console.log }) }')).check(), 'SYG643')).toHaveLength(1)
  })

  it('no run() call in the scanned files, or a component the run() root does not render: nothing', () => {
    const files = app('{ DOM: makeDOMDriver("#root") }')
    delete files['src/main.js']
    expect(only(project(files).check(), 'SYG643')).toEqual([])
    const other = app('{ DOM: makeDOMDriver("#root") }')
    other['src/App.jsx'] = 'export function App() { return <main /> }\n'
    expect(only(project(other).check(), 'SYG643')).toEqual([])
  })

  it('connections and resources too (Collection and Switchable children are followed)', () => {
    const p = project({
      'src/Feed.jsx': `export function Feed() { return <p /> }
Feed.connections = { feed: { url: 'wss://x', message: 'MSG' } }
Feed.model = { MSG: (s) => s }
`,
      'src/Quote.jsx': `export function Quote() { return <p /> }
Quote.resources = { quote: { url: '/q' } }
`,
      'src/App.jsx': `import { Collection, Switchable } from 'sygnal'
import { Feed } from './Feed.jsx'
import { Quote } from './Quote.jsx'
export function App() { return <main><Collection of={Feed} from="feeds" /><Switchable of={{ quote: Quote }} current="quote" /></main> }
App.initialState = { feeds: [] }
`,
      'src/main.js': `import { run, makeFetchDriver } from 'sygnal'
import { App } from './App.jsx'
run(App, { HTTP: makeFetchDriver() })
`,
    })
    const d = only(p.check(), 'SYG643')
    expect(d.map(x => `${x.component} ${x.data.static}`)).toEqual(['Feed connections'])
  })
})

// ─── drift: the lists mirror the runtime's ──────────────────────────────────

describe('drift with the runtime (src/extra)', () => {
  const read = (rel) => fs.readFileSync(path.resolve(here, '../..', rel), 'utf8')

  it('NATIVE_COMMAND_NAMES and DOM_MUTATORS match src/extra/diagnostics/checks/elementCommands.ts', () => {
    const src = read('src/extra/diagnostics/checks/elementCommands.ts')
    const names = /export const NATIVE_COMMAND_NAMES = \[([^\]]*)\]/.exec(src)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1))
    expect(NATIVE_COMMAND_NAMES).toEqual(names)
    expect(DOM_MUTATORS.source).toBe(/const DOM_MUTATORS = \/(.*)\/\n/.exec(src)[1])
  })

  it('STATIC_DRIVERS matches the statics src/extra/diagnostics/checks/timers.ts reports', () => {
    const src = read('src/extra/diagnostics/checks/timers.ts')
    const needs = Object.fromEntries([.../(\w+): '(make\w+)\(\)'/g[Symbol.matchAll](/const NEEDS[^}]*\}/.exec(src)[0])].map(m => [m[1], m[2]]))
    expect(Object.fromEntries(Object.entries(STATIC_DRIVERS).map(([f, s]) => [s, f]))).toEqual(needs)
  })
})

// ─── graph ───────────────────────────────────────────────────────────────────

describe('--graph', () => {
  it('lists ELEMENT commands and timers; validates against the schema', () => {
    const p = project({ 'Help.jsx': DIALOG, 'Stopwatch.jsx': STOPWATCH })
    const g = p.graph()
    expect(validateSchema(schema, g)).toEqual([])
    const help = g.components.find(c => c.name === 'Help')
    expect(help.commands).toEqual([
      { action: 'OPEN_HELP', method: 'showModal', target: 'HelpDialog', control: 'HelpDialog', triggers: ['HELP_CLOSED'] },
      { action: 'CLOSE_HELP', method: 'close', target: 'HelpDialog', control: 'HelpDialog', triggers: ['HELP_CLOSED'] },
    ])
    const sw = g.components.find(c => c.name === 'Stopwatch')
    expect(sw.timers).toEqual([
      { name: 'tick', every: 100, action: 'TICK' },
      { name: 'done', after: 5000, action: 'EXPIRE' },
      { name: 'frame', frame: 'FRAME', background: true },
    ])
    expect(sw.actions.find(a => a.name === 'TICK').trigger).toBe('reply')
    expect(help.timers).toBeUndefined()
    expect(sw.commands).toBeUndefined()
    const text = formatGraph(g)
    expect(text).toContain('commands  OPEN_HELP → showModal HelpDialog (→ HELP_CLOSED), CLOSE_HELP → close HelpDialog (→ HELP_CLOSED)')
    expect(text).toContain('timers    tick every 100 ms → TICK, done after 5000 ms → EXPIRE, frame frame → FRAME')
  })
})
