import { classes, xs, sampleCombine } from 'sygnal'
import type { Component, DriverSpec } from 'sygnal'
import { inputEvents } from '../lib/utils'
import type { DOMfx, DOMfxData } from '../lib/DOMfxDriver'

// ─── State ──────────────────────────────────────────────────────────────────

type TodoState = {
  id: number
  title: string
  completed: boolean
  editing: boolean
  cachedTitle: string
}

// ─── Calculated ─────────────────────────────────────────────────────────────

type TodoCalc = {
  inputSelector: string
}

// ─── Custom Drivers ─────────────────────────────────────────────────────────
// Must use `type` (not `interface`) so TypeScript recognizes it as extending
// Record<string, DriverSpec> — interfaces lack implicit index signatures.

type TodoDrivers = {
  DOMFX: DriverSpec<void, DOMfx>
}

// ─── Actions ────────────────────────────────────────────────────────────────
// Use `any` for DOM event actions where the event data isn't used in reducers.

type TodoActions = {
  TOGGLE: any
  DESTROY: any
  EDIT_START: any
  EDIT_DONE: string
  EDIT_CANCEL: string
  SET_EDIT_VALUE: DOMfxData
  FOCUS_EDIT_FIELD: DOMfxData
}

// ─── Component ──────────────────────────────────────────────────────────────

type Todo = Component<TodoState, {}, TodoDrivers, TodoActions, TodoCalc>

const TODO: Todo = function ({ state }) {
  const { id, completed, editing, title } = state!
  const classNames = classes('todo', 'todo-' + id, { completed, editing })
  const checked = !!completed

  return (
    <li className={classNames}>
      <div className="view">
        <input className="toggle" type="checkbox" checked={checked} />
        <label>{title}</label>
        <button className="destroy" />
      </div>
      <input className="edit" type="text" value={title} />
    </li>
  )
}

TODO.calculated = {
  inputSelector: (state) => `.todo-${state.id} .edit`,
}

TODO.model = {
  TOGGLE: (state) => ({ ...state, completed: !state.completed }),

  // Setting state to undefined removes this item from the collection
  DESTROY: () => undefined,

  EDIT_START: (state, _data, next) => {
    const selector = state.inputSelector
    next('SET_EDIT_VALUE', { selector, value: state.title })
    next('FOCUS_EDIT_FIELD', { selector }, 100)
    return { ...state, editing: true, cachedTitle: state.title }
  },

  EDIT_DONE: (state, data) => {
    if (state.editing === false) return state
    return { ...state, title: data, editing: false, cachedTitle: '' }
  },

  EDIT_CANCEL: (state, _data, next) => {
    const selector = state.inputSelector
    next('SET_EDIT_VALUE', { selector, value: state.cachedTitle })
    return { ...state, title: state.cachedTitle, editing: false, cachedTitle: '' }
  },

  SET_EDIT_VALUE: { DOMFX: (_state, data) => ({ type: 'SET_VALUE', data }) },
  FOCUS_EDIT_FIELD: { DOMFX: (_state, data) => ({ type: 'FOCUS', data }) },
}

TODO.intent = ({ DOM }) => {
  const toggle$ = DOM.select('.toggle').events('click')
  const label$ = DOM.select('.todo label').events('dblclick')
  const destroy$ = DOM.select('.destroy').events('click')
  const input$ = DOM.select('.edit')

  const { value$, enter$, escape$, blur$ } = inputEvents(input$)

  const doneEditing$ = xs
    .merge(enter$, blur$)
    .compose(sampleCombine(value$))
    .map(([_, title]) => title)

  return {
    TOGGLE: toggle$,
    DESTROY: destroy$,
    EDIT_START: label$,
    EDIT_DONE: doneEditing$,
    EDIT_CANCEL: escape$,
  }
}

export default TODO
