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
})
