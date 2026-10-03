import { debounce, xs } from 'sygnal'
import { loadDraft, storeDraft } from './draft.js'

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0)

function App({ state }) {
  const words = countWords(state.body)
  return (
    <main className="note-editor">
      <h1>Note</h1>
      <label className="field">
        <span>Title</span>
        <input name="title" value={state.title} />
      </label>
      <label className="field">
        <span>Body</span>
        <textarea name="body" rows="8" value={state.body}></textarea>
      </label>
      <p className="word-count">{`${words} ${words === 1 ? 'word' : 'words'}`}</p>
      <p className="save-status">{state.status}</p>
    </main>
  )
}

// The draft kept in localStorage is the starting point.
App.initialState = {
  ...loadDraft(),
  status: '',
}

App.intent = ({ DOM }) => {
  const title$ = DOM.input('input[name="title"]').value()
  const body$ = DOM.input('textarea[name="body"]').value()
  return {
    TITLE: title$,
    BODY: body$,
    SAVE: xs.merge(title$, body$).compose(debounce(1000)),
  }
}

App.model = {
  TITLE: {
    STATE: (state, title) => ({ ...state, title, status: 'Unsaved changes' }),
    EFFECT: (state, title) => storeDraft({ title, body: state.body }),
  },
  BODY: {
    STATE: (state, body) => ({ ...state, body, status: 'Unsaved changes' }),
    EFFECT: (state, body) => storeDraft({ title: state.title, body }),
  },
  // latest: a newer save aborts the one in flight, so its reply never arrives.
  SAVE: {
    STATE: (state) => ({ ...state, status: 'Saving…' }),
    HTTP: (state) => ({
      url: '/api/draft',
      method: 'PUT',
      json: { title: state.title, body: state.body },
      ok: 'SAVED',
      error: 'SAVE_FAILED',
      latest: true,
    }),
  },
  // A reply that arrives after a newer edit (status "Unsaved changes") is ignored.
  // MUTANT: every reply sets the status, also one that arrives after a newer edit
  SAVED: (state) => ({ ...state, status: 'Saved' }),
  SAVE_FAILED: (state) => ({ ...state, status: 'Save failed.' }),
}

export default App
