/**
 * PLAN-10 X-1 (D512): graph-wide checks as rules, shipped only because they are measured clean on
 * the examples and the docs samples (dev-plans/research/graph-viz/graph-rules.md).
 *
 *   SYG170  a context field read that neither the reader nor any component above it provides,
 *           reported only when every way up ends at a run() / defineElement() entry
 *   SYG171  a PARENT sink none of the (readable) parents reads with CHILD.select
 *
 * Also: model/renderGraph.js (moved out of graph.js) keeps `--graph` output unchanged (the graph
 * suites' snapshots).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'
import { CODES } from '../src/codes.js'
import { getExplanation } from '../src/explain.js'
import { buildProject } from '../src/model/project.js'
import { findEntries, renderGraph } from '../src/model/renderGraph.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function write(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-x1-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(tmp, f))
}
function check(files, opts = {}) {
  return checkFiles(write(files), { cwd: tmp, ...opts })
}
const only = (diags, code) => diags.filter(d => d.code === code)
const brief = (diags) => diags.map(d => `${d.code} ${d.severity} ${d.file}:${d.line}`)

const MAIN = `import { run } from 'sygnal'
import App from './App.jsx'
run(App)
`
const app = ({ jsx = '<Panel />', imports = "import Panel from './Panel.jsx'", ctx = "{ theme: (s) => s.theme }", intent = '' } = {}) => `${imports}
function App({ state }) {
  return <main>${jsx}</main>
}
App.initialState = { theme: 'dark', rows: [] }
App.context = ${ctx}
${intent}
export default App
`
const PANEL = `export default function Panel({ context }) {
  return <section className={context.theme}>{context.title}</section>
}
`

describe('SYG170: context field read with no provider', () => {
  it('registered (warn, static)', () => {
    expect(CODES.SYG170?.severity).toBe('warn')
    expect(getExplanation('SYG170').reportedBy).toEqual(['static'])
  })

  it('a read nothing above provides, under a run() entry: warn at the read, with the path', () => {
    const d = only(check({ 'src/main.jsx': MAIN, 'src/App.jsx': app(), 'src/Panel.jsx': PANEL }), 'SYG170')
    expect(brief(d)).toEqual(['SYG170 warn src/Panel.jsx:2'])
    expect(d[0].component).toBe('Panel')
    expect(d[0].message).toContain('context.title')
    expect(d[0].message).toContain('App > Panel')
    expect(d[0].data).toEqual({ field: 'title', path: ['App', 'Panel'] })
  })

  it('a near miss is named', () => {
    const panel = `export default function Panel({ context }) { return <p>{context.them}</p> }\n`
    const d = only(check({ 'src/main.jsx': MAIN, 'src/App.jsx': app(), 'src/Panel.jsx': panel }), 'SYG170')
    expect(d[0].message).toContain("did you mean 'theme'")
    expect(d[0].fix).toContain('context.theme')
  })

  it('the root reads its own context, or a reducer reads one nobody provides', () => {
    const own = `function App({ state, context }) { return <p className={context.theme}>{context.lang}</p> }
App.initialState = { theme: 'dark' }
App.context = { theme: (s) => s.theme }
App.intent = ({ DOM }) => ({ GO: DOM.click('p') })
App.model = { GO: (state, data, next, { context }) => (context.user ? state : state) }
export default App
`
    const d = only(check({ 'src/main.jsx': MAIN, 'src/App.jsx': own }), 'SYG170')
    expect(d.map(x => x.data.field).sort()).toEqual(['lang', 'user'])
  })

  it('a deeper provider, a Collection item and a defineElement() entry', () => {
    const row = `export default function Row({ state, context }) { return <li>{context.theme}{context.missing}</li> }\n`
    const files = {
      'src/main.jsx': MAIN,
      'src/App.jsx': app({ jsx: '<Collection of={Row} from="rows" />', imports: "import { Collection } from 'sygnal'\nimport Row from './Row.jsx'" }),
      'src/Row.jsx': row,
    }
    expect(only(check(files), 'SYG170').map(x => x.data.field)).toEqual(['missing'])
    const el = `import { defineElement } from 'sygnal'\nimport App from './App.jsx'\ndefineElement('x-app', App)\n`
    expect(only(check({ ...files, 'src/main.jsx': el }), 'SYG170').map(x => x.data.field)).toEqual(['missing'])
  })

  it('provided by the reader, a parent or a grandparent: nothing', () => {
    const files = { 'src/main.jsx': MAIN, 'src/App.jsx': app({ ctx: '{ theme: (s) => s.theme, title: () => "t" }' }), 'src/Panel.jsx': PANEL }
    expect(only(check(files), 'SYG170')).toEqual([])
  })

  it('stays silent when the chain leaves what the checker sees', () => {
    const base = { 'src/App.jsx': app(), 'src/Panel.jsx': PANEL }
    // no entry: Panel's root App might be rendered with a context elsewhere
    expect(only(check(base), 'SYG170')).toEqual([])
    // an entry whose component can't be resolved (picked at run time)
    const unknown = `import { run } from 'sygnal'\nimport App from './App.jsx'\nexport const start = (C) => run(C)\nrun(App)\n`
    expect(only(check({ ...base, 'src/main.jsx': unknown }), 'SYG170')).toEqual([])
    // the reader is also rendered by a component no entry starts
    const other = `import Panel from './Panel.jsx'\nexport default function Other() { return <div><Panel /></div> }\n`
    expect(only(check({ ...base, 'src/main.jsx': MAIN, 'src/Other.jsx': other }), 'SYG170')).toEqual([])
    // JSX passed into another component: at run time that component is the parent
    const frame = `export default function Frame({ children }) { return <div>{children}</div> }\n`
    const slotted = app({ jsx: '<Frame><Panel /></Frame>', imports: "import Panel from './Panel.jsx'\nimport Frame from './Frame.jsx'" })
    expect(only(check({ ...base, 'src/main.jsx': MAIN, 'src/App.jsx': slotted, 'src/Frame.jsx': frame }), 'SYG170')).toEqual([])
    // a context the checker can't read
    expect(only(check({ ...base, 'src/main.jsx': MAIN, 'src/App.jsx': app({ ctx: '{ ...shared }' }) }), 'SYG170')).toEqual([])
    // a Vike page (the framework wraps it in layouts)
    const page = `export default function Page({ context }) { return <p>{context.user}</p> }\n`
    expect(only(check({ 'pages/index/+Page.jsx': page }), 'SYG170')).toEqual([])
  })
})

const BADGE = (model = "{ PICK: { PARENT: (state) => ({ picked: true }) } }") => `function Badge({ state }) {
  return <button className="pick">x</button>
}
Badge.intent = ({ DOM }) => ({ PICK: DOM.click('.pick') })
Badge.model = ${model}
export default Badge
`
const parent = (intent, jsx = '<Badge />') => app({ jsx, imports: "import Badge from './Badge.jsx'", intent })

describe('SYG171: PARENT sink no parent reads', () => {
  it('registered (warn, static)', () => {
    expect(CODES.SYG171?.severity).toBe('warn')
    expect(getExplanation('SYG171').reportedBy).toEqual(['static'])
  })

  it('a parent with no intent, or one that never selects it: warn at the PARENT sink', () => {
    for (const intent of ['', "App.intent = ({ DOM }) => ({ GO: DOM.click('main') })\nApp.model = { GO: (s) => s }"]) {
      const d = only(check({ 'src/App.jsx': parent(intent), 'src/Badge.jsx': BADGE() }), 'SYG171')
      expect(brief(d), intent).toEqual(['SYG171 warn src/Badge.jsx:5'])
      expect(d[0].component).toBe('Badge')
      expect(d[0].message).toContain('CHILD.select(Badge)')
      expect(d[0].data).toEqual({ child: 'Badge', parents: ['App'], actions: ['PICK'] })
      expect(d[0].related?.[0].message).toBe('App renders <Badge> here')
    }
  })

  it('a Collection item whose host selects another child only', () => {
    const intent = "App.intent = ({ CHILD }) => ({ GO: CHILD.select(Other) })\nApp.model = { GO: (s) => s }"
    const files = {
      'src/App.jsx': parent(intent, '<Collection of={Badge} from="rows" /><Other />').replace("import Badge", "import { Collection } from 'sygnal'\nimport Other from './Other.jsx'\nimport Badge"),
      'src/Badge.jsx': BADGE(),
      'src/Other.jsx': BADGE().replaceAll('Badge', 'Other'),
    }
    expect(brief(only(check(files), 'SYG171'))).toEqual(['SYG171 warn src/Badge.jsx:5'])
  })

  it('read with CHILD.select (destructured or through sources): nothing', () => {
    for (const intent of [
      "App.intent = ({ CHILD }) => ({ GO: CHILD.select(Badge) })",
      "App.intent = (sources) => ({ GO: sources.CHILD.select(Badge) })",
      "App.intent = (sources) => { const { CHILD: c } = sources; return { GO: c.select(Badge) } }",
    ]) {
      expect(only(check({ 'src/App.jsx': parent(intent + '\nApp.model = { GO: (s) => s }'), 'src/Badge.jsx': BADGE() }), 'SYG171'), intent).toEqual([])
    }
  })

  it('selected by some other component (SYG129 reports a wrong level): nothing here', () => {
    const files = {
      'src/App.jsx': app({ jsx: '<Mid />', imports: "import Mid from './Mid.jsx'\nimport Badge from './Badge.jsx'", intent: 'App.intent = ({ CHILD }) => ({ GO: CHILD.select(Badge) })\nApp.model = { GO: (s) => s }' }),
      'src/Mid.jsx': "import Badge from './Badge.jsx'\nexport default function Mid() { return <div><Badge /></div> }\n",
      'src/Badge.jsx': BADGE(),
    }
    const d = check(files)
    expect(only(d, 'SYG171')).toEqual([])
    expect(only(d, 'SYG129')).toHaveLength(1)
  })

  it('stays silent when a parent might read it in a way the checker cannot see', () => {
    for (const intent of [
      "const setup = (CHILD) => CHILD.select(Badge)\nApp.intent = ({ CHILD }) => ({ GO: setup(CHILD) })", // a helper
      "App.intent = ({ DOM, ...rest }) => ({ GO: DOM.click('main') })",                               // a rest pattern
      "App.intent = (sources) => ({ GO: pick(sources) })",                                            // sources passed on
      "App.intent = ({ CHILD }) => ({ GO: CHILD.select(pages.badge) })",                              // a select it can't resolve
      "App.intent = intentFromElsewhere",                                                              // an intent it can't read
      "App.uses = { f: someBehavior }",                                                                // a behavior may read CHILD
    ]) {
      expect(only(check({ 'src/App.jsx': parent(intent), 'src/Badge.jsx': BADGE() }), 'SYG171'), intent).toEqual([])
    }
  })

  it('rendered by nothing scanned, or passed into another component: nothing', () => {
    expect(only(check({ 'src/Badge.jsx': BADGE() }), 'SYG171')).toEqual([])
    const frame = `export default function Frame({ children }) { return <div>{children}</div> }\n`
    const files = { 'src/App.jsx': parent('', '<Frame><Badge /></Frame>').replace("import Badge", "import Frame from './Frame.jsx'\nimport Badge"), 'src/Frame.jsx': frame, 'src/Badge.jsx': BADGE() }
    expect(only(check(files), 'SYG171')).toEqual([])
  })
})

describe('model/renderGraph.js', () => {
  it('findEntries tells run(), defineElement() and Vike entries apart', () => {
    const files = write({
      'src/main.jsx': MAIN,
      'src/el.jsx': "import { defineElement } from 'sygnal'\nimport Panel from './Panel.jsx'\ndefineElement('x-panel', Panel)\n",
      'src/App.jsx': app(), 'src/Panel.jsx': PANEL,
      'pages/index/+Page.jsx': 'export default function Page() { return <p /> }\n',
    })
    const project = buildProject(files, { cwd: tmp })
    const e = findEntries(project)
    expect(e.unknown).toBe(false)
    expect(e.refs.map(r => r.via).sort()).toEqual(['element', 'run', 'vike'])
    const g = renderGraph(project)
    expect(renderGraph(project)).toBe(g)
    const panel = g.units.find(u => u.name === 'Panel')
    expect(g.parentsOf.get(panel).map(p => [p.unit.name, p.via])).toEqual([['App', 'tag']])
  })
})
