/**
 * PLAN-4.6 R5: SYG612 statically, the forms Sygnal 6.0 removed that no other rule finds
 * (05-migration-guide §4), always on, with --fix for the ones that only need deleting.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { check } from '../src/index.js'
import { fixFiles } from '../src/fix.js'

let dir
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null })

function setup(source) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-removed-'))
  const file = path.join(dir, 'App.jsx')
  fs.writeFileSync(file, source)
  return file
}
const run = (source, options = {}) => check([setup(source)], { cwd: dir, ...options }).filter(d => d.code === 'SYG612')

describe('SYG612: forms 6.0 removed (static)', () => {
  it('statics: components, peers, hmrActions, storeCalculatedInState, source names, and label on a component', () => {
    const found = run(`
import Badge from './Badge'
function App({ state }) { return <div>{state.n}</div> }
App.initialState = { n: 0 }
App.components = { Badge }
App.peers = { Badge }
App.hmrActions = ['RELOAD']
App.storeCalculatedInState = false
App.DOMSourceName = 'DOM'
App.stateSourceName = 'APP'
App.label = 'Main'
const config = {}
config.label = 'not a component'
`)
    expect(found.map(d => d.data.form)).toEqual(['components', 'peers', 'hmractions', 'storecalculatedinstate', 'source-names', 'source-names', 'leftovers'])
    expect(found.every(d => d.severity === 'error')).toBe(true)
    expect(found[0].fix).toContain('https://sygnal.js.org/guide/migrating-to-6#components')
  })

  it("the removed factories imported from 'sygnal', <Collection of=\"Name\"> and idfield", () => {
    const found = run(`
import { component, Collection } from 'sygnal'
function List({ state }) { return <ul><Collection of="Row" from="rows" idfield="key" /></ul> }
List.initialState = { rows: [] }
`)
    expect(found.map(d => d.data.form)).toEqual(['component-factory', 'collection-of-name', 'leftovers'])
  })

  it('the canonical forms report nothing', () => {
    const found = run(`
import { defineComponent, Collection } from 'sygnal'
function Row({ state }) { return <li>{state.title}</li> }
function List({ state }) { return <ul><Collection of={Row} from="rows" /></ul> }
List.initialState = { rows: [] }
List.componentName = 'TheList'
export const Counter = defineComponent({ name: 'Counter', view: ({ state }) => <b>{state.n}</b>, initialState: { n: 0 } })
`)
    expect(found).toEqual([])
  })

  it('--fix removes storeCalculatedInState and default source names, and leaves the rest', () => {
    const file = setup(`function App({ state }) { return <div>{state.n}</div> }
App.initialState = { n: 0 }
App.storeCalculatedInState = false
App.DOMSourceName = 'DOM'
App.stateSourceName = 'APP'
`)
    fixFiles([file], { cwd: dir })
    const out = fs.readFileSync(file, 'utf8')
    expect(out).not.toContain('storeCalculatedInState')
    expect(out).not.toContain('DOMSourceName')
    expect(out).toContain("App.stateSourceName = 'APP'")
  })

  it('G-336: the statics on objects, parameters and drafts are not components', () => {
    const found = run(`
function App({ state }) { return <div>{state.peers.length}</div> }
App.initialState = { peers: [] }
App.model = {
  RESET: (state) => { const draft = { ...state }; draft.peers = []; return draft },
}
const registry = {}
registry.components = { App }
const cfg = { stateSourceName: 'X' }
cfg.stateSourceName = 'STATE'
cfg.DOMSourceName = 'DOM'
function setup(options) { options.hmrActions = []; options.storeCalculatedInState = true }
`)
    expect(found).toEqual([])
  })

  it('G-336: a view-only function with a removed static is still reported', () => {
    const found = run(`
import Badge from './Badge'
function Layout() { return <main><Badge /></main> }
Layout.components = { Badge }
const Side = () => <aside />
Side.peers = { Badge }
`)
    expect(found.map(d => d.data.form)).toEqual(['components', 'peers'])
  })

  it('G-336: --fix leaves stateSourceName on a plain object', () => {
    const file = setup(`const cfg = {}
cfg.stateSourceName = 'STATE'
export default cfg
`)
    fixFiles([file], { cwd: dir })
    expect(fs.readFileSync(file, 'utf8')).toContain("cfg.stateSourceName = 'STATE'")
  })

  it("G-336: <Collection> is only sygnal's (a local Collection component is not checked)", () => {
    const local = run(`
function Collection({ of, idfield }) { return <section>{of}{idfield}</section> }
Collection.initialState = {}
function App() { return <Collection of="books" idfield="isbn" /> }
`)
    expect(local).toEqual([])
    const aliased = run(`
import { Collection as List } from 'sygnal'
function App() { return <List of="Row" from="rows" /> }
App.initialState = { rows: [] }
`)
    expect(aliased.map(d => d.data.form)).toEqual(['collection-of-name'])
  })

  it('G-337: --fix does not delete a statement that is the body of an if (the next one would become it)', () => {
    const src = `function App({ state }) { return <div>{state.n}</div> }
App.initialState = { n: 0 }
if (import.meta.env.DEV) App.storeCalculatedInState = true
App.model = { INC: (state) => ({ n: state.n + 1 }) }
`
    const found = run(src)
    expect(found.map(d => d.data.form)).toEqual(['storecalculatedinstate'])
    expect(found[0].edits).toBeFalsy()
    const file = setup(src)
    fixFiles([file], { cwd: dir })
    expect(fs.readFileSync(file, 'utf8')).toBe(src)
  })

  it('G-337: --fix still removes it inside a block', () => {
    const file = setup(`function App({ state }) { return <div>{state.n}</div> }
App.initialState = { n: 0 }
if (import.meta.env.DEV) {
  App.storeCalculatedInState = true
}
App.model = { INC: (state) => ({ n: state.n + 1 }) }
`)
    fixFiles([file], { cwd: dir })
    const out = fs.readFileSync(file, 'utf8')
    expect(out).not.toContain('storeCalculatedInState')
    expect(out).toContain('App.model = {')
  })
})
