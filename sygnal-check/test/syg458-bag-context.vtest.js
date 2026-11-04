/**
 * SYG458 (7.2): a declaration static (resources, timers, connections, head, browser, route) reads a
 * context field off its second argument, the bag (rules/syg458-bag-context-field.js). --fix moves
 * the keys into the pattern's `context: { … }`.
 */
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, fixFiles } from '../src/index.js'

// a directory that doesn't exist: every file is an in-memory source
const ROOT = path.join(os.tmpdir(), 'sygnal-check-syg458-virtual-does-not-exist')
const FILE = path.join(ROOT, 'App.jsx')
const check = (src) => checkFiles([FILE], { cwd: ROOT, sources: { [FILE]: src } })
const found = (src) => check(src).filter(d => d.code === 'SYG458')
const fix = (src) => fixFiles([FILE], { cwd: ROOT, sources: { [FILE]: src } }).texts.get(FILE) ?? src

const app = (statics, { page = 'function Page() { return <p>x</p> }', use = '<Page state="page" />' } = {}) => `import { run } from 'sygnal'
${page}
${statics}
Page.model = { POLL: (s) => s }
function App() { return <main>${use}</main> }
App.initialState = { route: { params: { id: '1' } }, user: null, page: {} }
App.context = { route: (s) => s.route, user: (s) => s.user }
run(App)
`

describe('SYG458: a context field read off the bag', () => {
  it('reports a context key in the pattern, in each static form (warn)', () => {
    for (const st of [
      `Page.resources = { item: (s, { route }) => '/api/' + route.params.id }`,
      `Page.resources = (s, { route }) => ({ item: '/api/' + route.params.id })`,
      `Page.timers = (s, { route }) => ({ poll: { every: 1000, action: 'POLL', r: route } })`,
      `const conns = (s, { route }) => ({ feed: { sse: '/e/' + route.params.id } })\nPage.connections = conns`,
      `Page.head = { title: (s, { route }) => route.params.id }`,
      `Page.browser = (s, { route }) => ({})`,
      `Page.route = (s, { route } = {}) => route`,
    ]) {
      const d = found(app(st))
      expect(d, st).toHaveLength(1)
      expect(d[0].severity).toBe('warn')
      expect(d[0].component).toBe('Page')
      expect(d[0].message).toContain("'route'")
      expect(d[0].message).toMatch(/the bag .*until 8\.0/)
      expect(d[0].message).not.toContain('also takes a prop')
    }
  })

  it('names the static and every key in one finding', () => {
    const [d] = found(app(`Page.resources = { item: (s, { id, route, user: u }) => '/api/' + route + u + id }`))
    expect(d.message).toMatch(/^Page\.resources\.item reads the context fields 'route', 'user' off its second argument/)
    expect(d.data).toEqual({ static: 'resources.item', keys: ['route', 'user'] })
    expect(d.fix).toBe("read them from the bag's context: (state, { context: { route, user } }) => …")
  })

  it('is silent for state / context / uid, keys no .context declares (props), and the canonical form', () => {
    expect(found(app(`Page.resources = { item: (s, { state, uid, context: { route } }) => '/api/' + route.params.id + uid }
Page.timers = (s, { id, label }) => ({ poll: { every: 1000, action: 'POLL', id, label } })
Page.head = (s, b) => ({ title: b.context.user + b.id + b.state.x })`))).toEqual([])
    // no .context anywhere: nothing is a context field
    const noCtx = app(`Page.resources = { item: (s, { route }) => '/api/' + route }`).replace("App.context = { route: (s) => s.route, user: (s) => s.user }\n", '')
    expect(found(noCtx)).toEqual([])
  })

  it('says the prop wins when the component also takes a prop of that name', () => {
    const viaView = found(app(`Page.resources = { item: (s, { route }) => '/api/' + route }`, { page: 'function Page({ state, route }) { return <p>{route}</p> }' }))
    expect(viaView).toHaveLength(1)
    expect(viaView[0].message).toContain("Page also takes a prop 'route', which the bag's own key wins over: this reads the prop, not the context field")
    const viaUsage = found(app(`Page.resources = { item: (s, { user }) => '/api/' + user }`, { use: '<Page state="page" user="me" />' }))
    expect(viaUsage).toHaveLength(1)
    expect(viaUsage[0].message).toContain("Page also takes a prop 'user'")
  })

  it('reports member reads off a plain parameter, with no fix', () => {
    const d = found(app(`Page.timers = (s, ctx) => ({ poll: { every: ctx.route ? 1000 : 0, action: 'POLL', u: ctx['user'], id: ctx.id } })
Page.head = (s, b) => { const { route } = b; return { title: route.params.id } }`))
    expect(d.map(x => `${x.line}:${x.column} ${x.data.keys[0]} ${x.data.static}`)).toEqual([
      '3:49 route timers', '3:90 user timers', '4:33 route head',
    ])
    expect(d[0].fix).toBe("read it from the bag's context: ctx.context.route")
    // ctx.id is a prop read: no fix for timers; head only reads context fields
    expect(d.filter(x => x.data.static === 'timers').every(x => !x.fixes?.length)).toBe(true)
    expect(d.find(x => x.data.static === 'head').fixes).toHaveLength(1)
  })

  it('--fix moves context keys into context: { … }, keeping the others at the top level', () => {
    const out = (st) => fix(app(st)).split('\n')[2]
    expect(out(`Page.resources = { item: (s, { route, user: u }) => '/api/' + route + u }`))
      .toBe(`Page.resources = { item: (s, { context: { route, user: u } }) => '/api/' + route + u }`)
    expect(out(`Page.resources = { item: (s, { id, route }) => '/api/' + route + id }`))
      .toBe(`Page.resources = { item: (s, { id, context: { route } }) => '/api/' + route + id }`)
    expect(out(`Page.timers = (s, { route, id, user = null }) => ({ poll: { every: 1, action: 'POLL', route, id, user } })`))
      .toBe(`Page.timers = (s, { context: { route, user = null }, id }) => ({ poll: { every: 1, action: 'POLL', route, id, user } })`)
    // with a default for the whole parameter
    expect(out(`Page.route = (s, { route } = {}) => route`)).toBe(`Page.route = (s, { context: { route } } = {}) => route`)
    // the result is clean
    expect(found(fix(app(`Page.resources = { item: (s, { id, route }) => '/api/' + route + id }`)))).toEqual([])
  })

  it('--fix merges into an existing context: { … } entry', () => {
    const out = (st) => fix(app(st)).split('\n')[2]
    expect(out(`Page.head = (s, { route, context: { user } }) => ({ title: route + user })`))
      .toBe(`Page.head = (s, { context: { user, route } }) => ({ title: route + user })`)
    expect(out(`Page.head = (s, { context: { user } = {}, id, route }) => ({ title: route + user + id })`))
      .toBe(`Page.head = (s, { context: { user, route } = {}, id }) => ({ title: route + user + id })`)
  })

  it('reports without a fix when the pattern has a rest element or a context binding', () => {
    for (const st of [
      `Page.head = (s, { route, ...rest }) => ({ title: route + rest.id })`,
      `Page.head = (s, { route, context: ctx }) => ({ title: route + ctx.user })`,
    ]) {
      const d = found(app(st))
      expect(d, st).toHaveLength(1)
      expect(d[0].fixes ?? [], st).toEqual([])
      expect(fix(app(st))).toBe(app(st))
    }
  })

  const tsFix = (st) => {
    const file = path.join(ROOT, 'App.tsx')
    const src = app(st)
    return (fixFiles([file], { cwd: ROOT, sources: { [file]: src } }).texts.get(file) ?? src).split('\n')[2]
  }
  const tsFound = (st) => {
    const file = path.join(ROOT, 'App.tsx')
    return checkFiles([file], { cwd: ROOT, sources: { [file]: app(st) } }).filter(d => d.code === 'SYG458')
  }

  it('--fix rewrites a type literal annotation with the pattern', () => {
    expect(tsFix(`Page.resources = { item: (s: any, { id, route }: { id: string, route: any }) => '/api/' + route + id }`))
      .toBe(`Page.resources = { item: (s: any, { id, context: { route } }: { id: string, context: { route: any } }) => '/api/' + route + id }`)
    expect(tsFix(`Page.head = (s: any, { route, user }: { route: any; user?: string }) => ({ title: route + user })`))
      .toBe(`Page.head = (s: any, { context: { route, user } }: { context: { route: any; user?: string } }) => ({ title: route + user })`)
    // merged into the annotation's existing context member
    expect(tsFix(`Page.head = (s: any, { route, context: { user } }: { route: any; context: { user: string } }) => ({ title: route + user })`))
      .toBe(`Page.head = (s: any, { context: { user, route } }: { context: { user: string; route: any } }) => ({ title: route + user })`)
  })

  it('--fix wraps another annotation in { context: … } when every key moves', () => {
    expect(tsFix(`type Ctx = { route: any }\nPage.resources = { item: (s: any, { route }: Ctx) => '/api/' + route }`.split('\n')[1]))
      .toBe(`Page.resources = { item: (s: any, { context: { route } }: { context: Ctx }) => '/api/' + route }`)
    expect(tsFix(`Page.head = (s: any, { route, user }: Pick<Ctx, 'route' | 'user'>) => ({ title: route + user })`))
      .toBe(`Page.head = (s: any, { context: { route, user } }: { context: Pick<Ctx, 'route' | 'user'> }) => ({ title: route + user })`)
  })

  it('leaves the code alone, saying why, when the annotation cannot be rewritten', () => {
    for (const [st, why] of [
      [`Page.head = (s: any, { id, route }: Props) => ({ title: route + id })`, "its type annotation (Props) types the bag's other keys too"],
      [`Page.head = (s: any, { route }: Ctx = {} as Ctx) => ({ title: route })`, 'the typed parameter has a default value'],
      [`Page.head = (s: any, { route, context: { user } }: { route: any; context: Ctx }) => ({ title: route + user })`, "the type annotation's 'context' (Ctx) is not a type literal"],
    ]) {
      const d = tsFound(st)
      expect(d, st).toHaveLength(1)
      expect(d[0].message, st).toContain('--fix leaves it: ' + why)
      expect(d[0].fixes ?? [], st).toEqual([])
      expect(tsFix(st), st).toBe(st)
    }
  })

  it('--fix takes the bag\'s context for a plain parameter that only reads context fields', () => {
    const st = `Page.head = (s: any, context: Ctx) => ({ title: context.user })`
    const [d] = tsFound(st)
    expect(d.message).toContain("reads the context field 'user'")
    expect(d.fix).toBe("take the bag's context: (state, { context }) => …")
    expect(tsFix(st)).toBe(`Page.head = (s: any, { context }: { context: Ctx }) => ({ title: context.user })`)
    expect(fix(app(`Page.head = (s, b) => { const { route } = b; return { title: b.user + route } }`)).split('\n')[2])
      .toBe(`Page.head = (s, { context: b }) => { const { route } = b; return { title: b.user + route } }`)
    expect(found(fix(app(`Page.head = (s, b) => ({ title: b.user + b.route })`)))).toEqual([])
    // a prop or state read, the bag passed on, or a default: reported, no fix
    for (const st of [
      `Page.head = (s, b) => ({ title: b.user + b.id })`,
      `Page.head = (s, b) => ({ title: b.user + b.state.x })`,
      `Page.head = (s, b) => ({ title: b.user, all: b })`,
      `Page.head = (s, b = {}) => ({ title: b.user })`,
    ]) {
      const d = found(app(st))
      expect(d, st).toHaveLength(1)
      expect(d[0].fixes ?? [], st).toEqual([])
      expect(d[0].fix, st).toBe("read it from the bag's context: b.context.user")
    }
  })

  it('follows the bag into a same-module helper', () => {
    const helper = `function boundId(context) { return context.route.params.id }\n`
    const st = helper.trim() + `\nPage.resources = { bound: (_s, context) => '/api/' + boundId(context) }`
    const d = found(app(st))
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/^Page\.resources\.bound passes its second argument, the bag, to boundId\(\), which reads the context field 'route' off it/)
    expect(d[0].data).toEqual({ static: 'resources.bound', keys: ['route'], helper: 'boundId' })
    expect(`${d[0].line}:${d[0].column}`).toBe('4:62')
    expect(fix(app(st)).split('\n')[3]).toBe(`Page.resources = { bound: (_s, { context }) => '/api/' + boundId(context) }`)
    expect(found(fix(app(st)))).toEqual([])
    // a pattern parameter, a helper of a helper, an arrow helper
    for (const h of [
      `function boundId({ route }) { return route.params.id }`,
      `const inner = (c) => c.route.params.id\nfunction boundId(b) { return inner(b) }`,
      `const boundId = (b) => { const { route, user } = b; return route.params.id + user }`,
    ]) {
      const d = found(app(h + `\nPage.resources = { bound: (_s, ctx) => '/api/' + boundId(ctx) }`))
      expect(d, h).toHaveLength(1)
      expect(d[0].data.helper, h).toBe('boundId')
      expect(d[0].fixes, h).toHaveLength(1)
    }
    // the helper also reads a prop: reported, no fix
    const mixed = found(app(`function boundId(b) { return b.route.params.id + b.id }\nPage.resources = { bound: (_s, b) => boundId(b) }`))
    expect(mixed).toHaveLength(1)
    expect(mixed[0].fixes ?? []).toEqual([])
    expect(mixed[0].fix).toBe("pass the bag's context: boundId(b.context)")
  })

  it('is silent for a helper it cannot see or one that reads no context field', () => {
    expect(found(app(`import { boundId } from './ids'\nPage.resources = { bound: (_s, b) => boundId(b) }`))).toEqual([])
    expect(found(app(`Page.resources = { bound: (_s, b) => window.boundId(b) }`))).toEqual([])
    expect(found(app(`function idOf(b) { return b.id }\nPage.resources = { bound: (_s, b) => idOf(b) }`))).toEqual([])
    expect(found(app(`function loop(b) { return loop(b) }\nPage.resources = { bound: (_s, b) => loop(b) }`))).toEqual([])
  })

  it('keeps a TypeScript annotation on the parameter', () => {
    const file = path.join(ROOT, 'App.tsx')
    const src = app(`Page.resources = { item: (s: any, { id, route }: { id: string, route: any }) => '/api/' + route + id }`)
    const out = fixFiles([file], { cwd: ROOT, sources: { [file]: src } }).texts.get(file)
    expect(out.split('\n')[2]).toBe(`Page.resources = { item: (s: any, { id, context: { route } }: { id: string, context: { route: any } }) => '/api/' + route + id }`)
  })
})
