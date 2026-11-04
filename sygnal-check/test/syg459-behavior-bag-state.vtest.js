/**
 * SYG459 (7.2, N6): a wizard / form option reads a host-state field off its bag
 * (rules/syg459-behavior-bag-state.js). --fix reads it from the bag's state.
 */
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, fixFiles } from '../src/index.js'

const ROOT = path.join(os.tmpdir(), 'sygnal-check-syg459-virtual-does-not-exist')
const FILE = path.join(ROOT, 'App.jsx')
const check = (src) => checkFiles([FILE], { cwd: ROOT, sources: { [FILE]: src } })
const found = (src) => check(src).filter(d => d.code === 'SYG459')
const fix = (src) => fixFiles([FILE], { cwd: ROOT, sources: { [FILE]: src } }).texts.get(FILE) ?? src

const host = (opts, { view = 'function Host({ title }) { return <div><Outlet of={{ a: A, b: B }} from="wizard" /></div> }', before = '' } = {}) => `import { run, wizard, form, Outlet } from 'sygnal'
function A() { return <p>a</p> }
function B() { return <p>b</p> }
${view}
Host.initialState = { session: 'S1', route: null, values: {} }
${before}
Host.uses = { wizard: wizard(${opts}) }
run(Host)
`

describe('SYG459: a host-state field read off a behavior bag', () => {
  it('reports the pre-7.2 wizard form in each covered option (warn)', () => {
    for (const o of [
      `{ steps: { a: {}, b: { when: (s, h) => h.session === 'S1' } } }`,
      `{ steps: { a: { valid: (s, { route }) => !!route } } }`,
      `{ steps: { a: { label: (s, h) => h.session } } }`,
      `{ steps: { a: { dirty: (s, name, h) => !!h.route } } }`,
      `{ steps: { a: {} }, key: (st, h) => h.session }`,
      `{ steps: { a: {} }, draft: (st, { session }) => ({ s: session }) }`,
      `{ steps: { a: {} }, dirty: (w, name, h) => !!h.session }`,
      `{ steps: { a: {} }, url: { route: 'step', param: 'step', from: (st, h) => h.route } }`,
      `{ steps: { a: {} }, groups: { g: { label: (s, h) => h.session } } }`,
    ]) {
      const d = found(host(o))
      expect(d, o).toHaveLength(1)
      expect(d[0].severity, o).toBe('warn')
      expect(d[0].message, o).toMatch(/reads '(session|route)' off its bag/)
    }
  })

  it('reports a form option', () => {
    const src = host('{ steps: { a: {} } }').replace("Host.uses = { wizard: wizard({ steps: { a: {} } }) }",
      "const schema = { '~standard': { version: 1, vendor: 'x', validate: (v) => ({ value: v }) } }\nHost.uses = { form: form(schema, { values: (st, h) => h.values, request: (data, st, { route }) => ({ url: '/x', route }) }) }")
    expect(found(src).map(d => d.data.option).sort()).toEqual(['request', 'values'])
  })

  it('follows a steps const', () => {
    expect(found(host('{ steps: STEPS }', { before: "const STEPS = { a: { when: (s, h) => h.session != null } }" }))).toHaveLength(1)
  })

  it("doesn't report bag.state, the bag's own keys, a prop the host takes, or a name the state doesn't have", () => {
    for (const o of [
      `{ steps: { a: { when: (s, { state }) => state.session === 'S1' } } }`,
      `{ steps: { a: { when: (s, h) => h.state.route != null && h.context && h.uid } } }`,
      `{ steps: { a: { label: (s, { title }) => title } } }`,
      `{ steps: { a: { when: (s, h) => h.other } } }`,
      `{ steps: { a: { when: (s) => !!s.draft } } }`,
    ]) expect(found(host(o)), o).toEqual([])
    // a prop of the same name as a state key: the bag's prop is what it reads
    expect(found(host(`{ steps: { a: { when: (s, h) => h.session } } }`, { view: 'function Host({ session }) { return <div><Outlet of={{ a: A, b: B }} from="wizard" /></div> }' }))).toEqual([])
  })

  it('--fix reads it from the bag state', () => {
    expect(fix(host(`{ steps: { a: { when: (s, h) => h.session === 'S1' } } }`))).toContain(`(s, h) => h.state.session === 'S1'`)
    expect(fix(host(`{ steps: { a: { valid: (s, { route }) => !!route } } }`))).toContain(`(s, { state: { route } }) => !!route`)
    // a pattern with other keys: reported, not rewritten
    const mixed = host(`{ steps: { a: { valid: (s, { route, title }) => !!route && title } } }`)
    expect(found(mixed)).toHaveLength(1)
    expect(fix(mixed)).toContain('(s, { route, title })')
  })
})
