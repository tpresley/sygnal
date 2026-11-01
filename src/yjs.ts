/*
 * 'sygnal/yjs' (experimental; research: dev-plans/research/crdt-state): part of the state tree
 * shared between clients through a Yjs document. `yjs` (and `y-protocols` for awareness) are
 * optional peer dependencies (D209); the app brings its own provider (y-websocket, Hocuspocus,
 * y-webrtc, y-indexeddb, Liveblocks): Sygnal ships no network code.
 *
 *   import { makeYjsDriver, shared } from 'sygnal/yjs'
 *   run(Board, { SHARED: makeYjsDriver({ doc, provider }) })
 *   Board.uses = { board: shared({ presence: 'peers', history: 'history' }) }
 *
 * Reducers don't change: the driver diffs each new value of state.board into Yjs operations and
 * remote changes come back as the `board.REMOTE` action. Tests and demos: 'sygnal/yjs/testing'.
 */
export {makeYjsDriver} from './yjs/driver'
export {shared} from './yjs/shared'
export {collection} from './yjs/mapping'
export type {YjsDriverOptions} from './yjs/driver'
export type {SharedOptions} from './yjs/shared'
