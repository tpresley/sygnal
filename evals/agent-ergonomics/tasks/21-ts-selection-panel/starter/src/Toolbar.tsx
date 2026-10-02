import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { FiltersState } from './types'

const intent = ({ DOM }: IntentSources<FiltersState>) => ({
  SET_HIDE_DONE: DOM.change('.hide-done').checked(),
})

type ToolbarActions = ActionsOf<typeof intent>

const Toolbar: Component<FiltersState, any, {}, ToolbarActions> = ({ state }: { state: FiltersState }) => (
  <div className="toolbar">
    <label>
      <input type="checkbox" className="hide-done" checked={state.hideDone} />
      Hide done
    </label>
  </div>
)

Toolbar.intent = intent

Toolbar.model = {
  SET_HIDE_DONE: (state, hideDone) => ({ ...state, hideDone }),
}

export default Toolbar
