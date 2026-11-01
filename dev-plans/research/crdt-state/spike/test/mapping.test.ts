import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import xs from 'xstream'
import { between, writeMap, read } from '../lib/mapping.ts'
import { makeYjsDriver } from '../lib/sygnal-yjs.ts'

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('order keys', () => {
  it('between(a, b) is strictly between, for random sequences of inserts', () => {
    let keys: string[] = []
    for (let n = 0; n < 2000; n++) {
      const i = Math.floor(Math.random() * (keys.length + 1))
      const k = between(i ? keys[i - 1] : '', i < keys.length ? keys[i] : null)
      if (i) expect(k > keys[i - 1]).toBe(true)
      if (i < keys.length) expect(k < keys[i]).toBe(true)
      keys.splice(i, 0, k)
    }
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThan(40)
  })
  it('appending stays short', () => {
    let k = ''
    for (let n = 0; n < 1000; n++) k = between(k, null)
    expect(k.length).toBeLessThan(40)
  })
})

describe('why path-named root types', () => {
  it('two clients that each set a new nested Y.Map under one key: one whole map is lost', () => {
    const a = new Y.Doc(), b = new Y.Doc()
    const ma = new Y.Map(); a.getMap('board').set('items', ma); ma.set('a1', 'ann')
    const mb = new Y.Map(); b.getMap('board').set('items', mb); mb.set('b1', 'bob')
    sync(a, b)
    expect(Object.keys((a.getMap('board').get('items') as Y.Map<any>).toJSON())).toHaveLength(1)
  })
  it('the mapping: both clients create board.items concurrently and both items survive', () => {
    const a = new Y.Doc(), b = new Y.Doc()
    writeMap(a.getMap('board'), {}, { items: [{ id: 'a1' }] }, {}, 'board')
    writeMap(b.getMap('board'), {}, { items: [{ id: 'b1' }] }, {}, 'board')
    sync(a, b)
    expect(read(a.getMap('board'), 'board').items.map((x: any) => x.id)).toEqual(['a1', 'b1'])
    expect(read(b.getMap('board'), 'board')).toEqual(read(a.getMap('board'), 'board'))
  })
})

describe('3-way writes', () => {
  it('a stale local snapshot (older than the document) never reverts a remote change', () => {
    const a = new Y.Doc(), b = new Y.Doc()
    const sink = xs.create<any>()
    makeYjsDriver({ doc: a, undo: false })(sink)
    const s0 = { title: 't', items: [{ id: '1', text: 'one', done: false }, { id: '2', text: 'two', done: false }] }
    sink.shamefullySendNext({ key: 'board', value: s0 })            // seeds
    sync(a, b)
    // bob edits item 2 and removes nothing; it reaches ann's document before ann's state has it
    writeMap(b.getMap('board'), read(b.getMap('board'), 'board'), { ...s0, items: [s0.items[0], { ...s0.items[1], text: 'bob' }] }, {}, 'board')
    sync(a, b)
    // ann's app, still on s0, toggles item 1 (its snapshot doesn't have bob's edit)
    sink.shamefullySendNext({ key: 'board', value: { ...s0, items: [{ ...s0.items[0], done: true }, s0.items[1]] } })
    expect(read(a.getMap('board'), 'board').items).toEqual([{ id: '1', text: 'one', done: true }, { id: '2', text: 'bob', done: false }])
  })
  it('writing a value the document already holds writes nothing (no update event)', () => {
    const a = new Y.Doc()
    const v = { title: 't', items: [{ id: '1', text: 'x' }], tags: ['a', 'b'], meta: { n: 1 } }
    writeMap(a.getMap('board'), {}, v, {}, 'board')
    let updates = 0
    a.on('update', () => updates++)
    a.transact(() => writeMap(a.getMap('board'), { title: 'old' }, v, {}, 'board'))  // a wrong prev, same content
    expect(updates).toBe(0)
  })
  it('one move writes one order key', () => {
    const a = new Y.Doc()
    const items = Array.from({ length: 50 }, (_, i) => ({ id: String(i) }))
    writeMap(a.getMap('l'), {}, { items }, {}, 'l')
    const moved = [items[49], ...items.slice(0, 49)]
    let bytes = 0
    a.on('update', (u: Uint8Array) => (bytes += u.length))
    writeMap(a.getMap('l'), { items }, { items: moved }, {}, 'l')
    expect(read(a.getMap('l'), 'l').items.map((x: any) => x.id)).toEqual(moved.map((x) => x.id))
    expect(bytes).toBeLessThan(40)
  })
})
