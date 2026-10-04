// PLAN-4 3-B (GS-5): persist() options typed against the root's state keys, the `persist` static,
// storage adapters, renderComponent's `storage` option and t.storage().
import { persist, renderComponent } from 'sygnal'
import type { RootComponent, Component, Persist, PersistOptions, PersistStorage, PersistedEntry } from 'sygnal'

type TodoState = { todos: string[]; filter: 'all' | 'done'; draft: string }
type TodoActions = { ADD: string; RESET: null }

export const TodoApp: RootComponent<TodoState, {}, TodoActions> = ({ state }) => <ul>{state.todos.map(t => <li>{t}</li>)}</ul>
TodoApp.initialState = { todos: [], filter: 'all', draft: '' }
TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, text] }),
  RESET: { STATE: () => ({ todos: [], filter: 'all', draft: '' }), PERSIST: { clear: true } },
}

// pick / omit are the state's keys (inferred from the static's type)
TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], version: 2, migrate: (old, from) => from === 1 ? { todos: old.items } : undefined })
TodoApp.persist = persist({ key: 'todo-app', omit: ['draft'], storage: 'session', sync: true, debounceMs: 250, hydrate: true })
// @ts-expect-error not a state key
TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filtr'] })
// @ts-expect-error not a state key (omit)
TodoApp.persist = persist({ key: 'todo-app', omit: ['drafts'] })
// @ts-expect-error key is required
TodoApp.persist = persist({ pick: ['todos'] })
// @ts-expect-error storage is 'local', 'session' or an adapter
TodoApp.persist = persist({ key: 'todo-app', storage: 'indexeddb' })
// @ts-expect-error migrate returns the state's keys
TodoApp.persist = persist({ key: 'todo-app', migrate: () => ({ todos: 1 }) })

// a synchronous adapter, with an optional subscribe for sync
const memory = new Map<string, string>()
const adapter: PersistStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => { memory.set(k, v) },
  removeItem: (k) => { memory.delete(k) },
  subscribe: (fn) => { fn('todo-app', null); return () => {} },
}
TodoApp.persist = persist({ key: 'todo-app', storage: adapter })
// @ts-expect-error async storages are not supported
const asyncStorage: PersistStorage = { getItem: async (k: string) => k, setItem: () => {}, removeItem: () => {} }

// untyped components take any key
function Loose() { return <p /> }
Loose.persist = persist({ key: 'x', pick: ['anything'] })

// the value
const p: Persist<TodoState> = persist<TodoState>({ key: 'k' })
const opts: PersistOptions<TodoState> = p.options
const k: string = opts.key

// a sub-component type has it too (SYG224 at run time / statically)
export const Child: Component<TodoState> = () => <p />
Child.persist = persist({ key: 'child', pick: ['draft'] })

// renderComponent: seeding, sharing, reading
const shared: Record<string, PersistedEntry | string> = { 'todo-app': { version: 1, state: { todos: ['milk'] } } }
const t = renderComponent(TodoApp, { storage: shared })
const entry = t.storage('todo-app')
const todos: string[] | undefined = entry?.state.todos
const version: number | undefined = entry?.version
renderComponent(TodoApp, { storage: { 'todo-app': '{not json' } })
// @ts-expect-error the entry's state is typed by the component
const bad: number | undefined = t.storage('todo-app')?.state.todos

export { asyncStorage, k, todos, version, bad }
