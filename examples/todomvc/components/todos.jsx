import { classes, xs, sampleCombine } from 'sygnal'
import { inputEvents } from '../lib/utils'


export default function TODO({ state }) {
  const { id, completed, editing, title } = state
  // calculate class for todo
  const classNames = classes('todo', 'todo-' + id, { completed, editing })

  // is the todo completed?
  const checked = !!completed

  return (
    <li className={ classNames }>
      <div className="view">
        <input className="toggle" type="checkbox" checked={ checked } />
        <label>{ title }</label>
        <button className="destroy" />
      </div>
      <input className="edit" type="text" value={ title } />
    </li>
  )
}

TODO.calculated = {
  inputSelector: (state) => `.todo-${ state.id } .edit`
}

TODO.model = {

  TOGGLE:     (state) => ({ ...state, completed: !state.completed }),
  
  // for components used in a Sygnal collection element, setting the state
  // to undefined will delete that instance of the component and remove it
  // from the array in state that the collection is based on
  DESTROY:    (state) => undefined,

  EDIT_START: (state, data, next) => {
    const selector = state.inputSelector
    // update the value of the input field to the current todo title
    next('SET_EDIT_VALUE',   { selector, value: state.title })
    // set focus on the input field
    next('FOCUS_EDIT_FIELD', { selector }, 100)
    // mark the todo as being edited and save the current title in case the edit is cancelled
    return { ...state, editing: true, cachedTitle: state.title }
  },

  EDIT_DONE: (state, data) => {
    // if the todo is not being edited then don't change
    if (state.editing === false) return state
    // update the todo's title, remove the editing flag, and delete the cached title
    return { ...state, title: data, editing: false, cachedTitle: '' }
  },

  EDIT_CANCEL: (state, data, next) => {
    const selector = state.inputSelector
    // set the value of the edit input field back to the original title
    next('SET_EDIT_VALUE', { selector, value: state.cachedTitle })
    // set the todo back to the pre-edit value and remove the editing flag
    return { ...state, title: state.cachedTitle, editing: false, cachedTitle: '' }
  },

  // it's a subjective matter whether DOM actions like setting focus or input values are 
  // side-effects that need to be isolated from components, but we are taking the strictest 
  // view here and using a DOMFX driver sink to handle them
  SET_EDIT_VALUE:   { DOMFX: (state, data) => ({ type: 'SET_VALUE', data }) },
  FOCUS_EDIT_FIELD: { DOMFX: (state, data) => ({ type: 'FOCUS', data }) },

}

TODO.intent = ({ DOM }) => {
  // collect DOM events and elements
  const toggle$   = DOM.select('.toggle').events('click')
  const label$    = DOM.select('.todo label').events('dblclick')
  const destroy$  = DOM.select('.destroy').events('click')
  const input$    = DOM.select('.edit')

  // get events from the input field
  //  - the inputEvents helper returns common events and automatically returns the current value
  const { value$, enter$, escape$, blur$ } = inputEvents(input$)

  // map submitted edits to the new title
  const doneEditing$ = xs.merge(enter$, blur$)
                         .compose(sampleCombine(value$))
                         .map(([_, title]) => title)


  return {
    TOGGLE:      toggle$,
    DESTROY:     destroy$,
    EDIT_START:  label$,
    EDIT_DONE:   doneEditing$,
    EDIT_CANCEL: escape$,
  }
}