// PLAN-7 P4-3 (the rest of N-1): class / id tokens, selectors, controls, state keys and Collection
// `from`, context, user behaviors, constants and CHILD.select in the occurrence index
// (src/model/positions.js), and their definition / references (createLookup, and through the
// language server for the log of a definition that finds nothing).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildProject } from '../src/model/project.js'
import { expandInputs } from '../src/files.js'
import { buildIndex, createLookup } from '../src/model/positions.js'
import { tokenSites, evalStrings, tokenize } from '../src/strings.js'
import { selectorTokens, selectorRequirements } from '../src/selectors.js'
import { parseSource } from '../src/ast.js'
import { startServer, tempDir, uriOf } from './lsp-helpers.js'

const cleanup = []
afterEach(() => { for (const f of cleanup.splice(0)) { try { f() } catch { /* gone */ } } })

function temp(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-n1-')))
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

/** The index of a temp project and helpers: at(rel, needle, { nth, offset }), def(), refs(). */
function load(files) {
  const dir = temp(files)
  const { files: list } = expandInputs([dir], { cwd: dir })
  const project = buildProject(list, { cwd: dir })
  const index = buildIndex(project)
  const look = createLookup(index)
  const at = (rel, needle, { nth = 0, offset = 1 } = {}) => {
    const src = fs.readFileSync(path.join(dir, rel), 'utf8')
    let i = -1
    for (let n = 0; n <= nth; n++) { i = src.indexOf(needle, i + 1); if (i < 0) throw new Error(`no ${needle} #${nth} in ${rel}`) }
    i += offset
    const before = src.slice(0, i)
    return look.at(path.join(dir, rel), before.split('\n').length, i - before.lastIndexOf('\n'))
  }
  const text = (o) => fs.readFileSync(o.file, 'utf8').slice(o.start, o.end)
  const show = (list) => list.map(o => `${path.relative(dir, o.file)}:${o.line}:${o.column} ${text(o)}`)
  const def = (rel, needle, opts) => {
    const notes = []
    const list = show(look.definition(at(rel, needle, opts), notes))
    return { list, notes }
  }
  const refs = (rel, needle, opts = {}) => show(look.references(at(rel, needle, opts), opts.includeDeclaration ?? true))
  return { dir, project, index, look, at, def, refs, text, show }
}

describe('strings.js / selectors.js: token sites with offsets (callers unchanged)', () => {
  const expr = (code) => {
    const src = `const BASE = 'card'\nx = ${code}`
    const ast = parseSource(src, 'x.js')
    return { src, node: ast.program.body[1].expression.right }
  }
  const sites = (code) => {
    const { src, node } = expr(code)
    return tokenSites(node, null).map(s => `${s.name}@${src.slice(s.start, s.end) === s.name}`)
  }
  it('literals, template quasis, ?:, &&, +, clsx() arguments and object keys, join', () => {
    expect(sites(`'a  b'`)).toEqual(['a@true', 'b@true'])
    expect(sites('`tpl ${on ? \'on\' : \'off\'} x`')).toEqual(['tpl@true', 'x@true', 'on@true', 'off@true'])
    expect(sites(`clsx('cx', { active: a, 'is-open': b, [k]: c })`)).toEqual(['cx@true', 'active@true', 'is-open@true'])
    expect(sites(`big && 'big'`)).toEqual(['big@true'])
    expect(sites(`'plus ' + 'tile-' + id`)).toEqual(['plus@true', 'tile-@true'])
    expect(sites(`['a', on && 'b'].filter(Boolean).join(' ')`)).toEqual(['a@true', 'b@true'])
    expect(sites(`'esc\\u0061pe'`)).toEqual([]) // escapes: offsets don't map
    // evalStrings / tokenize: unchanged ('tile-' is a pattern, not a name, so callers drop the site)
    expect([...tokenize(evalStrings(expr(`'plus ' + 'tile-' + id`).node, null)).names]).toEqual(['plus'])
  })
  it('selector tokens: the names selectorRequirements reads, every occurrence, with offsets', () => {
    const sel = `ul.list > li.item:not(.done) [data-x=".y"], #main .item`
    const toks = selectorTokens(sel)
    expect(toks.map(t => `${t.kind}:${t.name}:${sel.slice(t.index, t.index + t.length)}`)).toEqual([
      'class:list:list', 'class:item:item', 'id:main:main', 'class:item:item',
    ])
    expect([...new Set(toks.map(t => `${t.kind}:${t.name}`))]).toEqual(selectorRequirements(sel).map(r => `${r.kind}:${r.name}`))
    expect(selectorTokens('div.a#b.c', { hyperscript: true }).map(t => `${t.kind}:${t.name}@${t.index}`)).toEqual(['class:a@4', 'id:b@6', 'class:c@8'])
    expect(selectorTokens('document')).toEqual([])
  })
})

const TOK = `import { h } from 'sygnal'
const BASE = 'card'
function Row() { return <li className="row">r</li> }
function helper(x) { return <em className="helped">{x}</em> }
function Tok({ state }) {
  return (
    <div className="a b" id="main">
      <span className={\`tpl \${state.on ? 'on' : 'off'}\`} />
      <i className={clsx('cx', { active: state.on, 'is-open': state.open })} />
      <b className={state.big ? 'big' : 'small'} />
      <p className={'plus ' + BASE} />
      <u className={'tile-' + state.id} />
      {h('section.hs#hid')}
      {helper(state.x)}
      <Row />
    </div>
  )
}
Tok.intent = ({ DOM }) => ({
  A: DOM.click('.a .b'),
  T: DOM.click('.tpl'),
  O: DOM.click('.on'),
  C: DOM.click('.active'),
  K: DOM.click('.is-open'),
  S: DOM.click('.small'),
  P: DOM.click('.card'),
  H: DOM.click('#hid'),
  E: DOM.click('.helped'),
  R: DOM.click('.row'),
  X: DOM.click('.tile-3'),
  M: DOM.click('#main .hs'),
  N: DOM.click('.nowhere'),
})
Tok.model = { A: (s) => s }
`

describe('view tokens and selector tokens', () => {
  it('every token source is located; a selector token goes to the element(s) rendering it', () => {
    const p = load({ 'Tok.jsx': TOK })
    const rendered = p.index.occurrences.filter(o => o.ns === 'dom' && o.role === 'render').map(o => `${o.kind}:${o.name}`)
    expect(rendered.sort()).toEqual([
      'class:a', 'class:active', 'class:b', 'class:big', 'class:card', 'class:cx', 'class:helped', 'class:hs', 'class:is-open',
      'class:off', 'class:on', 'class:plus', 'class:row', 'class:small', 'class:tpl', 'id:hid', 'id:main',
    ])
    for (const o of p.index.occurrences.filter(o => o.ns === 'dom')) expect(p.text(o)).toBe(o.name)
    const go = (needle, offset = 2) => p.def('Tok.jsx', needle, { offset }).list
    expect(go("'.a .b'")).toEqual(['Tok.jsx:7:21 a'])
    expect(go("'.a .b'", 5)).toEqual(['Tok.jsx:7:23 b']) // the second token of the same selector
    expect(go("'.tpl'")).toEqual(['Tok.jsx:8:25 tpl']) // template quasi
    expect(go("'.on'")).toEqual(['Tok.jsx:8:43 on']) // a ?: branch inside the template
    expect(go("'.active'")).toEqual(['Tok.jsx:9:34 active']) // clsx object key
    expect(go("'.is-open'")).toEqual(['Tok.jsx:9:53 is-open']) // quoted key
    expect(go("'.small'")).toEqual(['Tok.jsx:10:42 small'])
    expect(go("'.card'")).toEqual(['Tok.jsx:2:15 card']) // through the constant BASE (+)
    expect(go("'#hid'")).toEqual(['Tok.jsx:13:22 hid']) // h('section.hs#hid')
    expect(go("'#main .hs'", 8)).toEqual(['Tok.jsx:13:19 hs'])
    expect(go("'.helped'")).toEqual(['Tok.jsx:4:44 helped']) // a helper function's JSX
  })

  it("only in a child (SYG104): the child's element, with a note; dynamic className / not rendered: nothing, with a note", () => {
    const p = load({ 'Tok.jsx': TOK })
    const row = p.def('Tok.jsx', "'.row'", { offset: 2 })
    expect(row.list).toEqual(['Tok.jsx:3:40 row'])
    expect(row.notes[0]).toMatch(/'\.row' is only rendered inside child component <Row>; Tok can't see its DOM events/)
    const tile = p.def('Tok.jsx', "'.tile-3'", { offset: 2 })
    expect(tile.list).toEqual([])
    expect(tile.notes).toEqual(["'.tile-3': Tok's view has dynamic class names and no literal '.tile-3'"])
    const none = p.def('Tok.jsx', "'.nowhere'", { offset: 2 })
    expect(none).toEqual({ list: [], notes: ["'.nowhere' is not rendered in Tok's view"] })
    expect(p.index.components[0].flags).toMatchObject({ dynamicClasses: true, dynamicIds: false })
  })

  it('a view token → the selectors using it (definition and references); includeDeclaration leaves out the elements', () => {
    const p = load({ 'Tok.jsx': TOK })
    expect(p.def('Tok.jsx', 'id="main"', { offset: 5 }).list).toEqual(['Tok.jsx:31:18 main'])
    expect(p.refs('Tok.jsx', 'className="a b"', { offset: 13 })).toEqual(['Tok.jsx:7:23 b', 'Tok.jsx:20:21 b'])
    expect(p.refs('Tok.jsx', 'className="a b"', { offset: 13, includeDeclaration: false })).toEqual(['Tok.jsx:20:21 b'])
    // the child's element: its parent's SYG104 selector
    expect(p.refs('Tok.jsx', 'className="row"', { offset: 12 })).toEqual(['Tok.jsx:3:40 row', 'Tok.jsx:29:18 row'])
    // a plain class with no selector: itself
    expect(p.refs('Tok.jsx', "'big'", { offset: 1 })).toEqual(['Tok.jsx:10:34 big'])
  })

  it('tokens of JSX passed into a child count in the child, not the parent; a behavior option selector', () => {
    const p = load({
      'P.jsx': `import { pager } from 'sygnal'
function Box({ children }) { return <section>{children}</section> }
Box.intent = ({ DOM }) => ({ HIT: DOM.click('.slot') })
Box.model = { HIT: (s) => s }
function P() { return <div><Box><i className="slot" /></Box><button className="nx" /></div> }
P.uses = { pages: pager({ next: '.nx' }) }
`,
    })
    expect(p.def('P.jsx', "'.slot'", { offset: 2 }).list).toEqual(['P.jsx:5:47 slot'])
    expect(p.def('P.jsx', "'.nx'", { offset: 2 }).list).toEqual(['P.jsx:5:80 nx'])
    expect(p.at('P.jsx', "'.nx'", { offset: 2 })[0]).toMatchObject({ behavior: 'pages', role: 'selector' })
  })
})

describe('controls', () => {
  const files = {
    'Ctl.jsx': `import { controls } from 'sygnal'
const { Add, Draft } = controls({ Add: 'button', Draft: 'input' })
function Inner() { return <div><Draft /></div> }
function Ctl() { return <div><Add>+</Add><Inner /></div> }
Ctl.intent = ({ DOM }) => ({ ADD: DOM.click(Add), TYPE: DOM.input(Draft) })
Ctl.model = { ADD: (s) => s, TYPE: (s) => s }
`,
  }
  it('a control selector → its controls() key and its tag; a child-only tag with a note; a tag → the key; a key → the selectors', () => {
    const p = load(files)
    expect(p.def('Ctl.jsx', 'click(Add)', { offset: 6 }).list).toEqual(['Ctl.jsx:2:35 Add', 'Ctl.jsx:4:31 Add'])
    const draft = p.def('Ctl.jsx', 'input(Draft)', { offset: 6 })
    expect(draft.list).toEqual(['Ctl.jsx:2:50 Draft', 'Ctl.jsx:3:33 Draft'])
    expect(draft.notes[0]).toMatch(/control <Draft> is only rendered inside child component <Inner>/)
    expect(p.def('Ctl.jsx', '<Add>', { offset: 1 }).list).toEqual(['Ctl.jsx:2:35 Add'])
    expect(p.def('Ctl.jsx', 'Add: ', { offset: 0 }).list).toEqual(['Ctl.jsx:5:45 Add'])
    expect(p.refs('Ctl.jsx', 'click(Add)', { offset: 6 })).toEqual(['Ctl.jsx:2:35 Add', 'Ctl.jsx:4:31 Add', 'Ctl.jsx:5:45 Add'])
    expect(p.refs('Ctl.jsx', 'click(Add)', { offset: 6, includeDeclaration: false })).toEqual(['Ctl.jsx:4:31 Add', 'Ctl.jsx:5:45 Add'])
  })
})

describe('state keys and Collection from', () => {
  it("from=\"x\" / from={'x'} → the initialState / calculated key; a key → its uses; an item without the key: nothing, noted", () => {
    const p = load({
      'List.jsx': `import { Collection } from 'sygnal'
function Sub() { return <b /> }
function Item() { return <li><Collection of={Sub} from="subs" /></li> }
function List() {
  return <ul><Collection of={Item} from="items" /><Collection of={Item} from={'visible'} /></ul>
}
List.initialState = { items: [], 'other': 1 }
List.calculated = { visible: (s) => s.items }
`,
    })
    expect(p.def('List.jsx', 'from="items"', { offset: 7 }).list).toEqual(['List.jsx:7:23 items'])
    expect(p.def('List.jsx', "from={'visible'}", { offset: 9 }).list).toEqual(['List.jsx:8:21 visible'])
    expect(p.def('List.jsx', 'items: []', { offset: 0 }).list).toEqual(['List.jsx:5:42 items'])
    expect(p.refs('List.jsx', 'items: []', { offset: 0, includeDeclaration: false })).toEqual(['List.jsx:5:42 items'])
    expect(p.at('List.jsx', "'other'")[0]).toMatchObject({ ns: 'state', kind: 'state', role: 'declare', name: 'other' })
    // Item isn't a scanned component (no statics): its from has no occurrence; with statics, a note
    const q = load({
      'L.jsx': `import { Collection } from 'sygnal'
function Item() { return <li><Collection of={Item} from="subs" /></li> }
Item.intent = () => ({})
function L() { return <ul><Collection of={Item} from="items" /></ul> }
L.initialState = { items: [] }
`,
    })
    expect(q.def('L.jsx', 'from="subs"', { offset: 7 })).toEqual({ list: [], notes: ["Item has no initialState or calculated key 'subs' (a Collection item or a child gets its state from its parent)"] })
  })
})

describe('context', () => {
  const files = {
    'App.jsx': `import { Mid } from './Mid.jsx'
function App() { return <main><Mid /></main> }
App.context = { theme: (s) => s.theme, lang: () => 'en' }
App.model = { GO: (s, d, next, props) => props.context.theme }
export default App
`,
    'Mid.jsx': `import { Leaf } from './Leaf.jsx'
export function Mid() { return <div><Leaf /></div> }
Mid.context = { lang: () => 'fr' }
`,
    'Leaf.jsx': `export function Leaf({ context }) { return <i>{context.theme}{context.lang}</i> }
`,
    'Other.jsx': `import { Leaf } from './Leaf.jsx'
function Other({ context: { theme } }) { return <p><Leaf />{theme}</p> }
Other.context = { theme: () => 'dark' }
export default Other
`,
  }
  it('a consumer → the nearest providers on every render path (two levels; two providers); a reducer read; a pattern', () => {
    const p = load(files)
    // Leaf ← Mid ← App, and Leaf ← Other: theme from App and Other; lang stops at Mid
    expect(p.def('Leaf.jsx', 'context.theme', { offset: 9 }).list).toEqual(['App.jsx:3:17 theme', 'Other.jsx:3:19 theme'])
    expect(p.def('Leaf.jsx', 'context.lang', { offset: 9 }).list).toEqual(['Mid.jsx:3:17 lang'])
    // a reducer's props.context.theme: its own context
    expect(p.def('App.jsx', 'context.theme', { offset: 9 }).list).toEqual(['App.jsx:3:17 theme'])
    // a destructured read in a component that provides it itself
    expect(p.def('Other.jsx', '{ theme } }', { offset: 2 }).list).toEqual(['Other.jsx:3:19 theme'])
  })

  it('a provider entry → its consumers; references; nobody provides it: nothing, noted', () => {
    const p = load(files)
    expect(p.def('Mid.jsx', 'lang:', { offset: 0 }).list).toEqual(['Leaf.jsx:1:71 lang'])
    expect(p.refs('App.jsx', 'theme:', { offset: 0 })).toEqual(['App.jsx:3:17 theme', 'App.jsx:4:56 theme', 'Leaf.jsx:1:56 theme'])
    expect(p.refs('App.jsx', 'theme:', { offset: 0, includeDeclaration: false })).toEqual(['App.jsx:4:56 theme', 'Leaf.jsx:1:56 theme'])
    // from a consumer with two providers: both, and every consumer of either
    expect(p.refs('Leaf.jsx', 'context.theme', { offset: 9 })).toEqual([
      'App.jsx:3:17 theme', 'App.jsx:4:56 theme', 'Leaf.jsx:1:56 theme', 'Other.jsx:2:29 theme', 'Other.jsx:3:19 theme',
    ])
    const q = load({ 'A.jsx': `function A({ context }) { return <b>{context.nope}</b> }\nA.intent = () => ({})\n` })
    expect(q.def('A.jsx', 'context.nope', { offset: 9 })).toEqual({ list: [], notes: ["no component rendering A provides context 'nope'"] })
  })
})

describe('user behaviors across files', () => {
  const files = {
    'behavior.js': `import { defineBehavior } from 'sygnal'
export const counter = defineBehavior({
  initialState: { n: 0 },
  intent: ({ DOM }, { button }) => ({ BUMP: DOM.click(button) }),
  model: {
    BUMP: (s, d, next) => { next('RESET'); return s },
    RESET: () => ({ n: 0 }),
    SAVE_IT: { HTTP: () => ({ url: '/x', ok: 'SAVED' }) },
  },
})
`,
    'Host.jsx': `import { counter } from './behavior.js'
function Host() { return <button className="btn" /> }
Host.uses = { c: counter({ button: '.btn' }) }
Host.model = { 'c.BUMP': (s) => s, SAVED: (s) => s }
`,
  }
  it("the definition's own names are occurrences in its file, linked to the host's 'key.ACTION' names", () => {
    const p = load(files)
    const kinds = p.index.occurrences.filter(o => o.kind.startsWith('behavior-')).map(o => `${o.kind} ${o.name} ${path.basename(o.file)}:${o.line}`)
    expect(kinds).toEqual([
      'behavior-intent c.BUMP behavior.js:4', 'behavior-model c.BUMP behavior.js:6', 'behavior-next c.RESET behavior.js:6',
      'behavior-model c.RESET behavior.js:7', 'behavior-model c.SAVE_IT behavior.js:8', 'behavior-reply SAVED behavior.js:8',
    ])
    // the host's extension → the behavior's intent key (and the uses key)
    expect(p.def('Host.jsx', "'c.BUMP'", { offset: 2 }).list).toEqual(['Host.jsx:3:15 c', 'behavior.js:4:39 BUMP'])
    // next('RESET') in the behavior → its own RESET handler
    expect(p.def('behavior.js', "next('RESET')", { offset: 7 }).list).toEqual(['behavior.js:7:5 RESET'])
    // a reply name in the behavior → the host's handler (not namespaced)
    expect(p.def('behavior.js', "'SAVED'", { offset: 1 }).list).toEqual(['Host.jsx:4:36 SAVED'])
    // the uses key → the behavior's handlers and the host's extension
    expect(p.def('Host.jsx', 'c: counter', { offset: 0 }).list).toEqual(['Host.jsx:4:17 c.BUMP', 'behavior.js:6:5 BUMP', 'behavior.js:7:5 RESET', 'behavior.js:8:5 SAVE_IT'])
    expect(p.refs('behavior.js', 'BUMP:', { offset: 0 })).toEqual(['Host.jsx:3:15 c', 'Host.jsx:4:17 c.BUMP', 'behavior.js:4:39 BUMP', 'behavior.js:6:5 BUMP'])
  })

  it("a first-party behavior's option naming a host action (form submit)", () => {
    const p = load({
      'F.jsx': `import { form } from 'sygnal'
function F() { return <form /> }
F.uses = { f: form(null, { submit: 'SIGN_UP' }) }
F.model = { SIGN_UP: (s) => s }
`,
    })
    expect(p.def('F.jsx', "'SIGN_UP'", { offset: 1 }).list).toEqual(['F.jsx:4:13 SIGN_UP'])
    expect(p.def('F.jsx', 'SIGN_UP:', { offset: 0 }).list).toEqual(['F.jsx:3:37 SIGN_UP'])
  })
})

describe('constants', () => {
  it('resolved through module constants (imports, OBJ.KEY, +, templates): the use site with via; dynamic: no occurrence', () => {
    const p = load({
      'names.js': `export const SAVED = 'SAVED'\nexport const A = { GO: 'GO' }\n`,
      'C.jsx': `import { event } from 'sygnal'
import { SAVED, A } from './names.js'
const PRE = 'LOAD'
let mutable = 'X'
function C() { return <b className="b" /> }
C.intent = ({ DOM, EVENTS }) => ({ [A.GO]: DOM.click('.b'), GOT: EVENTS.select(SAVED), MORE: EVENTS.select(mutable) })
C.model = {
  GO: { STATE: (s, d, next) => { next(\`\${PRE}_DONE\`); next(d.kind); return s }, EVENTS: event(SAVED, (s) => s) },
  LOAD_DONE: (s) => s,
}
`,
    })
    const cst = p.index.occurrences.filter(o => o.constant).map(o => `${o.kind} ${o.name} ${p.text(o)} via ${o.via.map(v => v.name).join(',')}`)
    expect(cst).toEqual(['intent GO A.GO via GO', 'select SAVED SAVED via SAVED', 'next LOAD_DONE `${PRE}_DONE` via PRE', 'emit SAVED SAVED via SAVED'])
    expect(p.def('C.jsx', '[A.GO]', { offset: 3 }).list).toEqual(['C.jsx:8:3 GO', 'names.js:2:20 GO'])
    expect(p.def('C.jsx', 'select(SAVED)', { offset: 8 }).list).toEqual(['C.jsx:8:95 SAVED', 'names.js:1:14 SAVED'])
    expect(p.def('C.jsx', '${PRE}', { offset: 3 }).list).toEqual(['C.jsx:3:7 PRE', 'C.jsx:9:3 LOAD_DONE'])
    // let, a parameter's field: dynamic, nothing
    expect(p.at('C.jsx', 'select(mutable)', { offset: 8 })).toEqual([])
    expect(p.at('C.jsx', 'next(d.kind)', { offset: 6 })).toEqual([])
    expect(p.index.flags).toEqual({ dynamicSelected: 1, dynamicEmitted: 0 })
  })
})

describe('CHILD.select', () => {
  it("CHILD.select(Child) → Child's name and its PARENT sink keys; a PARENT key / the name → the CHILD.select calls", () => {
    const p = load({
      'Child.jsx': `export function Child() { return <button className="x" /> }
Child.intent = ({ DOM }) => ({ DEL: DOM.click('.x'), KEEP: DOM.click('.x') })
Child.model = { DEL: { PARENT: (s) => s.id }, 'KEEP | PARENT': (s) => s }
`,
      'Parent.jsx': `import { Child } from './Child.jsx'
function Parent() { return <ul><Child /></ul> }
Parent.intent = ({ CHILD }) => ({ GONE: CHILD.select(Child) })
Parent.model = { GONE: (s) => s }
`,
    })
    expect(p.def('Parent.jsx', 'select(Child)', { offset: 8 }).list).toEqual(['Child.jsx:1:17 Child', 'Child.jsx:3:24 PARENT', 'Child.jsx:3:55 PARENT'])
    expect(p.def('Child.jsx', 'PARENT:', { offset: 0 }).list).toEqual(['Parent.jsx:3:54 Child'])
    expect(p.def('Child.jsx', "'KEEP | PARENT'", { offset: 9 }).list).toEqual(['Parent.jsx:3:54 Child'])
    expect(p.at('Child.jsx', "'KEEP | PARENT'", { offset: 2 }).map(o => o.kind)).toEqual(['model']) // the action part stays an action
    expect(p.refs('Child.jsx', 'function Child', { offset: 10, includeDeclaration: false })).toEqual(['Child.jsx:3:24 PARENT', 'Child.jsx:3:55 PARENT', 'Parent.jsx:3:54 Child'])
  })
})

describe('through the language server', () => {
  it('a selector token navigates; a dynamic className gives null and says so in the trace log', async () => {
    const dir = tempDir({ 'package.json': '{ "name": "p", "private": true }', 'src/Tok.jsx': TOK })
    const client = startServer()
    cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
    await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'p' }], initializationOptions: { trace: { server: 'messages' } } })
    const file = path.join(dir, 'src/Tok.jsx')
    const lines = TOK.split('\n')
    const pos = (needle, offset) => { const line = lines.findIndex(l => l.includes(needle)); return { line, character: lines[line].indexOf(needle) + offset } }
    const req = (needle, offset) => client.request('textDocument/definition', { textDocument: { uri: uriOf(file) }, position: pos(needle, offset) })
    const r = await req("'.small'", 3)
    expect(r).toEqual([{ uri: uriOf(file), range: { start: { line: 9, character: 41 }, end: { line: 9, character: 46 } } }])
    expect(await req("'.tile-3'", 3)).toBeNull()
    const logs = client.messages.filter(m => m.method === 'window/logMessage').map(m => m.params.message)
    expect(logs.some(m => /navigation: '\.tile-3': Tok's view has dynamic class names/.test(m))).toBe(true)
  })
})
