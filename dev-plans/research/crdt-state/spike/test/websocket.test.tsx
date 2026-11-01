// The same app over a real network: a y-websocket server (@y/websocket-server) on a free port in
// this process, two clients with y-websocket's WebsocketProvider (Node `ws`). Covers sync, presence
// and an offline period (disconnect / connect) on the stock provider.
import { it, expect, afterAll } from 'vitest'
import * as Y from 'yjs'
import { WebSocketServer, WebSocket } from 'ws'
import { WebsocketProvider } from 'y-websocket'
import { setupWSConnection } from '@y/websocket-server/utils'
import { renderComponent } from 'sygnal'
import { Board } from '../app/Board.tsx'
import { makeYjsDriver } from '../lib/sygnal-yjs.ts'
import { until } from './helpers.ts'

const wss = new WebSocketServer({ port: 0 })
wss.on('connection', (conn, req) => setupWSConnection(conn, req, { docName: 'room-1' }))
const url = `ws://127.0.0.1:${(wss.address() as any).port}`
afterAll(() => new Promise<void>((r) => wss.close(() => r())))

const client = (name: string) => {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(url, 'room-1', doc, { WebSocketPolyfill: WebSocket as any })
  const t = renderComponent(Board, {
    initialState: { ...Board.initialState, me: { name } },
    drivers: { SHARED: makeYjsDriver({ doc, awareness: provider.awareness, captureTimeout: 0 }) },
  })
  const act = async (n: string, d?: any) => { t.simulateAction(n, d); await t.settle() }
  return { t, provider, act, ids: () => t.state.board.items.map((x: any) => x.id) }
}

it('two apps through a y-websocket server: sync, presence, offline edits merged on reconnect', async () => {
  const a = client('ann')
  await until(() => a.provider.synced)
  const b = client('bob')
  await until(() => b.provider.synced)
  await a.act('JOIN'); await b.act('JOIN')
  await a.act('ADD', { id: '1', text: 'one' })
  await until(() => b.ids().length === 1)
  await until(() => a.t.state.peers.some((p: any) => p.name === 'bob') && b.t.state.peers.some((p: any) => p.name === 'ann'))

  b.provider.disconnect()
  await b.act('ADD', { id: 'b2', text: 'offline' })
  await a.act('EDIT', { id: '1', text: 'online edit' })
  await a.act('ADD', { id: 'a3', text: 'three' })
  b.provider.connect()
  await until(() => JSON.stringify(a.t.state.board) === JSON.stringify(b.t.state.board) && a.ids().length === 3, 5000)
  expect(b.t.state.board.items.find((x: any) => x.id === '1').text).toBe('online edit')
  a.provider.destroy(); b.provider.destroy(); a.t.dispose(); b.t.dispose()
})
