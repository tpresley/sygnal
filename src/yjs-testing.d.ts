// 'sygnal/yjs/testing': an in-memory network of Yjs peers for tests and demos (no server).
// Needs yjs and y-protocols (optional peer dependencies).
import type { Doc } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

/** One client on the network; also a provider for `makeYjsDriver({ doc: peer.doc, provider: peer })` */
export interface Peer {
  readonly doc: Doc;
  readonly awareness: Awareness;
  /** a peer syncs with the online peers when it joins */
  readonly synced: boolean;
  readonly isOnline: boolean;
  /** stop relaying: local changes stay in the document until online() */
  offline(): void;
  /** relay again, after a state-vector sync with every online peer (as y-websocket's sync steps 1 and 2) */
  online(): void;
  /** aliases of online() / offline(), for the driver's `{ connect: boolean }` command */
  connect(): void;
  disconnect(): void;
  /** leave the network: its presence is removed from the others and its awareness destroyed (a peer's awareness keeps a timer running until then) */
  leave(): void;
}

export interface Network {
  /** a peer with a new Y.Doc (or the one given), synced with the online peers */
  join(doc?: Doc): Peer;
  readonly peers: Peer[];
  /** bytes and messages relayed so far */
  bytes: number;
  messages: number;
}

/** `const net = createNetwork(), ann = net.join(), bob = net.join()` */
export declare function createNetwork(): Network
