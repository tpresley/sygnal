// Routed requests whose ok/error names all have model entries; the replies are the
// only triggers of LOADED / FAILED / SAVED / SAVE_FAILED, so SYG102 must not fire.
import { ABORT } from 'sygnal'

const saveRequest = (state) =>
  state.dirty ? { url: '/api/save', method: 'POST', json: state.draft, ok: 'SAVED', error: 'SAVE_FAILED' } : ABORT

function Editor({ state }) {
  return (
    <div>
      <button className="load">load</button>
      <button className="save">save</button>
      <p>{state.status}</p>
    </div>
  )
}

Editor.initialState = { status: 'idle', dirty: false, draft: null }

Editor.intent = ({ DOM }) => ({
  LOAD: DOM.click('.load'),
  SAVE: DOM.click('.save'),
  HYDRATE: DOM.click('.load').mapTo({ status: 'hydrated' }), // an ordinary action now
})

Editor.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP(state) {
      if (!state.id) return ABORT
      return { url: `/api/docs/${state.id}`, ok: 'LOADED', error: 'FAILED', latest: true }
    },
  },
  SAVE: { HTTP: saveRequest },
  // a free-text error field on a non-routing sink is data, not an action name
  LOADED: {
    STATE: (state, doc) => ({ ...state, status: 'done', draft: doc }),
    LOG: () => ({ level: 'info', error: 'no error at all' }),
  },
  FAILED: (state) => ({ ...state, status: 'error' }),
  SAVED: (state) => ({ ...state, dirty: false }),
  SAVE_FAILED: (state) => ({ ...state, status: 'save-error' }),
  HYDRATE: (state, data) => ({ ...state, ...data }),
}

export default Editor
