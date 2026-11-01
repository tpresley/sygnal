/** sygnal/yjs: makeYjsDriver, shared() in uses (its key stays the host's), shapes, the commands, createNetwork (not yjs.tsx: baseUrl would resolve 'yjs' to it) */
import { run, renderComponent, ABORT } from 'sygnal'
import type { Component, UsesState } from 'sygnal'
import { makeYjsDriver, shared, collection } from 'sygnal/yjs'
import type { SharedBehavior, YjsSource, YjsCommand, PresencePeer, SharedHistory, Shape } from 'sygnal/yjs'
import { createNetwork } from 'sygnal/yjs/testing'
import type { Peer } from 'sygnal/yjs/testing'
import * as Y from 'yjs'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

type Item = { id: string; text: string; done: boolean }
type S = { board: { title: string; items: Item[] }; peers: PresencePeer[]; history: SharedHistory }

const Board: Component<S> = ({ state }) => <ul>{state.board.items.map((i) => <li>{i.text}</li>)}</ul>
Board.uses = { board: shared<S['board']>({ presence: 'peers', history: 'history', shape: { title: 'text', items: collection({ text: 'text' }) }, seed: 'whenSynced' }) }
Board.initialState = { board: { title: 'Todo', items: [] }, peers: [], history: { canUndo: false, canRedo: false } }
Board.intent = ({ DOM }) => ({ ADD: DOM.click('.add'), UNDO: DOM.click('.undo') })
Board.model = {
  ADD: (s) => ({ ...s, board: { ...s.board, items: [...s.board.items, { id: 'x', text: '', done: false }] } }),
  UNDO: { SHARED: { undo: 'board' } },
  'board.REMOTE': (s) => s.board.items.length ? s : ABORT,
}

const b = shared()
expectType<Equal<typeof b.ownsState, false>>()
expectType<Equal<SharedBehavior<S['board']>['options']['seed'], 'whenSynced' | 'ifEmpty' | undefined>>()

// shapes
const sh: Shape = { title: 'text', tags: 'list', meta: { n: 'value' }, items: collection() }
// @ts-expect-error not a kind
const bad: Shape = { title: 'txt' }

// the driver
const doc = new Y.Doc()
const net = createNetwork()
const peer: Peer = net.join(doc)
const driver = makeYjsDriver({ doc: peer.doc, provider: peer, text: ['text'], captureTimeout: 300 })
expectType<Equal<ReturnType<ReturnType<typeof makeYjsDriver>>, YjsSource>>()
const cmd: YjsCommand[] = [{ undo: 'board' }, { redo: 'board' }, { presence: { name: 'Ann' } }, { connect: false }, { key: 'board', value: {} }]
// @ts-expect-error a driver needs a document
makeYjsDriver({ provider: peer })
peer.offline(); peer.online(); peer.leave()
const n: number = net.bytes + net.messages

run(Board, { SHARED: driver })
const t = renderComponent(Board, { drivers: { SHARED: makeYjsDriver({ doc: new Y.Doc() }) } })
t.simulateAction('ADD')

export { sh, bad, cmd, n }
