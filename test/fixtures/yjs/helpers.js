// sygnal/yjs tests: clients (one Board app each, with its own Y.Doc) on an in-memory network
import { renderComponent } from '../../../src/extra/testing.js'
import { makeYjsDriver } from '../../../src/yjs.ts'
import { createNetwork } from '../../../src/yjs-testing.ts'
import { read } from '../../../src/yjs/mapping.ts'
import { Board } from './board.js'

export const tick = () => new Promise((r) => setTimeout(r, 0))
export const until = async (cond, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await tick() }
}
/** the document's content for a slice */
export const docOf = (doc, key = 'board') => read(doc.getMap(key), key)
/** a client: one Board app on the network (`driver`: extra makeYjsDriver options) */
export const client = (net, name = 'anon', opts = {}) => {
  const peer = net.join()
  const t = renderComponent(opts.component || Board, {
    initialState: { ...Board.initialState, me: { name }, ...opts.initialState },
    drivers: { SHARED: makeYjsDriver({ doc: peer.doc, provider: peer, captureTimeout: 0, text: opts.text, ...opts.driver }) },
  })
  /** dispatch and wait until the app (and so the driver) has processed it */
  const act = async (action, data) => { t.simulateAction(action, data); await t.settle() }
  return { t, peer, act, board: () => t.state.board, ids: () => t.state.board.items.map((x) => x.id) }
}
const json = (v) => JSON.stringify(sorted(v))
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v == 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v
/** every client's state equals every client's document (key order aside) */
export const converged = (...cs) => {
  const first = json(cs[0].board())
  return cs.every((c) => json(c.board()) === first && json(docOf(c.peer.doc)) === first)
}
export { createNetwork, makeYjsDriver, Board, renderComponent, read }
