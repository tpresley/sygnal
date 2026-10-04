/**
 * PLAN-4 3-B: sygnal-check support for persist() (GS-5).
 *
 *   SYG223   a literal pick / omit key of persist({...}) that isn't a key of the component's
 *            literal initialState (with a did-you-mean); silent when either isn't literal
 *   SYG224   persist on a component that a run() call renders but isn't that call's root;
 *            silent when no run() root renders it
 *   PERSIST  a model sink that needs no driver and names no reply action
 *   SYG102   RESTORE (persist's built-in action) counts as triggered when the component persists
 *   STATIC_PROPS has 'persist'
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'
import { STATIC_PROPS } from '../src/model/project.js'
import { NON_REPLY_SINKS } from '../src/model/modelEntries.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

const A11Y = ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708']

function check(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-3b-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const sources = Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(tmp, f))
  return checkFiles(sources, { cwd: tmp, ignore: A11Y })
}
const only = (diags, code) => diags.filter(d => d.code === code)

const todo = (opts, extra = '') => `import { persist } from 'sygnal'
export function TodoApp({ state }) {
  return <ul>{state.todos.map(t => <li>{t}</li>)}<p>{state.filter}</p></ul>
}
TodoApp.initialState = { todos: [], filter: 'all', draft: '' }
TodoApp.model = {
  CLEAR: { STATE: () => ({ todos: [], filter: 'all', draft: '' }), PERSIST: { clear: true } },
  RESTORE: (state, saved) => ({ ...state, ...saved }),
}
TodoApp.persist = persist(${opts})
${extra}`

describe('reserved names', () => {
  it("'persist' is a static and PERSIST a non-reply sink", () => {
    expect(STATIC_PROPS).toContain('persist')
    expect(NON_REPLY_SINKS.has('PERSIST')).toBe(true)
  })
})

describe('SYG223 (static): pick / omit key not in initialState', () => {
  it('reports a pick key with a did-you-mean', () => {
    const d = only(check({ 'TodoApp.jsx': todo(`{ key: 'todo-app', pick: ['todos', 'filtr'] }`) }), 'SYG223')
    expect(d.map(x => x.severity)).toEqual(['warn'])
    expect(d[0].message).toMatch(/'filtr'/)
    expect(d[0].message).toMatch(/did you mean 'filter'/)
    expect(d[0].line).toBe(10)
  })

  it('reports an omit key; the options may be a const', () => {
    const d = only(check({ 'TodoApp.jsx': todo(`OPTS`, `const OPTS = { key: 'todo-app', omit: ['drafts'] }`) }), 'SYG223')
    expect(d.map(x => x.data.key)).toEqual(['drafts'])
  })

  it('nothing when the keys exist, the initialState is not literal, or the options are not', () => {
    expect(only(check({ 'TodoApp.jsx': todo(`{ key: 'todo-app', pick: ['todos', 'filter'] }`) }), 'SYG223')).toEqual([])
    expect(only(check({ 'TodoApp.jsx': todo(`{ key: 'todo-app', pick: ['nope'] }`).replace(`{ todos: [], filter: 'all', draft: '' }\n`, 'makeState()\n') + '\nfunction makeState() { return {} }' }), 'SYG223')).toEqual([])
    expect(only(check({ 'TodoApp.jsx': todo(`{ key: 'todo-app', pick: KEYS }`, 'const KEYS = window.keys') }), 'SYG223')).toEqual([])
  })

  it('PERSIST is no reply sink and RESTORE is triggered: no SYG102 / SYG112', () => {
    const d = check({ 'TodoApp.jsx': todo(`{ key: 'todo-app', pick: ['todos'] }`) })
    expect(d.filter(x => /SYG10[12]|SYG112/.test(x.code)).map(x => x.message)).toEqual([expect.stringMatching(/CLEAR/)])
  })
})

describe('SYG224 (static): persist on a component that is not the run() root', () => {
  const root = (child) => `import { run } from 'sygnal'
import { TodoApp } from './TodoApp.jsx'
function Root({ state }) { return <main><TodoApp state="list" /></main> }
Root.initialState = { list: { todos: [], filter: 'all', draft: '' } }
run(${child ? 'Root' : 'TodoApp'})
`

  it('reports persist on a component the root renders', () => {
    const d = only(check({ 'TodoApp.jsx': todo(`{ key: 'todo-app', pick: ['todos'] }`), 'main.jsx': root(true) }), 'SYG224')
    expect(d.map(x => x.severity)).toEqual(['error'])
    expect(d[0].message).toMatch(/TodoApp/)
    expect(d[0].message).toMatch(/Root/)
    expect(d[0].file).toMatch(/TodoApp\.jsx$/)
  })

  it('nothing when it is the root, or when no run() root is found', () => {
    expect(only(check({ 'TodoApp.jsx': todo(`{ key: 'todo-app', pick: ['todos'] }`), 'main.jsx': root(false) }), 'SYG224')).toEqual([])
    expect(only(check({ 'TodoApp.jsx': todo(`{ key: 'todo-app', pick: ['todos'] }`) }), 'SYG224')).toEqual([])
  })
})
