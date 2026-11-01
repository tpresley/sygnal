/*
 * An in-memory Yjs "network" for tests (research spike): each peer's document updates and awareness
 * updates are relayed to the other online peers as encoded bytes, as y-websocket would; offline
 * peers miss them and catch up on reconnect with the same state-vector exchange y-websocket's sync
 * step 1/2 does (encodeStateVector -> encodeStateAsUpdate(doc, vector)). `bytes` counts what crossed it.
 */
import * as Y from 'yjs'
import {Awareness, encodeAwarenessUpdate, applyAwarenessUpdate} from 'y-protocols/awareness'

const NET = {}

export const createNetwork = () => {
  const peers: {doc: Y.Doc; awareness: Awareness; online: boolean}[] = []
  const net = {
    bytes: 0, messages: 0,
    join(doc = new Y.Doc()) {
      const awareness = new Awareness(doc)
      const p = {doc, awareness, online: true}
      peers.push(p)
      doc.on('update', (u: Uint8Array, origin: any) => {
        if (origin === NET || !p.online) return
        for (const q of peers) if (q !== p && q.online) { net.bytes += u.length; net.messages++; Y.applyUpdate(q.doc, u, NET) }
      })
      awareness.on('update', ({added, updated, removed}: any, origin: any) => {
        if (origin === NET || !p.online) return
        const u = encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])
        for (const q of peers) if (q !== p && q.online) applyAwarenessUpdate(q.awareness, u, NET)
      })
      for (const q of peers) if (q !== p && q.online) sync(p, q)
      return {
        doc, awareness,
        offline() { p.online = false },
        online() {
          p.online = true
          for (const q of peers) if (q !== p && q.online) sync(p, q)
        },
      }
    },
  }
  // sync steps 1 and 2 both ways, plus the current awareness states
  const sync = (a: any, b: any) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      const u = Y.encodeStateAsUpdate(x.doc, Y.encodeStateVector(y.doc))
      net.bytes += u.length; net.messages++
      Y.applyUpdate(y.doc, u, NET)
      applyAwarenessUpdate(y.awareness, encodeAwarenessUpdate(x.awareness, [...x.awareness.getStates().keys()]), NET)
    }
  }
  return net
}
