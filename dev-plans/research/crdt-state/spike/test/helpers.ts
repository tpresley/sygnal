import { renderComponent } from 'sygnal'
import { Board } from '../app/Board.tsx'
import { makeYjsDriver } from '../lib/sygnal-yjs.ts'
import { createNetwork } from '../lib/memoryProvider.ts'

export const tick = () => new Promise((r) => setTimeout(r, 0))
export const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await tick() }
}
/** a client: one Board app with its own Y.Doc on the network */
export const client = (net: ReturnType<typeof createNetwork>, name = 'anon', opts: any = {}) => {
  const peer = net.join()
  const t = renderComponent(Board, {
    initialState: { ...Board.initialState, me: { name }, ...opts.initialState },
    drivers: { SHARED: makeYjsDriver({ doc: peer.doc, awareness: peer.awareness, captureTimeout: 0, text: opts.text }) },
  })
  /** dispatch and wait until the app (and so the driver) has processed it */
  const act = async (name: string, data?: any) => { t.simulateAction(name, data); await t.settle() }
  return { t, peer, act, board: () => t.state.board, ids: () => t.state.board.items.map((x: any) => x.id) }
}
export { createNetwork }
