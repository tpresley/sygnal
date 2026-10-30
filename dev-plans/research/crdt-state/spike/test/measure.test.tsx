// Measurements (MEASURE=1 writes ../measurements.json; otherwise a quick run that only checks
// the numbers are sane). Driver level: bytes of the Yjs update per operation and the time of a
// local write (diff + transaction) and of a remote read (read + reconcile), at 10 / 100 / 1000 items.
// App level: an action's cost with and without `uses: { board: shared() }`.
import { it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import * as Y from 'yjs'
import xs from 'xstream'
import { renderComponent } from 'sygnal'
import { makeYjsDriver } from '../lib/sygnal-yjs.ts'
import { read, reconcile } from '../lib/mapping.ts'
import { Board } from '../app/Board.tsx'
import { createNetwork } from '../lib/memoryProvider.ts'

const FULL = !!process.env.MEASURE
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[a.length >> 1]
const enc = (v: any) => new TextEncoder().encode(JSON.stringify(v)).length

const driverLevel = (n: number, reps: number) => {
  const doc = new Y.Doc(), peer = new Y.Doc(), sink = xs.create<any>()
  const writes: { bytes: number; ms: number }[] = []
  makeYjsDriver({ doc, undo: false, text: ['text'], onWrite: (w) => writes.push(w) })(sink)
  doc.on('update', (u: Uint8Array) => Y.applyUpdate(peer, u))
  let s: any = { title: 'Todo', items: Array.from({ length: n }, (_, i) => ({ id: 'id' + i, text: 'item number ' + i, done: false })) }
  sink.shamefullySendNext({ key: 'board', value: s })
  const op = (name: string, f: (s: any) => any) => {
    const out: { bytes: number; ms: number }[] = []
    for (let r = 0; r < reps; r++) { writes.length = 0; s = f(s); sink.shamefullySendNext({ key: 'board', value: s }); out.push(writes[0]) }
    return [name, { bytes: median(out.map((w) => w.bytes)), ms: +median(out.map((w) => w.ms)).toFixed(4) }]
  }
  const mid = (s: any) => s.items[s.items.length >> 1]
  const set = (s: any, id: string, f: (x: any) => any) => ({ ...s, items: s.items.map((x: any) => (x.id === id ? f(x) : x)) })
  let k = 0
  const ops = Object.fromEntries([
    op('toggle', (s) => set(s, mid(s).id, (x) => ({ ...x, done: !x.done }))),
    op('type one character (Y.Text)', (s) => set(s, mid(s).id, (x) => ({ ...x, text: x.text + 'a' }))),
    op('add', (s) => ({ ...s, items: [...s.items, { id: 'new' + k++, text: 'a new item', done: false }] })),
    op('move last to first', (s) => ({ ...s, items: [s.items.at(-1), ...s.items.slice(0, -1)] })),
    op('remove', (s) => ({ ...s, items: s.items.filter((x: any) => x !== mid(s)) })),
    op('rename board', (s) => ({ ...s, title: 'Todo ' + k++ })),
  ])
  // remote side: the peer's document as the next state (read + reconcile against the previous state)
  const t0 = performance.now(), R = FULL ? 50 : 5
  let prev = read(peer.getMap('board'), 'board')
  for (let r = 0; r < R; r++) prev = reconcile(prev, read(peer.getMap('board'), 'board'))
  const remoteMs = (performance.now() - t0) / R
  return {
    items: n, ops,
    remoteReadReconcileMs: +remoteMs.toFixed(3),
    sliceJsonBytes: enc(s),
    docBytesAfterOps: Y.encodeStateAsUpdate(doc).length,
  }
}

const appLevel = async (withShared: boolean, n: number) => {
  const C: any = Object.assign((p: any) => Board(p), Board)
  C.componentName = withShared ? 'SharedBoard' : 'PlainBoard'
  if (!withShared) { C.uses = undefined }
  const net = createNetwork(), peer = net.join()
  const items = Array.from({ length: 100 }, (_, i) => ({ id: 'id' + i, text: 't' + i, done: false }))
  const t = renderComponent(C, {
    initialState: { ...Board.initialState, board: { title: 'Todo', items } },
    drivers: withShared ? { SHARED: makeYjsDriver({ doc: peer.doc, captureTimeout: 0 }) } : {},
  })
  await t.settle()
  // n actions dispatched back to back, then one settle: the runtime's own cost per action
  let writes = 0
  if (withShared) peer.doc.on('update', () => writes++)
  const t0 = performance.now()
  for (let i = 0; i < n; i++) t.simulateAction('TOGGLE', 'id' + (i % 100))
  await t.settle()
  const ms = (performance.now() - t0) / n
  t.dispose()
  return { ms: +ms.toFixed(4), writes }
}

it('measures bytes per op and the per-update overhead', async () => {
  const sizes = FULL ? [10, 100, 1000] : [10, 100]
  const driver = sizes.map((n) => driverLevel(n, FULL ? 41 : 5))
  const N = FULL ? 2000 : 100
  // warm up both paths, then interleave
  await appLevel(false, 20); await appLevel(true, 20)
  const plain: number[] = [], sharedMs: number[] = []
  let writes = 0
  for (let r = 0; r < (FULL ? 7 : 1); r++) {
    plain.push((await appLevel(false, N)).ms)
    const s = await appLevel(true, N); sharedMs.push(s.ms); writes = s.writes
  }
  const app = {
    actions: N, items: 100, msPerActionPlain: median(plain), msPerActionShared: median(sharedMs), yjsTransactions: writes,
    note: 'renderComponent (mock DOM), N TOGGLE actions dispatched back to back then one settle(); the shared run includes the LOCAL action, the diff and the Yjs transaction per state change',
  }
  const out = { node: process.version, yjs: '13.6.33', driver, app }
  if (FULL) writeFileSync(new URL('../../measurements.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
  for (const d of driver) for (const o of Object.values(d.ops) as any[]) expect(o.bytes).toBeLessThan(200)
}, 600000)
