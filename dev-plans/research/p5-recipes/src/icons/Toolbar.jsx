// Toolbar.jsx
import { Plus, Trash2, CloudCheck, CloudOff } from 'lucide'
import { icon } from './icon.jsx'

export function Toolbar({ state }) {
  return (
    <div role="toolbar" aria-label="Items">
      <button className="add">{icon(Plus)} Add</button>
      <button className="remove" aria-label="Remove the last item">{icon(Trash2)}</button>
      <span className="status">
        {state.online ? icon(CloudCheck, { label: 'Saved' }) : icon(CloudOff, { label: 'Offline' })}
      </span>
      <span className="count">{state.count} items</span>
    </div>
  )
}

Toolbar.initialState = { count: 0, online: true }

Toolbar.intent = ({ DOM }) => ({
  ADD: DOM.click('.add'),
  REMOVE: DOM.click('.remove'),
})

Toolbar.model = {
  ADD: (state) => ({ ...state, count: state.count + 1 }),
  REMOVE: (state) => ({ ...state, count: Math.max(0, state.count - 1) }),
}
