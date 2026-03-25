import { classes, xs, sampleCombine, Transition, set, toggle } from 'sygnal'
import type { Component } from 'sygnal'
import { inputEvents } from '../lib/utils'

// ─── State ──────────────────────────────────────────────────────────────────

type TodoState = {
  id: number
  title: string
  completed: boolean
  editing: boolean
  editValue: string
  cachedTitle: string
}

// ─── Props ──────────────────────────────────────────────────────────────────

type TodoProps = {
  showDelete: boolean
}

// ─── Calculated ─────────────────────────────────────────────────────────────

type TodoCalc = {
  displayTitle: string
}

// ─── Context ────────────────────────────────────────────────────────────────

type TodoContext = {
  theme: string
}

// ─── Actions ────────────────────────────────────────────────────────────────

type TodoActions = {
  TOGGLE: PointerEvent
  DESTROY: PointerEvent
  EDIT_START: MouseEvent
  EDIT_INPUT: string
  EDIT_DONE: string
  EDIT_CANCEL: string
}

// ─── Component ──────────────────────────────────────────────────────────────

type Todo = Component<TodoState, TodoProps, {}, TodoActions, TodoCalc, TodoContext>

const TODO: Todo = function ({ state, context, showDelete }) {
  const { id, completed, editing, editValue, displayTitle } = state
  const classNames = classes('todo', 'todo-' + id, { completed, editing })
  const checked = !!completed
  const theme = context?.theme ?? 'light'

  return (
    <Transition name="todo" duration={300}>
      <li className={classNames} data-theme={theme}>
        <div className="view">
          <input className="toggle" type="checkbox" checked={checked} />
          <label>{displayTitle}</label>
          {showDelete && <button className="destroy" />}
        </div>
        <input className="edit" type="text" value={editValue} autoFocus={editing} />
      </li>
    </Transition>
  )
}

TODO.calculated = {
  displayTitle: (state) => state.title,
}

TODO.model = {
  TOGGLE:   toggle('completed'),
  DESTROY:  () => undefined, // removes item from collection

  EDIT_START: set((state) => ({ editing: true, editValue: state.title, cachedTitle: state.title })),
  EDIT_INPUT: set((_state, data) => ({ editValue: data })),

  EDIT_DONE: (state) => {
    if (state.editing === false) return state
    const title = state.editValue.trim()
    if (title === '') return undefined // remove empty todos
    return { ...state, title, editing: false, editValue: '', cachedTitle: '' }
  },

  EDIT_CANCEL: set((state) => ({
    title: state.cachedTitle, editing: false, editValue: '', cachedTitle: '',
  })),
}

TODO.intent = ({ DOM }) => {
  const toggle$  = DOM.click('.toggle').value()
  const label$   = DOM.dblclick('.todo label')
  const destroy$ = DOM.click('.destroy')
  const input$   = DOM.select('.edit')

  const { value$, enter$, escape$, blur$ } = inputEvents(input$)

  const editInput$ = input$.events('input').value()

  const doneEditing$ = xs
    .merge(enter$, blur$)
    .compose(sampleCombine(value$))
    .map(([_, title]) => title)

  return {
    TOGGLE:      toggle$,
    DESTROY:     destroy$,
    EDIT_START:  label$,
    EDIT_INPUT:  editInput$,
    EDIT_DONE:   doneEditing$,
    EDIT_CANCEL: escape$,
  }
}

export default TODO
