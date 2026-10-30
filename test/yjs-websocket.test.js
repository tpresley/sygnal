// sygnal/yjs over a real network (ported from the spike's test/websocket.test.tsx): two apps with
// y-websocket's stock WebsocketProvider (Node `ws`) and a y-websocket-protocol server on a free
// port in this process. The server is the protocol's room relay in a few lines of y-protocols (the
// spike used @y/websocket-server 0.1.1, whose optional y-leveldb dependency installs leveldown:
// not worth it in the root's devDependencies). Covers sync, whenSynced seeding, presence and an
// offline period (disconnect / connect).
import { it, expect, afterAll } from 'vitest'
import * as Y from 'yjs'
import { WebSocketServer, WebSocket } from 'ws'
import { WebsocketProvider } from 'y-websocket'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { renderComponent } from '../src/extra/testing.js'
import { makeYjsDriver } from '../src/yjs.ts'
import { Board } from './fixtures/yjs/board.js'
import { until } from './fixtures/yjs/helpers.js'

// one room: a server-side document and awareness; every message is relayed as y-websocket does
const MSG_SYNC = 0, MSG_AWARENESS = 1
const room = { doc: new Y.Doc(), conns: new Map() }
room.awareness = new awarenessProtocol.Awareness(room.doc)
room.awareness.setLocalState(null)
const send = (conn, m) => { if (conn.readyState === WebSocket.OPEN) conn.send(m) }
const broadcast = (m) => { for (const c of room.conns.keys()) send(c, m) }
room.doc.on('update', (u) => {
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, MSG_SYNC); syncProtocol.writeUpdate(e, u)
  broadcast(encoding.toUint8Array(e))
})
room.awareness.on('update', ({ added, updated, removed }, conn) => {
  const changed = [...added, ...updated, ...removed]
  if (conn) { const ids = room.conns.get(conn); added.forEach((id) => ids.add(id)); removed.forEach((id) => ids.delete(id)) }
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, MSG_AWARENESS)
  encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed))
  broadcast(encoding.toUint8Array(e))
})
const wss = new WebSocketServer({ port: 0 })
wss.on('connection', (conn) => {
  conn.binaryType = 'arraybuffer'
  room.conns.set(conn, new Set())
  conn.on('message', (data) => {
    const d = decoding.createDecoder(new Uint8Array(data)), e = encoding.createEncoder()
    const type = decoding.readVarUint(d)
    if (type === MSG_SYNC) {
      encoding.writeVarUint(e, MSG_SYNC)
      syncProtocol.readSyncMessage(d, e, room.doc, conn)
      if (encoding.length(e) > 1) send(conn, encoding.toUint8Array(e))
    } else if (type === MSG_AWARENESS) awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(d), conn)
  })
  conn.on('close', () => {
    awarenessProtocol.removeAwarenessStates(room.awareness, [...room.conns.get(conn)], null)
    room.conns.delete(conn)
  })
  // sync step 1, and the current presence
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, MSG_SYNC); syncProtocol.writeSyncStep1(e, room.doc)
  send(conn, encoding.toUint8Array(e))
  const states = [...room.awareness.getStates().keys()]
  if (states.length) {
    const a = encoding.createEncoder()
    encoding.writeVarUint(a, MSG_AWARENESS)
    encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, states))
    send(conn, encoding.toUint8Array(a))
  }
})
const url = `ws://127.0.0.1:${wss.address().port}`
afterAll(() => new Promise((r) => wss.close(() => r())))

const client = (name) => {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(url, 'room-1', doc, { WebSocketPolyfill: WebSocket })
  const t = renderComponent(Board, {
    initialState: { ...Board.initialState, me: { name } },
    drivers: { SHARED: makeYjsDriver({ doc, provider, captureTimeout: 0 }) },
  })
  const act = async (n, d) => { t.simulateAction(n, d); await t.settle() }
  return { t, provider, act, ids: () => t.state.board.items.map((x) => x.id) }
}

it('two apps through a y-websocket server: sync, presence, offline edits merged on reconnect', async () => {
  const a = client('ann')
  await until(() => a.provider.synced)
  // whenSynced: seeded once the provider synced with the (empty) room
  await until(() => room.doc.getMap('board').size > 0)
  const b = client('bob')
  await until(() => b.provider.synced)
  await a.act('JOIN'); await b.act('JOIN')
  await a.act('ADD', { id: '1', text: 'one' })
  await until(() => b.ids().length === 1)
  await until(() => a.t.state.peers.some((p) => p.name === 'bob') && b.t.state.peers.some((p) => p.name === 'ann'))

  b.provider.disconnect()
  await b.act('ADD', { id: 'b2', text: 'offline' })
  await a.act('EDIT', { id: '1', text: 'online edit' })
  await a.act('ADD', { id: 'a3', text: 'three' })
  b.provider.connect()
  await until(() => JSON.stringify(a.t.state.board) === JSON.stringify(b.t.state.board) && a.ids().length === 3, 5000)
  expect(b.t.state.board.items.find((x) => x.id === '1').text).toBe('online edit')
  a.provider.destroy(); b.provider.destroy(); a.t.dispose(); b.t.dispose()
})
