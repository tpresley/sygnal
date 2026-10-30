/*
 * 'sygnal/yjs/testing': createNetwork(), an in-memory Yjs "network" for tests and demos (no server).
 * Each peer's document updates and awareness updates are relayed to the other online peers as
 * encoded bytes, as y-websocket would; offline peers miss them and catch up on reconnect with the
 * same state-vector exchange y-websocket's sync steps 1 and 2 do. `bytes` / `messages` count what
 * crossed it. A peer is a provider for makeYjsDriver({ doc, provider: peer }): its `awareness`,
 * `synced` (a peer syncs with the online peers when it joins), `connect()` / `disconnect()`.
 */
import * as Y from 'yjs'
import {Awareness, encodeAwarenessUpdate, applyAwarenessUpdate} from 'y-protocols/awareness'

const NET = {}

export interface Peer {
  doc: Y.Doc
  awareness: Awareness
  /** true: the peer has synced with the online peers (at join) */
  synced: boolean
  readonly isOnline: boolean
  /** stop relaying (local changes stay in the document) */
  offline(): void
  /** relay again, after a state-vector sync with every online peer */
  online(): void
  /** provider aliases of online() / offline(): makeYjsDriver's `{ connect: boolean }` command */
  connect(): void
  disconnect(): void
  /** leave the network for good (its awareness state is removed from the others) */
  leave(): void
}

export interface Network {
  /** a new peer (a new Y.Doc unless one is given), synced with the online peers */
  join(doc?: Y.Doc): Peer
  readonly peers: Peer[]
  /** bytes and messages relayed so far (document updates and syncs) */
  bytes: number
  messages: number
}

export const createNetwork = (): Network => {
  const all: {doc: Y.Doc; awareness: Awareness; online: boolean; peer: Peer}[] = []
  // sync steps 1 and 2 both ways, plus the current awareness states
  const sync = (a: any, b: any) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      const u = Y.encodeStateAsUpdate(x.doc, Y.encodeStateVector(y.doc))
      net.bytes += u.length; net.messages++
      Y.applyUpdate(y.doc, u, NET)
      applyAwarenessUpdate(y.awareness, encodeAwarenessUpdate(x.awareness, [...x.awareness.getStates().keys()]), NET)
    }
  }
  const net: Network = {
    bytes: 0, messages: 0,
    get peers() { return all.map((p) => p.peer) },
    join(doc = new Y.Doc()) {
      const awareness = new Awareness(doc)
      const p: any = {doc, awareness, online: true}
      const relay = () => all.filter((q) => q !== p && q.online)
      const onUpdate = (u: Uint8Array, origin: any) => {
        if (origin === NET || !p.online) return
        for (const q of relay()) { net.bytes += u.length; net.messages++; Y.applyUpdate(q.doc, u, NET) }
      }
      const onAwareness = ({added, updated, removed}: any, origin: any) => {
        if (origin === NET || !p.online) return
        const u = encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])
        for (const q of relay()) applyAwarenessUpdate(q.awareness, u, NET)
      }
      doc.on('update', onUpdate)
      awareness.on('update', onAwareness)
      const on = () => { p.online = true; for (const q of relay()) sync(p, q) }
      const off = () => { p.online = false }
      p.peer = {
        doc, awareness, synced: true,
        get isOnline() { return p.online },
        offline: off, online: on, connect: on, disconnect: off,
        leave() {
          awareness.setLocalState(null)
          off()
          doc.off('update', onUpdate)
          awareness.off('update', onAwareness)
          // its 'outdated' timer would keep a process alive
          awareness.destroy()
          all.splice(all.indexOf(p), 1)
        },
      } as Peer
      all.push(p)
      for (const q of relay()) sync(p, q)
      return p.peer
    },
  }
  return net
}
