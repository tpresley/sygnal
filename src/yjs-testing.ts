/*
 * 'sygnal/yjs/testing': createNetwork(), an in-memory network of Yjs peers for tests and demos
 * (no server): `const net = createNetwork(), peer = net.join()`, then
 * `makeYjsDriver({ doc: peer.doc, provider: peer })`; `peer.offline()` / `peer.online()`.
 */
export {createNetwork} from './yjs/testing'
export type {Network, Peer} from './yjs/testing'
