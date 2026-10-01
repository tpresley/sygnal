// EVENTS emitted with no listener and selected with no emitter.
import { emit, event } from 'sygnal'

function Editor({ state }) {
  return <button className="save">Save</button>
}

Editor.intent = ({ DOM }) => ({
  SAVE: DOM.click('.save'),
  PUBLISH: DOM.dblclick('.save'),
  SHARE: DOM.contextmenu('.save'),
})

Editor.model = {
  SAVE: emit('DOC_SAVED', (state) => state.id), // expect: SYG105
  PUBLISH: { EVENTS: event('DOC_PUBLISHED') }, // expect: SYG105
  SHARE: { EVENTS: (state) => ({ type: 'DOC_SHARED', data: state.id }) }, // expect: SYG105
}

function StatusBar({ state }) {
  return <span className="status">{state.status}</span>
}

StatusBar.intent = ({ EVENTS: bus }) => ({
  SAVED: bus.select('DOC_SAVE'), // expect: SYG105
})

StatusBar.model = {
  SAVED: (state) => ({ ...state, status: 'saved' }),
}

export default Editor
