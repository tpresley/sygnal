// sygnal/yjs: what the subpath adds over the spike (dev-plans/research/crdt-state §9 P0-P2):
// fractional-indexing order keys, `shape`, whenSynced / ifEmpty seeding, LOCAL coalesced per
// flush, incremental read, unchanged items skipped on write, the REMOTE ack, SYG260 / SYG261,
// LOCAL / REMOTE as built-in actions, the `connect` command.
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import xs from 'xstream'
import { createElement as h } from '../src/pragma/index.js'
import { undo } from '../src/extra/undo.ts'
import { shared, collection } from '../src/yjs.ts'
import { writeMap, read, normShape } from '../src/yjs/mapping.ts'
import { client, createNetwork, makeYjsDriver, renderComponent, until, tick, converged, docOf, Board } from './fixtures/yjs/helpers.js'

const sync = (a, b) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}
// a component with its own statics (Board's, overridden)
const variant = (name, statics) => Object.assign(Object.defineProperty((p) => Board(p), 'name', { value: name }), Board, { componentName: name }, statics)

describe('order keys (fractional-indexing)', () => {
  it('keys are fractional-indexing keys, one per item, in order', () => {
    const d = new Y.Doc()
    writeMap(d.getMap('l'), {}, { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, {}, 'l')
    const m = d.getMap('l.items#c'), keys = ['a', 'b', 'c'].map((id) => m.get(id).get('$o'))
    expect(keys).toEqual(['a0', 'a1', 'a2'])
  })
  it('random inserts and moves keep the order and stay short', () => {
    const d = new Y.Doc()
    let items = []
    for (let n = 0; n < 500; n++) {
      const next = items.slice(), i = Math.floor(Math.random() * (items.length + 1))
      if (items.length && Math.random() < 0.4) { const [x] = next.splice(Math.floor(Math.random() * items.length), 1); next.splice(i % next.length, 0, x) }
      else next.splice(i, 0, { id: 'i' + n })
      d.transact(() => writeMap(d.getMap('l'), { items }, { items: next }, {}, 'l'))
      items = next
    }
    expect(read(d.getMap('l'), 'l').items.map((x) => x.id)).toEqual(items.map((x) => x.id))
    const m = d.getMap('l.items#c')
    expect(Math.max(...items.map((x) => m.get(x.id).get('$o').length))).toBeLessThan(40)
  })
  it('a key that is not a fractional-indexing key (an older document) is rekeyed, not trusted', () => {
    const d = new Y.Doc()
    writeMap(d.getMap('l'), {}, { items: [{ id: 'a' }, { id: 'b' }] }, {}, 'l')
    d.getMap('l.items#c').get('a').set('$o', 'zz!')
    writeMap(d.getMap('l'), { items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'a' }] }, {}, 'l')
    expect(read(d.getMap('l'), 'l').items.map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('write', () => {
  it('an edit of one item of 1000 writes that item only (the others are skipped by identity)', () => {
    const d = new Y.Doc()
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: 'id' + i, done: false }))
    writeMap(d.getMap('b'), {}, { items }, {}, 'b')
    const next = items.slice(); next[500] = { ...items[500], done: true }
    // no item map is read for the skipped items: count Y.Map#get calls during the write
    const get = Y.Map.prototype.get
    let gets = 0
    Y.Map.prototype.get = function (k) { gets++; return get.call(this, k) }
    let changed
    d.on('afterTransaction', (tr) => { changed = tr.changed.size })
    try { d.transact(() => writeMap(d.getMap('b'), { items }, { items: next }, {}, 'b')) } finally { Y.Map.prototype.get = get }
    expect(gets).toBeLessThan(10)
    expect(changed).toBe(1)
  })
})

describe('incremental read', () => {
  it('equals a full read after random remote changes, and keeps the objects it did not touch', () => {
    const a = new Y.Doc(), b = new Y.Doc()
    const opts = { text: ['text'] }
    let s = { title: 't', tags: ['x'], meta: { n: 0 }, items: [] }
    writeMap(a.getMap('k'), {}, s, opts, 'k')
    sync(a, b)
    let mirror = read(b.getMap('k'), 'k'), dirty
    b.on('afterTransaction', (tr) => {
      const types = new Set(), roots = new Set()
      for (const t of tr.changed.keys()) {
        let r = t; types.add(r)
        while (r._item) { r = r._item.parent; types.add(r) }
        for (const [n, v] of b.share) if (v === r) roots.add(n)
      }
      dirty = { types, roots, changed: tr.changed }
    })
    let n = 0
    for (let step = 0; step < 300; step++) {
      const ids = s.items.map((x) => x.id), r = Math.random(), pick = () => ids[Math.floor(Math.random() * ids.length)]
      let next
      if (r < 0.3 || !ids.length) next = { ...s, items: [...s.items, { id: 'i' + n++, text: 'a', done: false }] }
      else if (r < 0.5) { const id = pick(); next = { ...s, items: s.items.map((x) => x.id === id ? { ...x, text: x.text + 'b' } : x) } }
      else if (r < 0.6) { const id = pick(); next = { ...s, items: s.items.map((x) => x.id === id ? { ...x, done: !x.done } : x) } }
      else if (r < 0.7) { const i = s.items.length - 1; next = { ...s, items: [s.items[i], ...s.items.slice(0, i)] } }
      else if (r < 0.8) { const id = pick(); next = { ...s, items: s.items.filter((x) => x.id !== id) } }
      else if (r < 0.9) next = { ...s, meta: { n: s.meta.n + 1 } }
      else next = { ...s, title: s.title + 'x', tags: [...s.tags, 'y'] }
      a.transact(() => writeMap(a.getMap('k'), s, next, opts, 'k'))
      const metaKept = next.meta === s.meta, before = mirror
      s = next
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
      mirror = read(b.getMap('k'), 'k', mirror, dirty)
      expect(mirror).toEqual(read(b.getMap('k'), 'k'))
      // untouched parts keep their identity
      if (metaKept) expect(mirror.meta).toBe(before.meta)
    }
  })
})

describe('shape', () => {
  it("an empty array is a collection by inference; shape: 'list' makes it a Y.Array", () => {
    const d = new Y.Doc()
    writeMap(d.getMap('a'), {}, { tags: [] }, {}, 'a')
    writeMap(d.getMap('b'), {}, { tags: [] }, {}, 'b', normShape({ tags: 'list' }))
    expect(d.getMap('a').get('tags')).toEqual({ $y: 'c' })
    expect(d.getMap('b').get('tags')).toEqual({ $y: 'l' })
    // the list then takes plain values: still a Y.Array (no kind switch)
    writeMap(d.getMap('b'), { tags: [] }, { tags: ['x', 'y'] }, {}, 'b', normShape({ tags: 'list' }))
    expect(d.getArray('b.tags#l').toArray()).toEqual(['x', 'y'])
  })
  it("collection({ text: 'text' }) makes the items' text a Y.Text; 'text' on a field of the slice too", () => {
    const d = new Y.Doc()
    writeMap(d.getMap('b'), {}, { title: 'Todo', items: [{ id: 1, text: 'hi' }] }, {}, 'b', normShape({ title: 'text', items: collection({ text: 'text' }) }))
    expect(d.getMap('b').get('title')).toEqual({ $y: 't' })
    expect(d.getMap('b.items#c').get('1').get('text')).toBeInstanceOf(Y.Text)
    expect(read(d.getMap('b'), 'b')).toEqual({ title: 'Todo', items: [{ id: 1, text: 'hi' }] })
  })
  it('an unknown shape kind throws when shared() is used', () => {
    expect(() => normShape({ x: 'txt' })).toThrow(/unknown shape 'txt'/)
  })
  it('SYG261 (dev): an empty array without a shape is reported once; with a shape it is not', async () => {
    const net = createNetwork()
    const a = client(net, 'ann')
    await a.t.settle()
    expect(a.t.diagnostics.filter((d) => d.code == 'SYG261').map((d) => d.data.path)).toEqual(['board.items'])
    const Shaped = variant('ShapedBoard', { uses: { board: shared({ presence: 'peers', history: 'history', shape: { items: collection() } }) } })
    const b = client(createNetwork(), 'bob', { component: Shaped })
    await b.t.settle()
    expect(b.t.diagnostics.filter((d) => d.code == 'SYG261')).toEqual([])
  })
})

describe('seeding', () => {
  // a provider that syncs when told to ('sync' event, as y-websocket)
  const lateProvider = (peer) => {
    const ls = new Set()
    return { awareness: peer.awareness, synced: false, on: (e, f) => e == 'sync' && ls.add(f), off: (e, f) => ls.delete(f), sync() { this.synced = true; for (const f of ls) f(true) } }
  }
  it('whenSynced (default): nothing is written before the first sync; an empty document is then seeded', async () => {
    const net = createNetwork(), peer = net.join(), p = lateProvider(peer)
    const t = renderComponent(Board, { drivers: { SHARED: makeYjsDriver({ doc: peer.doc, provider: p, captureTimeout: 0 }) } })
    await t.settle()
    t.simulateAction('ADD', { id: 'x', text: 'before sync' })
    await t.settle()
    expect(peer.doc.getMap('board').size).toBe(0)
    p.sync()
    await t.settle()
    expect(docOf(peer.doc).items).toEqual([{ id: 'x', text: 'before sync', done: false }])
  })
  it("whenSynced: a document with content wins over initialState; the app's edits from before the sync are kept", async () => {
    const net = createNetwork()
    const a = client(net, 'ann')
    await a.act('ADD', { id: 'a1', text: 'server' })
    await a.act('RENAME', 'Shared title')
    // bob's provider hasn't synced: his app runs on initialState and he adds an item
    const peer = net.join(), p = lateProvider(peer)
    const t = renderComponent(Board, { drivers: { SHARED: makeYjsDriver({ doc: peer.doc, provider: p, captureTimeout: 0 }) } })
    await t.settle()
    t.simulateAction('ADD', { id: 'b1', text: 'offline' })
    await t.settle()
    expect(t.state.board.title).toBe('Todo')
    p.sync()
    await until(() => t.state.board.items.length === 2 && a.ids().length === 2)
    expect(t.state.board.title).toBe('Shared title')
    expect(t.state.board.items.map((x) => x.id)).toEqual(['a1', 'b1'])
  })
  it("ifEmpty seeds at once, without waiting for a provider", async () => {
    const net = createNetwork(), peer = net.join(), p = lateProvider(peer)
    const C = variant('LocalBoard', { uses: { board: shared({ presence: 'peers', history: 'history', seed: 'ifEmpty' }) } })
    const t = renderComponent(C, { drivers: { SHARED: makeYjsDriver({ doc: peer.doc, provider: p, captureTimeout: 0 }) } })
    await t.settle()
    expect(docOf(peer.doc)).toEqual({ title: 'Todo', items: [] })
  })
  it('a provider with whenSynced (y-indexeddb) or a `synced` promise gates seeding too', async () => {
    let done
    const synced = new Promise((r) => { done = r })
    const doc = new Y.Doc()
    const t = renderComponent(Board, { drivers: { SHARED: makeYjsDriver({ doc, provider: { whenSynced: synced }, captureTimeout: 0 }) } })
    await t.settle()
    expect(doc.getMap('board').size).toBe(0)
    done()
    await until(() => doc.getMap('board').size > 0)
    t.dispose()
  })
})

describe('LOCAL per flush', () => {
  it('a burst of 100 actions is one local Yjs transaction', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    await a.t.settle()
    let updates = 0
    a.peer.doc.on('update', (_, origin) => { if (origin !== undefined && typeof origin == 'object' && !(origin instanceof Y.UndoManager)) updates++ })
    for (let i = 0; i < 100; i++) a.t.simulateAction('ADD', { id: 'i' + i, text: 't' + i })
    await a.t.settle()
    expect(updates).toBe(1)
    await until(() => b.ids().length === 100)
    expect(converged(a, b)).toBe(true)
  })
})

describe('REMOTE', () => {
  it('two remote changes in a row and a local edit: the local write never reverts the newer remote value', async () => {
    const net = createNetwork()
    const b = client(net, 'bob')
    await b.act('ADD', { id: 'x', text: 'a' })
    await b.act('ADD', { id: 'y', text: 'y' })
    // a raw peer edits x's text twice, in two transactions, before bob's app runs
    const raw = net.join(), m = raw.doc.getMap('board.items#c')
    raw.doc.transact(() => m.get('x').set('text', 'ab'))
    raw.doc.transact(() => m.get('x').set('text', 'abc'))
    b.t.simulateAction('TOGGLE', 'y')
    await b.t.settle()
    await until(() => b.board().items[0].text === 'abc')
    await tick(); await b.t.settle()
    expect(docOf(raw.doc).items[0].text).toBe('abc')
    expect(b.board().items).toEqual([{ id: 'x', text: 'abc', done: false }, { id: 'y', text: 'y', done: true }])
  })
  it('LOCAL and REMOTE are built-in actions in the action log (DevTools hides them); PRESENCE is not', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    await a.act('ADD', { id: 'x', text: 'x' })
    await until(() => b.ids().length === 1)
    await b.t.settle()
    const causes = (t, type) => [...new Set(t.actions.filter((x) => x.type == type).map((x) => x.cause))]
    expect(causes(a.t, 'board.LOCAL')).toEqual(['built-in'])
    expect(causes(b.t, 'board.REMOTE')).toEqual(['built-in'])
    expect(causes(b.t, 'board.HISTORY')).toEqual(['behavior'])
  })
})

describe('commands and diagnostics', () => {
  it('{ connect: false } / { connect: true } take the provider offline and back', async () => {
    const C = variant('NetBoard', { model: { ...Board.model, NET: { SHARED: (_, on) => ({ connect: on }) } } })
    const net = createNetwork()
    const a = client(net, 'ann', { component: C }), b = client(net, 'bob')
    await a.act('NET', false)
    expect(a.peer.isOnline).toBe(false)
    await a.act('ADD', { id: 'x', text: 'offline' })
    await tick()
    expect(b.ids()).toEqual([])
    await a.act('NET', true)
    await until(() => b.ids().length === 1)
  })
  it('SYG260 (dev): undo() on a shared() key points to the per-user undo command', async () => {
    const C = variant('UndoBoard', { uses: { board: shared(), undo: undo({ key: 'board' }) } })
    const t = renderComponent(C, { drivers: { SHARED: makeYjsDriver({ doc: new Y.Doc() }) } })
    await t.settle()
    const d = t.diagnostics.find((x) => x.code == 'SYG260')
    expect(d.severity).toBe('warn')
    expect(d.message).toContain("records 'board'")
    expect(d.fix).toContain("UNDO: { SHARED: { undo: 'board' } }")
  })
  it('without the driver the reducers still run (renderComponent: the LOCAL value is a driverless sink)', async () => {
    const t = renderComponent(Board)
    t.simulateAction('ADD', { id: 'x', text: 'x' })
    await t.settle()
    expect(t.state.board.items).toHaveLength(1)
    expect(t.sinkValues('SHARED').at(-1)).toMatchObject({ key: 'board', value: t.state.board })
  })
  it("shared() keeps the host's initialState (ownsState: false) and adds no slice", () => {
    const b = shared()
    expect(b.ownsState).toBe(false)
    const c = { model: {}, initialState: { board: { title: 'x' } }, stateSourceName: 'STATE' }
    b.merge(c, 'board')
    expect(c.initialState).toEqual({ board: { title: 'x' } })
    expect(Object.keys(c.model)).toEqual(['board.LOCAL', 'board.REMOTE'])
  })
})

describe('the driver alone', () => {
  it('a client that saw the document seeded before it started still gets every later change (run() subscribes at once)', () => {
    const net = createNetwork(), a = net.join(), b = net.join()
    const sa = xs.create(), sb = xs.create()
    makeYjsDriver({ doc: a.doc, provider: a })(sa)
    const so = makeYjsDriver({ doc: b.doc, provider: b })(sb)
    const got = []
    so.remote('board').addListener({ next: (r) => { got.push(r.value); sb.shamefullySendNext({ key: 'board', value: r.value }) } })
    const s0 = { title: 'T', items: [{ id: 'm', text: 'Milk' }] }
    // ann seeds while bob's slice exists but hasn't had its first value: bob's document gets
    // placeholder root types, made real by its first read
    sa.shamefullySendNext({ key: 'board', value: s0 })
    sb.shamefullySendNext({ key: 'board', value: s0 })
    sa.shamefullySendNext({ key: 'board', value: { ...s0, items: [...s0.items, { id: 'b', text: 'Bread' }] } })
    expect(got.at(-1).items.map((x) => x.id)).toEqual(['m', 'b'])
  })

  it('presence: the others only, and never in the document', () => {
    const net = createNetwork(), a = net.join(), b = net.join()
    const sa = xs.create(), so = makeYjsDriver({ doc: a.doc, provider: a })(sa)
    const seen = []
    so.presence().addListener({ next: (p) => seen.push(p) })
    b.awareness.setLocalState({ name: 'bob' })
    sa.shamefullySendNext({ presence: { name: 'ann' } })
    expect(seen.at(-1)).toEqual([{ id: b.doc.clientID, name: 'bob' }])
    expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ name: 'ann' })
    expect(a.doc.share.size).toBe(0)
  })
})
