/**
 * PLAN-10 A-7: the state keys each action's STATE reducer writes (`writes`, `removes`) and the
 * ones a component reads (`stateReads`, `stateReadsPartial`), in the static graph.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { graph, graphFiles, validateSchema } from '../src/index.js'
import { formatGraph } from '../src/graphText.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const schema = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'schema/inspect.schema.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
function project(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-a7-'))
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true })
    fs.writeFileSync(path.join(tmp, rel), src)
  }
  const g = graphFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp })
  expect(validateSchema(schema, g)).toEqual([])
  return g
}
const comp = (g, name) => g.components.find(c => c.name === name)
/** { ACTION: writes } of one component (actions without a STATE sink: 'no STATE'). */
const writes = (g, name) => Object.fromEntries(comp(g, name).actions.map(a => [a.name, 'writes' in a ? a.writes : 'no STATE']))

/** A component App with this model (and initialState, view, extra source). */
function app(model, { initialState = '{ a: 1, b: 2, cart: [] }', view = 'function App() { return <p /> }', extra = '', imports = 'ABORT, set, toggle' } = {}) {
  return project({
    'App.jsx': [
      `import { ${imports} } from 'sygnal'`,
      extra,
      `export ${view}`,
      initialState ? `App.initialState = ${initialState}` : '',
      `App.model = ${model}`,
    ].join('\n'),
  })
}

describe('A-7 writes: reducers', () => {
  it('object spread with literal keys, ternaries, ABORT and the state itself', () => {
    const g = app(`{
      ADD: (state, item) => ({ ...state, cart: [...state.cart, item] }),
      BOTH: (state) => state.a ? { ...state, a: 0 } : { ...state, b: 0 },
      MAYBE: (state, d) => { if (!d) return ABORT; return { ...state, a: d } },
      SAME: (state) => state,
      NOOP: () => ABORT,
      NESTED: (state) => ({ ...state, cart: { ...state.cart, open: true } }),
      INNER: (state) => ({ ...state, ...{ a: 1, b: 2 } }),
      METHOD(state) { return { ...state, b: 3 } },
    }`)
    expect(writes(g, 'App')).toEqual({
      ADD: ['cart'], BOTH: ['a', 'b'], MAYBE: ['a'], SAME: [], NOOP: [], NESTED: ['cart'], INNER: ['a', 'b'], METHOD: ['b'],
    })
  })

  it('set() and toggle() from sygnal', () => {
    const g = app(`{
      EDIT: set({ editing: true }),
      TITLE: set((state, title) => ({ title })),
      OPEN: toggle('open'),
      DYN: toggle(name),
      SPREAD: set({ ...defaults }),
    }`, { extra: `const name = String(Math.random())\nconst defaults = { a: 1 }` })
    expect(writes(g, 'App')).toEqual({ EDIT: ['editing'], TITLE: ['title'], OPEN: ['open'], DYN: null, SPREAD: null })
  })

  it('an object without ...state replaces the state: its keys and every other initialState key; unknown without initialState', () => {
    expect(writes(app(`{ RESET: () => ({ a: 0 }) }`), 'App')).toEqual({ RESET: ['a', 'b', 'cart'] })
    expect(writes(app(`{ RESET: () => ({ a: 0 }) }`, { initialState: '' }), 'App')).toEqual({ RESET: null })
    // a destructured state parameter can't be spread: the object replaces the state too
    expect(writes(app(`{ RESET: ({ a }) => ({ a: a + 1 }) }`), 'App')).toEqual({ RESET: ['a', 'b', 'cart'] })
  })

  it('unknown: dynamic keys, other spreads, calls it cannot follow, non-object returns', () => {
    const g = app(`{
      KEY: (state, k) => ({ ...state, [k]: true }),
      DATA: (state, d) => ({ ...state, ...d }),
      SLICE: (state) => ({ ...state, ...state.cart }),
      CALL: (state) => compute(state),
      IMPORTED: (state) => lib.update(state),
      DATA_AS_STATE: (state, d) => d,
      NONE: (state) => { console.log(state) },
      PASS: true,
    }`, { extra: `import * as lib from 'some-lib'\nconst compute = globalThis.compute` })
    expect(writes(g, 'App')).toEqual({ KEY: null, DATA: null, SLICE: null, CALL: null, IMPORTED: null, DATA_AS_STATE: null, NONE: null, PASS: null })
  })

  it('local helpers given the state, and a local const object that is not mutated', () => {
    const g = app(`{
      ADD: (state, item) => add(item, state),
      LOCAL: (state, d) => { const next = { ...state, a: d }; return next },
      MUTATED: (state, k) => { const next = { ...state, a: 1 }; next[k] = 2; return next },
      NAMED: reset,
    }`, { extra: `const add = (item, s) => ({ ...s, cart: [...s.cart, item] })\nfunction reset(state) { return { ...state, a: 0, b: 0 } }` })
    expect(writes(g, 'App')).toEqual({ ADD: ['cart'], LOCAL: ['a'], MUTATED: null, NAMED: ['a', 'b'] })
  })

  it('undefined removes a Collection item: removes: true, the other returns still listed', () => {
    const g = app(`{
      DESTROY: () => undefined,
      VOID: () => void 0,
      BARE: (state) => { if (state.a) return; return state },
      DONE: (state) => { if (!state.a) return undefined; return { ...state, a: 0 } },
    }`)
    const a = Object.fromEntries(comp(g, 'App').actions.map(x => [x.name, [x.writes, x.removes]]))
    expect(a).toEqual({ DESTROY: [[], true], VOID: [[], true], BARE: [[], true], DONE: [['a'], true] })
    expect(formatGraph(g)).toContain('DESTROY (unknown → STATE removes)')
    expect(formatGraph(g)).toContain('DONE (unknown → STATE writes a or removes)')
  })

  it('object form: only actions with a STATE sink get writes; the STATE value is analyzed', () => {
    const g = app(`{
      SAVE: { STATE: (state) => ({ ...state, a: 1 }), EFFECT: () => {} },
      LOG: { EFFECT: () => {} },
      UNDOABLE: { STATE: (state) => ({ ...state, b: 1 }) },
    }`)
    expect(writes(g, 'App')).toEqual({ SAVE: ['a'], LOG: 'no STATE', UNDOABLE: ['b'] })
    expect(formatGraph(g)).toContain('SAVE (unknown → STATE writes a + EFFECT)')
    expect(formatGraph(g)).toContain('LOG (unknown → EFFECT)')
  })

  it('undoable(): UNDO / REDO restore whatever was tracked (unknown)', () => {
    const g = app(`undoable({ INC: (state) => ({ ...state, a: state.a + 1 }) })`, { imports: 'undoable' })
    expect(writes(g, 'App')).toEqual({ INC: ['a'], UNDO: null, REDO: null })
  })
})

describe('A-7 writes: behaviors', () => {
  it('a first-party behavior writes its slice; sortable also moves its literal `from` lists; DROPPED is ABORT', () => {
    const g = project({
      'List.jsx': [
        `import { pager, sortable } from 'sygnal'`,
        `export function List({ state }) { return <ul>{state.tasks.map(t => <li data-id={t.id}>{t.title}</li>)}</ul> }`,
        `List.initialState = { tasks: [], lanes: [] }`,
        `List.uses = { page: pager({ pageSize: 10 }), sort: sortable({ from: ['tasks', 'lanes'], item: 'li' }), dyn: sortable({ from: pick(), item: 'li' }) }`,
        `List.model = { 'page.NEXT': (state) => ({ ...state, tasks: [] }) }`,
        `const pick = () => 'tasks'`,
      ].join('\n'),
    })
    const w = writes(g, 'List')
    expect(w['page.NEXT']).toEqual(['tasks', 'page'])
    expect(w['page.PREV']).toEqual(['page'])
    expect(w['sort.UP']).toEqual(['sort', 'tasks', 'lanes'])
    expect(w['sort.PRESS']).toEqual(['sort'])
    expect(w['sort.DROPPED']).toEqual([])
    expect(w['dyn.UP']).toBe(null)
  })

  it('a user behavior: STATE writes the slice (nothing when it only aborts); HOST is analyzed with the uses key', () => {
    const g = project({
      'Knob.jsx': [
        `import { defineBehavior, ABORT } from 'sygnal'`,
        `const knob = defineBehavior({`,
        `  initialState: { active: false },`,
        `  model: {`,
        `    START: (slice) => ({ ...slice, active: true }),`,
        `    IDLE: () => ABORT,`,
        `    RESET: { HOST: (state, d, next, props, options, key) => ({ ...state, [key]: { active: false } }) },`,
        `    MOVE: { HOST: (state, d, next, props, { from }) => ({ ...state, [from]: d }) },`,
        `  },`,
        `})`,
        `export function Knob({ state }) { return <p>{state.value}</p> }`,
        `Knob.initialState = { value: 0 }`,
        `Knob.uses = { k: knob({ from: 'value' }) }`,
      ].join('\n'),
    })
    expect(writes(g, 'Knob')).toEqual({ 'k.START': ['k'], 'k.IDLE': [], 'k.RESET': ['k'], 'k.MOVE': null })
  })
})

describe('A-7 stateReads', () => {
  it('state.x, optional and literal computed members, destructured props and state, props.state', () => {
    const g = project({
      'A.jsx': `export function A({ state }) { return <p>{state.a}{state.b?.c}{state['d']}{[1].map(state => state.shadowed)}</p> }\nA.initialState = {}`,
      'B.jsx': `export function B({ state: { x, y } }) { return <p>{x}{y}</p> }\nB.initialState = {}`,
      'C.jsx': `export function C(props) { const { q } = props.state; return <p>{props.state.z}{q}</p> }\nC.initialState = {}`,
      'D.jsx': `export function D({ state }) { const { m, n: renamed } = state; return <p>{m}{renamed}</p> }\nD.initialState = {}`,
    })
    expect(comp(g, 'A').stateReads).toEqual(['a', 'b', 'd'])
    expect(comp(g, 'B').stateReads).toEqual(['x', 'y'])
    expect(comp(g, 'C').stateReads).toEqual(['q', 'z'])
    expect(comp(g, 'D').stateReads).toEqual(['m', 'n'])
    expect(g.components.some(c => c.stateReadsPartial)).toBe(false)
  })

  it('through local helpers given the state; child lenses; calculated and context functions', () => {
    const g = project({
      'App.jsx': [
        `import { Collection } from 'sygnal'`,
        `import Item from './Item.jsx'`,
        `import Card from './Card.jsx'`,
        `const panel = (s) => <p>{s.title}</p>`,
        `export function App({ state }) { return <div>{panel(state)}<Card state="user.profile" /><Collection of={Item} from="items" /></div> }`,
        `App.initialState = { title: '', user: {}, items: [], count: 0 }`,
        `App.calculated = { total: (state) => state.items.length }`,
        `App.context = { n: (state) => state.count }`,
      ].join('\n'),
      'Item.jsx': `export default function Item() { return <li /> }\nItem.initialState = {}`,
      'Card.jsx': `export default function Card() { return <p /> }\nCard.initialState = {}`,
    })
    expect(comp(g, 'App').stateReads).toEqual(['title', 'user', 'items', 'count'])
    expect(comp(g, 'App').stateReadsPartial).toBeUndefined()
    expect(comp(g, 'Item').stateReads).toBeUndefined()
  })

  it('partial: the state passed whole, a dynamic key, a rest pattern, an imported helper', () => {
    const g = project({
      'A.jsx': `import Child from './Child.jsx'\nexport function A({ state }) { return <Child state={state} label={state.label} /> }\nA.initialState = {}`,
      'B.jsx': `export function B({ state, field }) { return <p>{state[field]}</p> }\nB.initialState = {}`,
      'C.jsx': `export function C({ state: { a, ...rest } }) { return <p>{a}{rest.b}</p> }\nC.initialState = {}`,
      'D.jsx': `import { fmt } from 'some-lib'\nexport function D({ state }) { return <p>{fmt(state)}</p> }\nD.initialState = {}`,
      'Child.jsx': `export default function Child() { return <p /> }\nChild.initialState = {}`,
    })
    expect([comp(g, 'A').stateReads, comp(g, 'A').stateReadsPartial]).toEqual([['label'], true])
    expect([comp(g, 'B').stateReads, comp(g, 'B').stateReadsPartial]).toEqual([undefined, true])
    expect([comp(g, 'C').stateReads, comp(g, 'C').stateReadsPartial]).toEqual([['a'], true])
    expect([comp(g, 'D').stateReads, comp(g, 'D').stateReadsPartial]).toEqual([undefined, true])
    const text = formatGraph(g)
    expect(text).toContain('  reads     label …')
    expect(text).toContain('  reads     …')
  })
})

describe('A-7 on the examples', () => {
  it('kanban: every STATE action has known writes; the views read what the reducers write', () => {
    const dir = path.resolve(pkgRoot, '../examples/kanban/src')
    const g = graph([dir], { cwd: dir })
    expect(validateSchema(schema, g)).toEqual([])
    const root = comp(g, 'RootComponent')
    expect(Object.fromEntries(root.actions.filter(a => 'writes' in a).map(a => [a.name, a.writes]))).toMatchObject({
      ADD_LANE: ['nextId', 'lanes'], DELETE_LANE: ['lanes'], DRAG_START: ['dragging'], DROP: ['dragging', 'lanes'],
    })
    expect(root.stateReads).toEqual(['lanes', 'dragging', 'draggingLane'])
    expect(g.components.flatMap(c => c.actions).filter(a => 'writes' in a && a.writes === null)).toEqual([])
    expect(formatGraph(g)).toContain('ADD_LANE (intent → STATE writes nextId, lanes)')
  })

  it('the shop fixture: writes and reads', () => {
    const g = graph(['test/fixtures/graph-shop/src'], { cwd: pkgRoot })
    const a = comp(g, 'App')
    expect(Object.fromEntries(a.actions.filter(x => 'writes' in x).map(x => [x.name, x.writes]))).toEqual({
      GO: ['page'], ADD_TO_CART: ['cart'], REMOVE: ['cart'], PRODUCTS: ['products'],
    })
    // the view's state.page, the Greeting lens 'user', the context functions' user and cart
    expect(a.stateReads).toEqual(['page', 'user', 'cart'])
    expect(comp(g, 'Shop').stateReads).toEqual(['products'])
  })
})
