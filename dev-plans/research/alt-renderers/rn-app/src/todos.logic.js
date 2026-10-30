// The todo list's logic: state, intent, model and the controls the intent selects. No view, no
// platform: todos.native.js and todos.web.js attach it to their own views.
import { controls, set, toggle } from 'sygnal'

export const { Draft, Add, ClearDone } = controls({ Draft: 'textinput', Add: 'pressable', ClearDone: 'pressable' })
export const { Done, Remove } = controls({ Done: 'toggle', Remove: 'pressable' })

export const TodoLogic = {
  intent: ({ DOM }) => ({ TOGGLE: DOM.change(Done), REMOVE: DOM.click(Remove) }),
  model: { TOGGLE: toggle('done'), REMOVE: () => undefined },
}

const add = (state) => {
  const title = state.draft.trim()
  if (!title) return state
  const id = state.todos.reduce((max, todo) => Math.max(max, todo.id), 0) + 1
  return { ...state, draft: '', todos: [...state.todos, { id, title, done: false }] }
}

export const TodosLogic = {
  initialState: { draft: '', todos: [{ id: 1, title: 'Run Sygnal on iOS', done: false }] },
  calculated: { left: (state) => state.todos.filter((todo) => !todo.done).length },
  intent: ({ DOM }) => ({
    DRAFT: DOM.input(Draft).value(),
    ADD: DOM.click(Add),
    ENTER: DOM.keydown(Draft).key().filter((key) => key === 'Enter'),
    CLEAR: DOM.click(ClearDone),
  }),
  model: {
    DRAFT: set((_state, draft) => ({ draft })),
    ADD: add,
    ENTER: add,
    CLEAR: set((state) => ({ todos: state.todos.filter((todo) => !todo.done) })),
  },
}
