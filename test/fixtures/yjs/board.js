// A collaborative todo column (sygnal/yjs tests): state.board is shared through the SHARED driver
// (a Y.Doc), the rest (draft, peers, history) is this client's own. The reducers are ordinary
// Sygnal reducers. Ported from the spike (dev-plans/research/crdt-state/spike/app/Board.tsx).
import { createElement as h } from '../../../src/pragma/index.js'
import { ABORT } from '../../../src/shared.ts'
import { shared } from '../../../src/yjs.ts'

const items = (s, f) => ({ ...s, board: { ...s.board, items: f(s.board.items) } })

export function Board({ state }) {
  return h('section', null,
    h('h2', null, state.board.title),
    h('ul', null, state.board.items.map((it) =>
      h('li', { key: it.id, 'data-id': it.id, className: it.done ? 'done' : '' },
        h('input', { type: 'checkbox', className: 'toggle', 'aria-label': 'Done: ' + it.text, checked: it.done }),
        h('span', { className: 'text' }, it.text),
        state.peers.filter((p) => p.editing === it.id).map((p) => h('em', { className: 'peer' }, p.name))))),
    h('input', { className: 'draft', 'aria-label': 'New item', value: state.draft }),
    h('button', { className: 'add' }, 'Add'),
    h('button', { className: 'undo', disabled: !state.history.canUndo }, 'Undo'),
    h('button', { className: 'redo', disabled: !state.history.canRedo }, 'Redo'),
    h('span', { className: 'who' }, state.peers.map((p) => p.name).join(', ')))
}

Board.uses = { board: shared({ presence: 'peers', history: 'history' }) }

// ids are made in the intent (a reducer stays pure)
let n = 0
const newId = () => Math.random().toString(36).slice(2, 8) + (n++).toString(36)

Board.intent = ({ DOM }) => ({
  TYPE: DOM.input('.draft').value(),
  ADD: DOM.click('.add').map(() => ({ id: newId() })),
  TOGGLE: DOM.change('.toggle').map((e) => e.target.closest('li').dataset.id),
  FOCUS: DOM.focus('.text').map((e) => e.target.closest('li').dataset.id),
  UNDO: DOM.click('.undo'),
  REDO: DOM.click('.redo'),
})

Board.initialState = {
  board: { title: 'Todo', items: [] },
  draft: '',
  me: { name: 'anon' },
  peers: [],
  history: { canUndo: false, canRedo: false },
}

Board.model = {
  TYPE: (s, draft) => ({ ...s, draft }),
  // from the button: the draft; from a test: { id, text }
  ADD: (s, it) => {
    const text = it.text ?? s.draft.trim()
    if (!text) return ABORT
    return { ...items(s, (xs) => [...xs, { id: it.id, text, done: false }]), draft: it.text === undefined ? '' : s.draft }
  },
  EDIT: (s, { id, text }) => items(s, (xs) => xs.map((x) => (x.id === id ? { ...x, text } : x))),
  TOGGLE: (s, id) => items(s, (xs) => xs.map((x) => (x.id === id ? { ...x, done: !x.done } : x))),
  REMOVE: (s, id) => items(s, (xs) => xs.filter((x) => x.id !== id)),
  MOVE: (s, { id, to }) => {
    const xs = s.board.items, from = xs.findIndex((x) => x.id === id)
    if (from < 0) return ABORT
    const out = xs.slice(); const [x] = out.splice(from, 1); out.splice(to, 0, x)
    return items(s, () => out)
  },
  RENAME: (s, title) => ({ ...s, board: { ...s.board, title } }),
  UNDO: { SHARED: { undo: 'board' } },
  REDO: { SHARED: { redo: 'board' } },
  JOIN: { SHARED: (s) => ({ presence: { name: s.me.name, editing: null } }) },
  FOCUS: { SHARED: (_, id) => ({ presence: { editing: id } }) },
}
