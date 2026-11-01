// Record/replay spike: two real sessions (./sessions.js: run() on jsdom, a real HTTP server,
// real timers) recorded with the hook-layer recorder and replayed in renderComponent; then the
// changes a replay must notice (a model change, a child's model change, a renamed action, a view
// refactor) and the ones it must survive (the view refactor, for the state).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderComponent, ABORT } from 'sygnal'
import { startServer, recordKanban, recordTodo, KanbanSync, TodoSync } from './sessions.js'
import { replay } from './replayer.js'
import { inertDriver } from './inert.js'
import { logToVitest, bugReport, toSessionRecording, finalState } from './toTest.js'
import LaneComponent from '../../../../examples/kanban/src/LaneComponent.jsx'
import RootComponent from '../../../../examples/kanban/src/RootComponent.jsx'

const here = path.dirname(fileURLToPath(import.meta.url))
let server, kanban, todo
beforeAll(async () => {
  server = await startServer()
  kanban = await recordKanban({ server })
  todo = await recordTodo({ server })
})
afterAll(() => server.close())

const run = async (C, log, opts) => {
  const r = await replay(C, log, opts)
  r.t.dispose()
  return r
}

/** generated/<name>: written when missing or with UPDATE_GENERATED=1 (recordings differ run to run) */
function writeGenerated(name, text) {
  const file = path.join(here, 'generated', name)
  if (process.env.UPDATE_GENERATED || !fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
  return file
}

/** a component with Base's view and statics, and some statics replaced */
const variant = (Base, statics, view = Base) => Object.assign(function Variant(p) { return view(p) }, Base, statics)

describe('replay of a recorded session', () => {
  it('kanban: every input, reply and timer tick replays to the same states and vnodes', async () => {
    const { log } = kanban
    // the session reached the server (two saves) and read entropy in three reducers
    expect(kanban.final.saves).toBe(2)
    expect(log.a.filter(a => a.e).map(a => a.y)).toEqual(['ADD_TASK', 'SAVED', 'SAVED'])
    const before = server.requests.length
    const r = await run(KanbanSync, log)
    expect(r).toMatchObject({ ok: true, divergence: null, view: null, effects: [], extra: [], missing: [], unhandled: [], unresolved: [] })
    expect(r.checkpoints).toBe(log.k.length)
    expect(r.final).toEqual(kanban.final)
    expect(r.final).toEqual(finalState(log))
    // hermetic: the replay sent nothing to the server
    expect(server.requests.length).toBe(before)
  })

  it('TodoMVC: next() routes, the seed reply, toasts (randomUUID + an `after` timer), Collection item edits', async () => {
    const r = await run(TodoSync, todo.log)
    expect(r).toMatchObject({ ok: true, divergence: null, view: null, effects: [], extra: [], missing: [] })
    expect(r.final).toEqual(todo.final)
    // the only entropy the replay didn't have: renderComponent's own next() bookkeeping
    // (onNext timestamps), read inside BOOTSTRAP's EFFECT (README §5)
    expect([...new Set(r.misses)]).toEqual(['TodoSync BOOTSTRAP: now'])
  })

  it('without the recorded entropy the replay diverges where a reducer read Date.now()', async () => {
    const r = await run(KanbanSync, kanban.log, { entropy: false })
    expect(r.ok).toBe(false)
    expect(r.divergence).toMatchObject({ type: 'ADD_TASK', path: 'KanbanSync/LaneComponent[lane-2]', reason: 'the action produced a different state' })
    expect(r.divergence.diff[0].path).toMatch(/^lanes\.1\.tasks\.1\.id$/)
  })
})

describe('divergence after a code change', () => {
  it('a root model change: the first action whose state differs, with the diff', async () => {
    const Changed = variant(KanbanSync, {
      model: { ...KanbanSync.model, ADD_LANE: s => ({ ...KanbanSync.model.ADD_LANE(s), lanes: KanbanSync.model.ADD_LANE(s).lanes.map((l, i, a) => i == a.length - 1 ? { ...l, title: 'Untitled' } : l) }) },
    })
    const r = await run(Changed, kanban.log)
    expect(r.ok).toBe(false)
    expect(r.divergence).toMatchObject({ s: 2, type: 'ADD_LANE', path: 'KanbanSync', cause: 'intent', reason: 'the action produced a different state', checkpoint: 1 })
    expect(r.divergence.diff).toEqual([{ path: 'lanes.3.title', expected: 'New Lane', actual: 'Untitled' }])
    // the HTTP request that saves the board now carries the new title: an effect divergence
    expect(r.effects.map(e => e.type)).toEqual(['AUTOSAVE', 'AUTOSAVE'])
    const md = bugReport(kanban.log, r, { expected: 'a new lane is called "New Lane"' })
    expect(md).toContain('First divergence: action #2 `ADD_LANE` on `KanbanSync`')
    expect(md).toContain('`lanes.3.title`: recorded `"New Lane"`, now `"Untitled"`')
    expect(md).toContain('now: HTTP {"url":"http://api.test/board"')
    writeGenerated('kanban-divergence.report.md', md)
  })

  it("a child's model change: the divergence names the Collection item", async () => {
    const saved = LaneComponent.model
    LaneComponent.model = { ...saved, FINISH_EDIT: (s, title) => ({ ...s, isEditing: false, title: title.toUpperCase() }) }
    try {
      const r = await run(KanbanSync, kanban.log)
      expect(r.divergence).toMatchObject({ type: 'FINISH_EDIT', path: 'KanbanSync/LaneComponent[lane-1]' })
      expect(r.divergence.diff).toEqual([{ path: 'lanes.0.title', expected: 'Backlog', actual: 'BACKLOG' }])
    } finally { LaneComponent.model = saved }
  })

  it('a renamed action (intent + model refactor): the log names an action the code no longer has', async () => {
    const [m, i] = [LaneComponent.model, LaneComponent.intent]
    const { EDIT_TITLE, ...rest } = m
    LaneComponent.model = { ...rest, SET_DRAFT: EDIT_TITLE }
    LaneComponent.intent = src => { const { EDIT_TITLE: e, ...x } = i(src); return { ...x, SET_DRAFT: e } }
    try {
      const r = await run(KanbanSync, kanban.log)
      expect(r.unhandled).toEqual(['EDIT_TITLE'])
      expect(r.divergence).toMatchObject({ type: 'EDIT_TITLE', reason: 'the action no longer changes the state' })
    } finally { [LaneComponent.model, LaneComponent.intent] = [m, i] }
  })

  it('a view refactor: the state replays unchanged, the vnode difference is reported as view-only', async () => {
    // the header's class and the add-lane button's class renamed; same model, same state
    const view = p => {
      const v = RootComponent(p)
      const header = v.children[0]
      header.data = { ...header.data, props: { ...header.data.props, className: 'board-top' } }
      const btn = header.children[1]
      btn.data = { ...btn.data, props: { ...btn.data.props, className: 'new-lane' } }
      return v
    }
    const Refactored = variant(KanbanSync, {}, view)
    const r = await run(Refactored, kanban.log)
    expect(r.divergence).toBeNull()
    expect(r.effects).toEqual([])
    expect(r.view).toMatchObject({ checkpoint: 0, s: kanban.log.k[0].s })
    expect(r.view.html).toContain('board-top')
    // a source-level replay (the recorded click on '.add-lane-btn') no longer finds its element
    const t = renderComponent(Refactored, { drivers: { DND: inertDriver() } })
    await t.ready()
    const lanes = t.state.lanes.length
    try { t.simulateEvent('.add-lane-btn', 'click') } catch (_) { /* no such element */ }
    await t.settle().catch(() => {})
    expect(t.state.lanes.length).toBe(lanes)
    t.dispose()
  })
})

describe('turning a recording into a test or a report', () => {
  const gen = path.join(here, 'generated')
  const write = writeGenerated

  it('logToVitest: a Vitest file per session (the committed ones run in this suite)', () => {
    for (const [name, rec, imp] of [['kanban', kanban, "import KanbanSync from '../fixtures/kanbanSync.jsx'"], ['todomvc', todo, "import TodoSync from '../fixtures/todoSync.tsx'"]]) {
      write(`${name}.recording.json`, JSON.stringify(rec.log) + '\n')
      const committed = JSON.parse(fs.readFileSync(path.join(gen, `${name}.recording.json`), 'utf8'))
      // the generator is deterministic: the committed test is what the committed log generates
      const code = logToVitest(committed, { componentImport: imp, logFile: `./${name}.recording.json`, testName: `${name}: a recorded session replays (generated)` })
      const file = write(`${name}.replay.test.js`, code)
      expect(fs.readFileSync(file, 'utf8')).toBe(code)
      expect(code).toContain('// Timeline (inputs):')
    }
  })

  it("toSessionRecording: Copy as test's explicit steps, complete only for a root-only, entropy-free session", async () => {
    const dev = await import('sygnal/devtools')
    const k = toSessionRecording(kanban.log, KanbanSync)
    // lanes and task cards changed the state on their own; SAVED / ADD_TASK read entropy
    expect(k.session.foreign.map(f => f.type)).toContain('FINISH_EDIT')
    expect(k.reasons.join('\n')).toMatch(/SAVED reads now, random/)
    const res = dev.copyAsTestResult(k.session, { componentImport: "import KanbanSync from '../fixtures/kanbanSync.jsx'", drivers: { DND: 'inert()' }, imports: ["import { inertDriver as inert } from '../inert.js'"], environment: 'jsdom' })
    expect(res.complete).toBe(false)
    expect(res.code).toContain("t.simulateAction('ADD_LANE'")
    expect(res.code).toContain("t.respond('HTTP'")
    write('kanban.copied.test.js', res.code)
  })

  it('bugReport: Markdown with the timeline and the reproduction', () => {
    const md = bugReport(todo.log, null, { title: 'TodoMVC: editing a todo' })
    expect(md).toContain('EDIT_INPUT (intent) "W"')
    expect(md).toContain('SEEDED (reply)')
  })
})

describe('privacy: a redacted recording', () => {
  it('stores no typed text and still replays (checkpoints compared on masked values)', async () => {
    const red = await recordTodo({ server, recorder: { redact: true } })
    const json = JSON.stringify(red.log)
    for (const s of ['Buy milk', 'Walk the', 'cat', 'Read the record']) expect(json).not.toContain(s)
    // typed text pseudonymized (shape kept), program data (route names, ids) kept
    const added = red.log.a.filter(a => a.y == 'NEW_TODO').map(a => a.d)
    expect(added.map(s => s.replace(/\p{Lu}/gu, 'X').replace(/\p{Ll}/gu, 'x'))).toEqual(['Xxx xxxx', 'Xxxx xxx xxx'])
    expect(red.log.a.filter(a => a.y == 'ADD_ROUTE').map(a => a.d)).toEqual(['all', 'active', 'completed'])
    const r = await run(TodoSync, red.log)
    expect(r).toMatchObject({ ok: true, divergence: null, view: null })
    // the replay ran on the masked text: the titles have the recorded shape, not the content
    expect(r.final.todos.map(t => t.title)).toEqual([added[0], red.log.a.find(a => a.y == 'EDIT_DONE').d])
    // forcing the route through redaction: the pseudonym matches no filter, the replay says where
    const all = await recordTodo({ server, recorder: { redact: { also: ['VISIBILITY'] } } })
    const bad = await run(TodoSync, all.log)
    expect(bad.ok).toBe(false)
    expect(bad.view).toMatchObject({ s: all.log.a.find(a => a.y == 'VISIBILITY').s + 1 })
    const k = await recordKanban({ server, recorder: { redact: true } })
    expect(JSON.stringify(k.log)).not.toContain('Backlog')
    expect((await run(KanbanSync, k.log)).ok).toBe(true)
  })
})

export { ABORT }
