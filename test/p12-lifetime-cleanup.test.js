// @vitest-environment jsdom
import {it, expect} from 'vitest'
import {mount, h, api, Collection, Switchable, microtasks} from './parity/harness.js'
const flush = async m => { await m.app.__runtime.flushed(); await microtasks() }

for (const binding of ['path', 'byId']) it(`cleanup reads the latest owned ${binding} snapshot and cannot recreate its deleted target`, async () => {
  const cleanup = [], errors = []
  function Editor({state}) { return h('p', null, state.title) }
  Editor.calculated = {upper: state => state.title.toUpperCase()}
  Editor.model = {
    EDIT: state => ({...state, title: 'updated before render'}),
    DISPOSE: {
      STATE: state => ({...state, title: 'must not resurrect'}),
      EFFECT: (state, _data, _next, props) => { cleanup.push([state.title, state.upper, props.previousState.title]) },
    },
  }
  function App() { return h(Editor, {state: binding === 'path' ? 'record' : api.byId('records', 1)}) }
  App.initialState = {record: {title: 'one'}, records: [{id: 1, title: 'one'}]}
  App.model = {DROP: state => ({...state, record: undefined, records: []})}
  const m = mount(App, {}, {onError: (error, info) => errors.push([error.message, info.phase])})
  await flush(m)
  m.app.__runtime.dispatch(m.app.__runtime.root.children()[0], 'EDIT')
  m.app.__runtime.dispatch('root', 'DROP')
  await flush(m)
  expect(cleanup).toEqual([['updated before render', 'UPDATED BEFORE RENDER', 'updated before render']])
  expect(errors).toEqual([])
  expect(m.state().record).toBeUndefined(); expect(m.state().records).toEqual([])
})

it('descendant cleanup reads its latest state through the frozen removed ancestor', async () => {
  const cleanup = [], errors = []
  function Item({state}) { return h('p', null, String(state.n)) }
  Item.model = {EDIT: state => ({...state, n: state.n + 1}), DISPOSE: {EFFECT: state => { cleanup.push([state.id, state.n]) }}}
  function Board() { return h(Collection, {of: Item, from: 'items'}) }
  function App() { return h(Board, {state: api.byId('boards', 1)}) }
  App.initialState = {boards: [{id: 1, items: [{id: 2, n: 0}]}]}
  App.model = {DROP: state => ({...state, boards: []})}
  const m = mount(App, {}, {onError: error => errors.push(error.message)})
  await flush(m)
  const item = m.app.__runtime.root.children()[0].children()[0]
  m.app.__runtime.dispatch(item, 'EDIT')
  m.app.__runtime.dispatch('root', 'DROP')
  await flush(m)
  expect(cleanup).toEqual([[2, 1]])
  expect(errors).toEqual([])
})

for (const Host of [Collection, api.VirtualCollection]) for (const binding of ['path', 'byId']) it(`${Host === Collection ? 'Collection' : 'VirtualCollection'} ${binding} array loss cancels work and snapshots cleanup between renders`, async () => {
  const cleanup = [], errors = [], starts = []
  let late
  function Item({state}) { return h('p', null, state.title ?? String(state)) }
  Item.intent = () => ({START: api.xs.of(null)})
  Item.model = {
    START: {EFFECT: (state, _data, next, props) => { if (state.title !== undefined) { starts.push(props.signal); late = next } }},
    GOT: (state, title) => ({...state, title}),
    EDIT: state => ({...state, title: 'updated'}),
    DISPOSE: {EFFECT: state => { if (state.title !== undefined) cleanup.push(state.title) }},
  }
  const group = title => ['selected', {id: 1, title}]
  function App() { return h('div', null, h(Host, {
    of: Item, from: binding === 'path' ? 'items' : api.byId('groups', 'selected', '0'),
    ...(Host === api.VirtualCollection ? {estimateSize: 30, style: {height: '100px'}} : {}),
  })) }
  App.initialState = {items: [{id: 1, title: 'one'}], groups: [group('one')]}
  App.model = {DROP: state => ({...state, items: undefined, groups: []}), RESTORE: state => ({...state, items: [{id: 1, title: 'two'}], groups: [group('two')]})}
  const m = mount(App, {}, {onError: error => errors.push(error.message)})
  await flush(m)
  const oldSignal = starts[0], oldNext = late
  const item = m.app.__runtime.root.children().find(child => child.state.id === 1)
  m.app.__runtime.dispatch(item, 'EDIT')
  m.app.__runtime.dispatch('root', 'DROP')
  m.app.__runtime.dispatch('root', 'RESTORE')
  await flush(m)
  expect(oldSignal.aborted).toBe(true)
  expect(cleanup).toEqual(['updated'])
  oldNext('GOT', 'stale')
  await new Promise(resolve => setTimeout(resolve, 20)); await flush(m)
  expect(binding === 'path' ? m.state().items[0].title : m.state().groups[0][1].title).toBe('two')
  expect(errors).toEqual([])
})

it('Switchable disposal snapshots bound state for shown and hidden pages', async () => {
  const cleanup = [], errors = []
  function Page({state}) { return h('p', null, state.title) }
  Page.model = {DISPOSE: {EFFECT: state => { cleanup.push(state.title) }}}
  function App() { return h(Switchable, {of: {shown: Page, hidden: Page}, current: 'shown', state: 'record'}) }
  App.initialState = {record: {title: 'one'}}
  App.model = {EDIT: state => ({...state, record: {title: 'latest'}}), DROP: state => ({...state, record: undefined})}
  const m = mount(App, {}, {onError: error => errors.push(error.message)})
  await flush(m)
  m.app.__runtime.dispatch('root', 'EDIT')
  m.app.__runtime.dispatch('root', 'DROP')
  await flush(m)
  expect(cleanup).toEqual(['latest', 'latest'])
  expect(errors).toEqual([])
})

for (const value of [0, false, null]) it(`keeps ${String(value)} as a present known state and preserves it for cleanup`, async () => {
  const cleanup = []
  function Child({state}) { return h('p', null, String(state)) }
  Child.model = {DISPOSE: {EFFECT: state => { cleanup.push(state) }}}
  function App() { return h(Child, {state: 'record'}) }
  App.initialState = {record: value}; App.model = {DROP: state => ({...state, record: undefined})}
  const m = mount(App)
  await flush(m)
  m.app.__runtime.dispatch('root', 'DROP'); await flush(m)
  expect(cleanup).toEqual([value])
})

it('observes a fresh missing target becoming present and disappearing again before any render', async () => {
  const signals = []
  function Child({state}) { return h('p', null, state.title) }
  Child.intent = () => ({START: api.xs.of(null)})
  Child.model = {START: {EFFECT: (_state, _data, _next, props) => { signals.push(props.signal) }}}
  function App() { return h(Child, {state: 'record'}) }
  App.initialState = {record: undefined}
  let m
  App.model = {
    GO: {EFFECT: () => { m.app.__runtime.dispatch('root', 'RESTORE'); m.app.__runtime.dispatch('root', 'DROP') }},
    RESTORE: state => ({...state, record: {title: 'temporary'}}),
    DROP: state => ({...state, record: undefined}),
  }
  m = mount(App); await flush(m)
  const waiting = signals[0]
  m.app.__runtime.dispatch('root', 'GO'); await flush(m)
  expect(waiting.aborted).toBe(true)
  expect(signals).toHaveLength(2)
  expect(signals[1].aborted).toBe(false)
})

it('preserves each queued state notification while skipping unchanged notification passes', async () => {
  const values = []
  function App() { return h('p', null, 'state') }
  App.initialState = {n: 0}
  App.intent = ({STATE}) => { STATE.stream.addListener({next: state => values.push(state.n)}); return {} }
  let m
  App.model = {
    GO: {EFFECT: () => { m.app.__runtime.dispatch('root', 'A'); m.app.__runtime.dispatch('root', 'B') }},
    A: state => ({...state, n: 1}), B: state => ({...state, n: 2}), NOOP: state => state,
  }
  m = mount(App); await flush(m); values.length = 0
  m.app.__runtime.dispatch('root', 'GO'); await flush(m)
  m.app.__runtime.dispatch('root', 'NOOP'); await flush(m)
  expect(values).toEqual([1, 2])
})
