/**
 * PLAN-9 D471: SYG426, a lowercase marker tag (<collection>, <switchable>, <portal>,
 * <transition>, <suspense>, <clientonly>), deprecated in 6.3.0 (rules/syg426-lowercase-markers.js).
 * Always on; --fix renames the tag and adds the import ('sygnal', 'sygnal/vike' for ClientOnly).
 * A plain <slot> is an HTML element (G-480) and isn't reported.
 */
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, fixFiles } from '../src/index.js'

// a directory that doesn't exist: every file is an in-memory source
const ROOT = path.join(os.tmpdir(), 'sygnal-check-d471-virtual-does-not-exist')
const abs = (files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [path.join(ROOT, k), v]))
const check = (files) => checkFiles(Object.keys(abs(files)), { cwd: ROOT, sources: abs(files) })
const fix = (files) => {
  const r = fixFiles(Object.keys(abs(files)), { cwd: ROOT, sources: abs(files) })
  return Object.fromEntries(Object.keys(files).map(k => [k, r.texts.get(path.join(ROOT, k)) ?? files[k]]))
}
const found = (diags) => diags.filter(d => d.code === 'SYG426').map(d => `${d.line}:${d.column} ${d.data.tag}`)

const APP = `import xs from 'xstream'
import { ABORT } from 'sygnal'

function Item({ state }) { return <li>{state.t}</li> }
function Page() { return <p /> }

export function App({ state }) {
  return <div>
    <ul><collection of={Item} from="items" /></ul>
    <collection of={Item} from="more"></collection>
    <switchable of={{ a: Page }} current="a" />
    <clientonly><p /></clientonly>
    <portal target="body"><p /></portal>
    <slot />
  </div>
}
App.initialState = { items: [], more: [] }
`

describe('SYG426: lowercase marker tags', () => {
  it('reports each lowercase marker tag (warn), not <slot> or the capitalized components', () => {
    const d = check({ 'app.jsx': APP, 'ok.jsx': `import { Collection } from 'sygnal'
function Item() { return <li /> }
export function Ok({ state }) { return <ul><Collection of={Item} from="items" /><slot /></ul> }
Ok.initialState = { items: [] }
` })
    expect(found(d)).toEqual(['9:10 collection', '10:6 collection', '11:6 switchable', '12:6 clientonly', '13:6 portal'])
    const first = d.find(x => x.code === 'SYG426')
    expect(first.severity).toBe('warn')
    expect(first.component).toBe('App')
    expect(first.message).toMatch(/deprecated since Sygnal 6\.3\.0 and will be removed in the next major/)
    expect(first.fix).toBe("import { Collection } from 'sygnal' and write <Collection …>")
  })

  it('--fix renames the tags and extends the sygnal import (a new one for sygnal/vike)', () => {
    const out = fix({ 'app.jsx': APP })['app.jsx']
    expect(out).toContain("import { ABORT, Collection, Switchable, Portal } from 'sygnal'\nimport { ClientOnly } from 'sygnal/vike'\n")
    expect(out).toContain('<ul><Collection of={Item} from="items" /></ul>')
    expect(out).toContain('<Collection of={Item} from="more"></Collection>')
    expect(out).toContain('<Switchable of={{ a: Page }} current="a" />')
    expect(out).toContain('<ClientOnly><p /></ClientOnly>')
    expect(out).toContain('<Portal target="body"><p /></Portal>')
    expect(out).toContain('<slot />')
    expect(found(check({ 'app.jsx': out }))).toEqual([])
    // running it again changes nothing
    expect(fix({ 'app.jsx': out })['app.jsx']).toBe(out)
  })

  it('--fix adds an import to a file with none', () => {
    const out = fix({ 'b.jsx': `function Item({ state }) { return <li>{state.t}</li> }
export function B({ state }) { return <ul><collection of={Item} from="items" /></ul> }
B.initialState = { items: [] }
` })['b.jsx']
    expect(out).toBe(`import { Collection } from 'sygnal'
function Item({ state }) { return <li>{state.t}</li> }
export function B({ state }) { return <ul><Collection of={Item} from="items" /></ul> }
B.initialState = { items: [] }
`)
  })

  it('no fix when the name is bound to something else in the file', () => {
    const d = check({ 'c.jsx': `const Collection = 'x'
function Item() { return <li /> }
export function C({ state }) { return <ul><collection of={Item} from="items" /></ul> }
C.initialState = { items: [] }
` })
    const f = d.find(x => x.code === 'SYG426')
    expect(f).toBeTruthy()
    expect(f.fixes).toBeUndefined()
  })
})
