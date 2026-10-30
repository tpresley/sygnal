// A collaborative todo column: state.board is shared through the SHARED driver (a Y.Doc), the
// rest (draft, peers, history) is this client's own. The reducers are ordinary Sygnal reducers.
import { ABORT } from 'sygnal'
import { shared } from '../lib/sygnal-yjs.ts'

type Item = { id: string; text: string; done: boolean }
type State = {
  board: { title: string; items: Item[] }
  draft: string
  me: { name: string }
  peers: { id: number; name?: string; editing?: string | null }[]
  history: { canUndo: boolean; canRedo: boolean }
}

const items = (s: State, f: (xs: Item[]) => Item[]): State => ({ ...s, board: { ...s.board, items: f(s.board.items) } })

export function Board({ state }: { state: State }) {
  return (
    <section>
      <h2>{state.board.title}</h2>
      <ul>
        {state.board.items.map((it) => (
          <li key={it.id} data-id={it.id} className={it.done ? 'done' : ''}>
            <input type="checkbox" className="toggle" aria-label={'Done: ' + it.text} checked={it.done} />
            <span className="text">{it.text}</span>
            {state.peers.filter((p) => p.editing === it.id).map((p) => <em className="peer">{p.name}</em>)}
          </li>
        ))}
      </ul>
      <input className="draft" aria-label="New item" value={state.draft} />
      <button className="add">Add</button>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
      <span className="who">{state.peers.map((p) => p.name).join(', ')}</span>
    </section>
  )
}

Board.uses = { board: shared({ presence: 'peers', history: 'history' }) }

// ids are made in the intent (a reducer stays pure); a real app might use crypto.randomUUID()
let n = 0
const newId = () => Math.random().toString(36).slice(2, 8) + (n++).toString(36)

Board.intent = ({ DOM }: any) => ({
  TYPE: DOM.input('.draft').value(),
  ADD: DOM.click('.add').map(() => ({ id: newId() })),
  TOGGLE: DOM.change('.toggle').map((e: any) => e.target.closest('li').dataset.id),
  FOCUS: DOM.focus('.text').map((e: any) => e.target.closest('li').dataset.id),
  UNDO: DOM.click('.undo'),
  REDO: DOM.click('.redo'),
})

Board.initialState = {
  board: { title: 'Todo', items: [] },
  draft: '',
  me: { name: 'anon' },
  peers: [],
  history: { canUndo: false, canRedo: false },
} as State

Board.model = {
  TYPE: (s: State, draft: string) => ({ ...s, draft }),
  // from the button: the draft; from a test: { id, text }
  ADD: (s: State, it: { id: string; text?: string }) => {
    const text = it.text ?? s.draft.trim()
    if (!text) return ABORT
    return { ...items(s, (xs) => [...xs, { id: it.id, text, done: false }]), draft: it.text === undefined ? '' : s.draft }
  },
  EDIT: (s: State, { id, text }: { id: string; text: string }) => items(s, (xs) => xs.map((x) => (x.id === id ? { ...x, text } : x))),
  TOGGLE: (s: State, id: string) => items(s, (xs) => xs.map((x) => (x.id === id ? { ...x, done: !x.done } : x))),
  REMOVE: (s: State, id: string) => items(s, (xs) => xs.filter((x) => x.id !== id)),
  MOVE: (s: State, { id, to }: { id: string; to: number }) => {
    const xs = s.board.items, from = xs.findIndex((x) => x.id === id)
    if (from < 0) return ABORT
    const out = xs.slice(); const [x] = out.splice(from, 1); out.splice(to, 0, x)
    return items(s, () => out)
  },
  RENAME: (s: State, title: string) => ({ ...s, board: { ...s.board, title } }),
  UNDO: { SHARED: { undo: 'board' } },
  REDO: { SHARED: { redo: 'board' } },
  JOIN: { SHARED: (s: State) => ({ presence: { name: s.me.name, editing: null } }) },
  FOCUS: { SHARED: (_: State, id: string | null) => ({ presence: { editing: id } }) },
}
