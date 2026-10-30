// examples/todomvc's APP, unchanged, plus: on BOOTSTRAP one makeFetchDriver GET of seed todos
// (SEEDED), and a toast after each new todo (its id from crypto.randomUUID()) that a
// makeTimerDriver `after` timer clears (TOAST_DONE). The example's own statics are reused.
import APP from '../../../../../examples/todomvc/app.tsx'

export const API = 'http://api.test'

const TodoSync: any = function (props: any) {
  return APP(props)
}
Object.assign(TodoSync, APP)
TodoSync.initialState = { ...APP.initialState, toast: null, seeded: false }
TodoSync.timers = (state: any) => (state.toast ? { toast: { after: 120, action: 'TOAST_DONE' } } : {})
const base: any = APP.model
TodoSync.model = {
  ...base,
  BOOTSTRAP: { ...base.BOOTSTRAP, HTTP: () => ({ url: API + '/seed', ok: 'SEEDED' }) },
  SEEDED: (state: any, todos: any[]) => {
    const max = state.todos.reduce((m: number, t: any) => Math.max(m, t.id), 0)
    return { ...state, seeded: true, todos: [...state.todos, ...todos.map((t, i) => ({ id: max + i + 1, title: t.title, completed: !!t.completed }))] }
  },
  NEW_TODO: {
    ...base.NEW_TODO,
    STATE: (state: any, data: any, next: any, props: any) => ({ ...base.NEW_TODO.STATE(state, data, next, props), toast: { id: crypto.randomUUID(), text: 'Added' } }),
  },
  TOAST_DONE: (state: any) => ({ ...state, toast: null }),
}

export default TodoSync
