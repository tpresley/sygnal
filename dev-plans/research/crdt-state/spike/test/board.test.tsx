// Two (or three) Sygnal apps, each with its own Y.Doc, syncing through the in-memory network.
import { describe, it, expect } from 'vitest'
import { client, createNetwork, until, tick } from './helpers.ts'
import { read } from '../lib/mapping.ts'

const converged = (...cs: any[]) => {
  const first = JSON.stringify(cs[0].board())
  return cs.every((c) => JSON.stringify(c.board()) === first && JSON.stringify(read(c.peer.doc.getMap('board'), 'board')) === first)
}
const texts = (c: any) => c.board().items.map((x: any) => x.text)

describe('collaborative board (Yjs)', () => {
  it('a client that joins later gets the document, not its own initialState', async () => {
    const net = createNetwork()
    const a = client(net, 'ann')
    await a.act('ADD', { id: 'a1', text: 'one' })
    await a.act('RENAME', 'Sprint 7')
    const b = client(net, 'bob')
    await until(() => b.ids().length === 1)
    expect(b.board()).toEqual({ title: 'Sprint 7', items: [{ id: 'a1', text: 'one', done: false }] })
    expect(b.t.html()).toContain('Sprint 7')
  })

  it('concurrent adds while offline: both kept, same order everywhere', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    a.peer.offline(); b.peer.offline()
    await a.act('ADD', { id: 'a1', text: 'from ann' })
    await b.act('ADD', { id: 'b1', text: 'from bob' })
    a.peer.online(); b.peer.online()
    await until(() => converged(a, b))
    expect(a.ids().sort()).toEqual(['a1', 'b1'])
  })

  it('concurrent edits to different fields of one item both survive', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    await a.act('ADD', { id: 'x', text: 'draft' })
    await until(() => b.ids().length === 1)
    a.peer.offline()
    await a.act('EDIT', { id: 'x', text: 'final' })
    await b.act('TOGGLE', 'x')
    a.peer.online()
    await until(() => converged(a, b))
    expect(a.board().items).toEqual([{ id: 'x', text: 'final', done: true }])
  })

  it('a move and a concurrent edit of the moved item: moved, edited, not duplicated', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    for (const id of ['1', '2', '3', '4']) await a.act('ADD', { id, text: 't' + id })
    await until(() => b.ids().length === 4)
    a.peer.offline()
    await a.act('MOVE', { id: '4', to: 0 })
    await b.act('EDIT', { id: '4', text: 'edited' })
    a.peer.online()
    await until(() => converged(a, b))
    expect(a.ids()).toEqual(['4', '1', '2', '3'])
    expect(a.board().items[0].text).toBe('edited')
  })

  it('the same item moved to two places concurrently ends in one place', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    for (const id of ['1', '2', '3', '4']) await a.act('ADD', { id, text: id })
    await until(() => b.ids().length === 4)
    a.peer.offline()
    await a.act('MOVE', { id: '1', to: 3 })   // 2 3 4 1
    await b.act('MOVE', { id: '1', to: 1 })   // 2 1 3 4
    a.peer.online()
    await until(() => converged(a, b))
    expect(a.ids().sort()).toEqual(['1', '2', '3', '4'])
    expect(['2,3,4,1', '2,1,3,4']).toContain(a.ids().join())  // one of the two moves wins (LWW on the order key)
  })

  it('a delete wins over a concurrent edit', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    await a.act('ADD', { id: 'x', text: 'x' })
    await a.act('ADD', { id: 'y', text: 'y' })
    await until(() => b.ids().length === 2)
    a.peer.offline()
    await a.act('REMOVE', 'x')
    await b.act('EDIT', { id: 'x', text: 'edited' })
    a.peer.online()
    await until(() => converged(a, b))
    expect(a.ids()).toEqual(['y'])
  })

  it('offline merge: a long offline session with adds, edits, moves and removes on both sides', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob'), c = client(net, 'cy')
    for (const id of ['1', '2', '3']) await a.act('ADD', { id, text: 'v0-' + id })
    await until(() => c.ids().length === 3 && b.ids().length === 3)
    b.peer.offline()
    await a.act('EDIT', { id: '1', text: 'ann-1' })
    await a.act('REMOVE', '3')
    await a.act('ADD', { id: 'a4', text: 'ann-new' })
    await c.act('TOGGLE', '2')
    await b.act('MOVE', { id: '2', to: 0 })
    await b.act('EDIT', { id: '2', text: 'bob-2' })
    await b.act('ADD', { id: 'b5', text: 'bob-new' })
    await b.act('RENAME', 'Bob was offline')
    await until(() => converged(a, c))
    b.peer.online()
    await until(() => converged(a, b, c))
    expect(a.board().title).toBe('Bob was offline')
    const byId = Object.fromEntries(a.board().items.map((x: any) => [x.id, x]))
    expect(Object.keys(byId).sort()).toEqual(['1', '2', 'a4', 'b5'])
    expect(byId['1'].text).toBe('ann-1')
    expect(byId['2']).toEqual({ id: '2', text: 'bob-2', done: true })
    expect(a.ids()[0]).toBe('2')
  })

  it('concurrent typing in one text field merges by character (text: [field])', async () => {
    const net = createNetwork()
    const opts = { text: ['text'] }
    const a = client(net, 'ann', opts), b = client(net, 'bob', opts)
    await a.act('ADD', { id: 'x', text: 'hello' })
    await until(() => b.ids().length === 1)
    a.peer.offline()
    await a.act('EDIT', { id: 'x', text: 'oh hello' })
    await b.act('EDIT', { id: 'x', text: 'hello world' })
    a.peer.online()
    await until(() => converged(a, b))
    expect(texts(a)).toEqual(['oh hello world'])
  })

  it('without text: [field], the same edits are last-writer-wins on the whole string', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    await a.act('ADD', { id: 'x', text: 'hello' })
    await until(() => b.ids().length === 1)
    a.peer.offline()
    await a.act('EDIT', { id: 'x', text: 'oh hello' })
    await b.act('EDIT', { id: 'x', text: 'hello world' })
    a.peer.online()
    await until(() => converged(a, b))
    expect(['oh hello', 'hello world']).toContain(texts(a)[0])
  })

  it('presence: names and what each peer is editing, outside the shared state', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    await a.act('JOIN'); await b.act('JOIN')
    await a.act('ADD', { id: 'x', text: 'x' })
    await a.act('FOCUS', 'x')
    await until(() => b.t.state.peers.some((p: any) => p.editing === 'x'))
    expect(b.t.state.peers.map((p: any) => p.name)).toEqual(['ann'])
    expect(a.t.state.peers.map((p: any) => p.name)).toEqual(['bob'])
    expect(b.t.html()).toMatch(/<em class="peer">ann<\/em>/)
    expect(JSON.stringify(read(a.peer.doc.getMap('board'), 'board'))).not.toContain('ann')
  })

  it("undo is per user: ann's undo reverts ann's change, not bob's later one", async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    await a.act('ADD', { id: 'a1', text: 'ann' })
    await until(() => b.ids().length === 1)
    await b.act('ADD', { id: 'b1', text: 'bob' })
    await until(() => a.ids().length === 2)
    expect(a.t.state.history.canUndo).toBe(true)
    await a.act('UNDO')
    await until(() => converged(a, b) && a.ids().length === 1)
    expect(a.ids()).toEqual(['b1'])
    await a.act('REDO')
    await until(() => converged(a, b) && a.ids().length === 2)
  })

  it('a remote change keeps the identity of the items it did not touch (Collection items skip render)', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    await a.act('ADD', { id: '1', text: '1' })
    await a.act('ADD', { id: '2', text: '2' })
    await until(() => b.ids().length === 2)
    const before = b.board().items
    await a.act('EDIT', { id: '2', text: 'two' })
    await until(() => b.board().items[1].text === 'two')
    expect(b.board().items[0]).toBe(before[0])
    expect(b.board().items[1]).not.toBe(before[1])
  })

  it('two clients seeding the same initial items (same ids) offline do not duplicate them', async () => {
    const net = createNetwork()
    const initialState = { board: { title: 'Todo', items: [{ id: 's1', text: 'seed', done: false }] } }
    const a = client(net, 'ann', { initialState }); a.peer.offline()
    const b = client(net, 'bob', { initialState }); b.peer.offline()
    await tick()
    a.peer.online(); b.peer.online()
    await until(() => converged(a, b))
    expect(a.ids()).toEqual(['s1'])
  })

  it('through the DOM: ann types and clicks Add, bob sees it and ticks it, ann sees the tick', async () => {
    const net = createNetwork()
    const a = client(net, 'ann'), b = client(net, 'bob')
    a.t.simulateEvent('.draft', 'input', { target: { value: 'Buy milk' } })
    a.t.simulateEvent('.add', 'click')
    await a.t.settle()
    await until(() => b.ids().length === 1)
    expect(b.t.html()).toContain('Buy milk')
    b.t.simulateEvent('.toggle', 'change', { target: { closest: () => ({ dataset: { id: b.ids()[0] } }) } as any })
    await b.t.settle()
    await until(() => a.board().items[0].done === true)
    expect(a.t.state.draft).toBe('')
  })
})
