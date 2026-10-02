import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { StatusState } from './types'

const intent = ({ EVENTS }: IntentSources<StatusState>) => ({
  EDITED: EVENTS.select('DOC_EDITED'),
  SAVED: EVENTS.select('DOC_EDITED'),
})

type StatusBarActions = ActionsOf<typeof intent>

const StatusBar: Component<StatusState, any, {}, StatusBarActions> = ({ state }: { state: StatusState }) => (
  <footer className="status-bar">{state.message}</footer>
)

StatusBar.intent = intent

StatusBar.model = {
  EDITED: (state) => ({ ...state, message: 'Unsaved changes' }),
  SAVED: (state, { words }) => ({
    ...state,
    message: `Saved ${words} ${words === 1 ? 'word' : 'words'}`,
  }),
}

export default StatusBar
