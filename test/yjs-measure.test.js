// sygnal/yjs measurements (from the spike's test/measure.test.tsx). A quick run checks the numbers
// are sane; MEASURE=1 runs 10 / 100 / 1000 items and prints them. Driver level: the bytes of the
// Yjs update per operation and the time of a local write, and of the remote side (the incremental
// read + reconcile of the peer's driver). App level: Yjs transactions for a burst of actions.
import { it, expect } from 'vitest'
import * as Y from 'yjs'
import xs from 'xstream'
import { makeYjsDriver } from '../src/yjs.ts'
import { client, createNetwork } from './fixtures/yjs/helpers.js'

const FULL = !!process.env.MEASURE
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1]

const driverLevel = (n, reps) => {
  const doc = new Y.Doc(), peer = new Y.Doc(), sink = xs.create(), peerSink = xs.create()
  makeYjsDriver({ doc, undo: false, text: ['text'] })(sink)
  // the peer's driver: its remote side is what a remote change costs a client
  const ps = makeYjsDriver({ doc: peer, undo: false, text: ['text'] })(peerSink)
  let remote = 0
  ps.remote('board').addListener({ next: ({ value }) => peerSink.shamefullySendNext({ key: 'board', value }) })
  peer.on('beforeTransaction', () => { remote = performance.now() })
  const remoteMs = []
  peer.on('afterTransaction', () => remoteMs.push(performance.now() - remote))
  let bytes = 0
  doc.on('update', (u) => { bytes += u.length; Y.applyUpdate(peer, u) })
  let s = { title: 'Todo', items: Array.from({ length: n }, (_, i) => ({ id: 'id' + i, text: 'item number ' + i, done: false })) }
  sink.shamefullySendNext({ key: 'board', value: s })
  peerSink.shamefullySendNext({ key: 'board', value: s })
  const op = (name, f) => {
    const out = []
    for (let r = 0; r < reps; r++) {
      bytes = 0; remoteMs.length = 0
      s = f(s)
      const t0 = performance.now()
      sink.shamefullySendNext({ key: 'board', value: s })
      // the local write's time is the whole send minus the peer's transaction
      out.push({ bytes, ms: performance.now() - t0 - remoteMs.reduce((a, b) => a + b, 0), remote: remoteMs.reduce((a, b) => a + b, 0) })
    }
    return [name, { bytes: median(out.map((w) => w.bytes)), ms: +median(out.map((w) => w.ms)).toFixed(3), remoteMs: +median(out.map((w) => w.remote)).toFixed(3) }]
  }
  const mid = (s) => s.items[s.items.length >> 1]
  const set = (s, id, f) => ({ ...s, items: s.items.map((x) => (x.id === id ? f(x) : x)) })
  let k = 0
  return {
    items: n,
    ops: Object.fromEntries([
      op('toggle', (s) => set(s, mid(s).id, (x) => ({ ...x, done: !x.done }))),
      op('type one character (Y.Text)', (s) => set(s, mid(s).id, (x) => ({ ...x, text: x.text + 'a' }))),
      op('add', (s) => ({ ...s, items: [...s.items, { id: 'new' + k++, text: 'a new item', done: false }] })),
      op('move last to first', (s) => ({ ...s, items: [s.items.at(-1), ...s.items.slice(0, -1)] })),
      op('remove', (s) => ({ ...s, items: s.items.filter((x) => x !== mid(s)) })),
      op('rename board', (s) => ({ ...s, title: 'Todo ' + k++ })),
    ]),
    docBytesAfterOps: Y.encodeStateAsUpdate(doc).length,
  }
}

it('bytes per op stay small; a burst of actions is one transaction', async () => {
  const driver = (FULL ? [10, 100, 1000] : [10, 100]).map((n) => driverLevel(n, FULL ? 41 : 5))
  for (const d of driver) for (const o of Object.values(d.ops)) expect(o.bytes).toBeLessThan(200)
  const net = createNetwork(), a = client(net, 'ann')
  const N = FULL ? 2000 : 100
  for (let i = 0; i < 100; i++) a.t.simulateAction('ADD', { id: 'id' + i, text: 't' + i })
  await a.t.settle()
  let writes = 0
  a.peer.doc.on('update', () => writes++)
  const t0 = performance.now()
  for (let i = 0; i < N; i++) a.t.simulateAction('EDIT', { id: 'id' + (i % 100), text: 'e' + i })
  await a.t.settle()
  const app = { actions: N, msPerAction: +((performance.now() - t0) / N).toFixed(4), yjsTransactions: writes }
  expect(writes).toBe(1)
  if (FULL) process.stdout.write(JSON.stringify({ node: process.version, yjs: '13.6.33', driver, app }, null, 2) + '\n')
}, 600000)
