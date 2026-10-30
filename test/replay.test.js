// @vitest-environment jsdom
// sygnal/replay (7.2 dev preview; research: dev-plans/research/record-replay): two real sessions
// (test/fixtures/replay/sessions.js: run() on jsdom, a real HTTP server, real timers) recorded
// and replayed in renderComponent; the changes a replay must notice (a model change, a child's
// model change, a renamed action) and the one it must survive (a view refactor, for the state);
// redaction (on by default), the format (version, schema, names), setState inputs, the generated
// test and report, and devtools' Copy as test in replay mode. Runs against the BUILT package.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))

let S, R, F, LaneComponent, RootComponent, server, kanban, todo, reactShim = false
beforeAll(async () => {
  S = await import('sygnal')
  // the root vitest compiles the examples' .jsx / .tsx as classic React.createElement calls
  if (typeof globalThis.React === 'undefined') { globalThis.React = { createElement: S.createElement }; reactShim = true }
  R = await import('sygnal/replay')
  F = await import('./fixtures/replay/sessions.js')
  LaneComponent = (await import('../examples/kanban/src/LaneComponent.jsx')).default
  RootComponent = (await import('../examples/kanban/src/RootComponent.jsx')).default
  server = await F.startServer()
  kanban = await F.recordKanban({ server, recorder: { redact: false } })
  todo = await F.recordTodo({ server, recorder: { redact: false } })
}, 30000)
afterAll(async () => { await server?.close(); if (reactShim) delete globalThis.React })

const run = async (C, log, opts) => {
  const r = await R.replay(C, log, opts)
  r.t.dispose()
  return r
}
/** a component with Base's view and statics, and some statics replaced */
const variant = (Base, statics, view = Base) => Object.assign(function Variant(p) { return view(p) }, Base, statics)

describe('the recording', () => {
  it('format version 1: the Sygnal version, component and action names, valid against the schema', () => {
    const { log } = kanban
    expect(log).toMatchObject({ kind: 'sygnal-recording', version: 1, sygnal: pkg.version, app: 'KanbanSync', redacted: false })
    expect(log.components.LaneComponent).toContain('FINISH_EDIT')
    expect(log.components.KanbanSync).toContain('AUTOSAVE')
    expect(R.RECORDING_SCHEMA).toMatchObject({ properties: { version: { const: 1 } } })
    // the required fields and every action's required keys
    for (const k of R.RECORDING_SCHEMA.required) expect(log).toHaveProperty(k)
    for (const a of log.a) for (const k of R.RECORDING_SCHEMA.properties.a.items.required) expect(a).toHaveProperty(k)
    // JSON round trip
    expect(JSON.parse(JSON.stringify(log))).toEqual(log)
  })

  it('the clock and randomness: uuid() / now() from the 4th argument, Math.random() through the fallback', () => {
    const { log } = kanban
    const add = log.a.find(a => a.y == 'ADD_TASK')
    expect(add.e.map(e => e[0])).toEqual(['uuid'])
    const saved = log.a.filter(a => a.y == 'SAVED')
    expect(saved.map(a => a.e.map(e => e[0]))).toEqual([['now', 'random'], ['now', 'random']])
  })

  it('input times come from enqueue (onDispatch); idle timer ticks are dropped by default', () => {
    expect(kanban.log.end.dropped).toBeGreaterThan(0)
    expect(kanban.log.a.every(a => a.t >= 0)).toBe(true)
  })
})

describe('replay of a recorded session', () => {
  it('kanban: every input, reply and timer tick replays to the same states and views, hermetically', async () => {
    const { log } = kanban
    expect(kanban.final.saves).toBe(2)
    const before = server.requests.length
    const r = await run(F.KanbanSync, log)
    expect(r).toMatchObject({ ok: true, divergence: null, view: null, effects: [], extra: [], missing: [], unhandled: [], unresolved: [], warnings: [] })
    expect(r.checkpoints).toBe(log.k.length)
    expect(r.final).toEqual(kanban.final)
    expect(r.final).toEqual(R.finalState(log))
    expect(server.requests.length).toBe(before)
  })

  it('TodoMVC: next() routes, the seed reply, toasts (randomUUID + an `after` timer), Collection item edits', async () => {
    const r = await run(F.TodoSync, todo.log)
    expect(r).toMatchObject({ ok: true, divergence: null, view: null, effects: [], extra: [], missing: [] })
    expect(r.final).toEqual(todo.final)
  })

  it('a JSON string replays too; without the recorded values the replay diverges where uuid() was read', async () => {
    expect((await run(F.KanbanSync, JSON.stringify(kanban.log))).ok).toBe(true)
    const r = await run(F.KanbanSync, kanban.log, { entropy: false })
    expect(r.ok).toBe(false)
    expect(r.divergence).toMatchObject({ type: 'ADD_TASK', path: 'KanbanSync/LaneComponent[lane-2]', reason: 'the action produced a different state' })
    expect(r.divergence.diff[0].path).toMatch(/^lanes\.1\.tasks\.1\.id$/)
  })

  it('not a recording, or a newer format: an error', async () => {
    await expect(R.replay(F.KanbanSync, { kind: 'x' })).rejects.toThrow(/not a Sygnal recording/)
    await expect(R.replay(F.KanbanSync, { ...kanban.log, version: 2 })).rejects.toThrow(/version 2/)
  })

  it('Q8: another Sygnal version, a component without a recorded action: warnings, still replayed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const log = { ...kanban.log, sygnal: '7.1.0', components: { ...kanban.log.components, LaneComponent: [...kanban.log.components.LaneComponent, 'GONE'] } }
      const r = await run(F.KanbanSync, log)
      expect(r.ok).toBe(true)
      expect(r.warnings).toEqual([`recorded with Sygnal 7.1.0, replayed with ${pkg.version}`, 'LaneComponent no longer handles GONE'])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toMatch(/still replayed/)
      warn.mockClear()
      await run(F.KanbanSync, log, { warn: false })
      expect(warn).not.toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })
})

describe('divergence after a code change', () => {
  it('a root model change: the first action whose state differs, with the diff and the effects', async () => {
    const Changed = variant(F.KanbanSync, {
      model: { ...F.KanbanSync.model, ADD_LANE: s => ({ ...F.KanbanSync.model.ADD_LANE(s), lanes: F.KanbanSync.model.ADD_LANE(s).lanes.map((l, i, a) => i == a.length - 1 ? { ...l, title: 'Untitled' } : l) }) },
    })
    const r = await run(Changed, kanban.log)
    expect(r.ok).toBe(false)
    expect(r.divergence).toMatchObject({ type: 'ADD_LANE', path: 'KanbanSync', cause: 'intent', reason: 'the action produced a different state' })
    expect(r.divergence.diff).toEqual([{ path: 'lanes.3.title', expected: 'New Lane', actual: 'Untitled' }])
    expect(r.effects.map(e => e.type)).toEqual(['AUTOSAVE', 'AUTOSAVE'])
    const md = R.bugReport(kanban.log, r, { expected: 'a new lane is called "New Lane"' })
    expect(md).toContain('`ADD_LANE` on `KanbanSync`')
    expect(md).toContain('`lanes.3.title`: recorded `"New Lane"`, now `"Untitled"`')
    expect(md).toContain('now: HTTP {"url":"http://api.test/board"')
    expect(md).toContain("import { replay } from 'sygnal/replay'")
  })

  it("a child's model change: the divergence names the Collection item", async () => {
    const saved = LaneComponent.model
    LaneComponent.model = { ...saved, FINISH_EDIT: (s, title) => ({ ...s, isEditing: false, title: title.toUpperCase() }) }
    try {
      const r = await run(F.KanbanSync, kanban.log)
      expect(r.divergence).toMatchObject({ type: 'FINISH_EDIT', path: 'KanbanSync/LaneComponent[lane-1]' })
      expect(r.divergence.diff).toEqual([{ path: 'lanes.0.title', expected: 'Backlog', actual: 'BACKLOG' }])
    } finally { LaneComponent.model = saved }
  })

  it('a renamed action: unhandled, with a warning that the component no longer handles it', async () => {
    const [m, i] = [LaneComponent.model, LaneComponent.intent]
    const { EDIT_TITLE, ...rest } = m
    LaneComponent.model = { ...rest, SET_DRAFT: EDIT_TITLE }
    LaneComponent.intent = src => { const { EDIT_TITLE: e, ...x } = i(src); return { ...x, SET_DRAFT: e } }
    try {
      const r = await run(F.KanbanSync, kanban.log, { warn: false })
      expect(r.unhandled).toEqual(['EDIT_TITLE'])
      expect(r.divergence).toMatchObject({ type: 'EDIT_TITLE', reason: 'the action no longer changes the state' })
      expect(r.warnings).toContain('LaneComponent no longer handles EDIT_TITLE')
    } finally { [LaneComponent.model, LaneComponent.intent] = [m, i] }
  })

  it('a view refactor: the state replays unchanged, the view difference is reported as view-only', async () => {
    const view = p => {
      const v = RootComponent(p)
      const header = v.children[0]
      header.data = { ...header.data, props: { ...header.data.props, className: 'board-top' } }
      return v
    }
    const r = await run(variant(F.KanbanSync, {}, view), kanban.log)
    expect(r.divergence).toBeNull()
    expect(r.effects).toEqual([])
    expect(r.view).toMatchObject({ checkpoint: 0 })
    expect(r.view.html).toContain('board-top')
  })
})

describe('setState is an input (Q3)', () => {
  it('a runtime setState (time travel, HMR, element props) is recorded and replayed', async () => {
    const { createElement: h, renderComponent } = S
    function Box({ state }) { return h('p', null, String(state.n)) }
    Box.initialState = { n: 0 }
    Box.model = { INC: s => ({ n: s.n + 1 }) }
    const rec = R.startRecording({ redact: false })
    // the runtime API, as devtools / HMR / sygnal/element hold it
    let api
    const L = globalThis.__SYGNAL_DIAGNOSTICS__.layers, grab = a => { api = a; return {} }
    L.add(grab)
    const t = renderComponent(Box)
    L.delete(grab)
    await t.ready()
    t.simulateAction('INC')
    await t.settle()
    api.setState('root', { n: 40 })
    await t.settle()
    t.simulateAction('INC')
    await t.settle()
    const log = rec.stop()
    t.dispose()
    expect(log.a.filter(a => a.c != 'b').map(a => [a.y, a.c, a.d])).toEqual([['INC', 'a', undefined], ['setState', 'S', { n: 40 }], ['INC', 'a', undefined]])
    const r = await run(Box, log)
    expect(r).toMatchObject({ ok: true, final: { n: 41 } })
  })
})

describe('privacy: redaction is on by default', () => {
  it('stores no typed text and still replays (checkpoints compared on masked values)', async () => {
    const red = await F.recordTodo({ server })
    expect(red.log.redacted).toBe(true)
    const json = JSON.stringify(red.log)
    for (const s of ['Buy milk', 'Walk the', 'cat', 'Read the record']) expect(json).not.toContain(s)
    // typed text pseudonymized (shape kept), program data (route names) kept
    const added = red.log.a.filter(a => a.y == 'NEW_TODO').map(a => a.d)
    expect(added.map(s => s.replace(/\p{Lu}/gu, 'X').replace(/\p{Ll}/gu, 'x'))).toEqual(['Xxx xxxx', 'Xxxx xxx xxx'])
    expect(red.log.a.filter(a => a.y == 'ADD_ROUTE').map(a => a.d)).toEqual(['all', 'active', 'completed'])
    const r = await run(F.TodoSync, red.log)
    expect(r).toMatchObject({ ok: true, divergence: null, view: null })
    // forcing the route through redaction: the pseudonym matches no filter, the replay says where
    const all = await F.recordTodo({ server, recorder: { redact: { also: ['VISIBILITY'] } } })
    const bad = await run(F.TodoSync, all.log)
    expect(bad.ok).toBe(false)
    expect(bad.view).toMatchObject({ s: all.log.a.find(a => a.y == 'VISIBILITY').s + 1 })
    const k = await F.recordKanban({ server })
    expect(JSON.stringify(k.log)).not.toContain('Backlog')
    expect((await run(F.KanbanSync, k.log)).ok).toBe(true)
  })

  it('keep: a type left as recorded', async () => {
    const r = await F.recordTodo({ server, recorder: { redact: { keep: ['NEW_TODO'] } } })
    expect(r.log.a.filter(a => a.y == 'NEW_TODO').map(a => a.d)).toEqual(['Buy milk', 'Walk the dog'])
  })
})

describe('a recording as a test or a report', () => {
  it('replayTest: a Vitest file with the timeline; recorder.test() for Copy as test', async () => {
    const code = R.replayTest(kanban.log, { componentImport: "import KanbanSync from './kanbanSync.js'" })
    expect(code).toContain('// Timeline (inputs):')
    expect(code).toContain("import { replay } from 'sygnal/replay'")
    expect(code).toContain("import log from './KanbanSync.recording.json' with { type: 'json' }")
    expect(code).toContain('expect(r.divergence).toBeNull()')
    expect(R.timeline(kanban.log).some(l => /ADD_TASK \(intent\) "Ship the replay spike"  \[reads uuid\]/.test(l))).toBe(true)
  })

  it("sygnal/devtools' Copy as test, replay mode: the newest recorder's test file and recording", async () => {
    const dev = await import('sygnal/devtools')
    const { createElement: h, renderComponent } = S
    function Box({ state }) { return h('p', null, String(state.n)) }
    Box.initialState = { n: 0 }
    Box.model = { INC: s => ({ n: s.n + 1 }) }
    const rec = R.startRecording()
    const t = renderComponent(Box)
    await t.ready()
    t.simulateAction('INC')
    await t.settle()
    const res = dev.copyAsTestResult(undefined, { mode: 'replay', componentImport: "import Box from './Box.jsx'" })
    expect(res.complete).toBe(true)
    expect(res.file).toBe('Box.recording.json')
    expect(JSON.parse(res.recording)).toMatchObject({ kind: 'sygnal-recording', app: 'Box' })
    expect(res.code).toContain("import Box from './Box.jsx'")
    expect(rec.active()).toBe(true)
    rec.stop()
    t.dispose()
    expect(() => dev.copyAsTestResult(undefined, { mode: 'replay' })).toThrow(/startRecording/)
  })
})
