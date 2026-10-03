// A resource shows "Loading…" without data, "Updating…" while it reloads with data (cache hit or
// invalidation), and nothing once settled.
// (state.items / state.item are undefined until the first RESOURCE write)
const statusOf = (resource) =>
  resource?.status === 'loading' ? 'Loading…' : resource?.refreshing ? 'Updating…' : ''

function App({ state }) {
  const items = state.items?.data ?? []
  const item = state.item?.data
  return (
    <div className="items-app">
      <h1>Items</h1>
      {state.view === 'list' ? (
        <section className="list">
          <p className="status">{statusOf(state.items)}</p>
          <ul className="items">
            {items.map((entry) => (
              <li>
                <button className="open" data-id={String(entry.id)}>
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="detail">
          <button className="back">Back to list</button>
          <p className="status">{statusOf(state.item)}</p>
          <h2 className="item-title">{item ? item.title : ''}</h2>
          <p className="item-body">{item ? item.body : ''}</p>
          {item && !state.editing && <button className="edit-open">Edit</button>}
          {state.editing && (
            <div className="edit">
              <input name="title" value={state.draft} />
              <button className="save">Save</button>
              <p className="save-error">{state.saveError}</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

App.initialState = {
  view: 'list',
  selected: null,
  editing: false,
  draft: '',
  saveError: '',
}

// Each view's read follows the state; the query cache (main.js) shows a known list or item at
// once and reloads it in the background once it is older than staleTime.
App.resources = {
  items: (state) => state.view === 'list' && '/api/items',
  item: (state) => state.view === 'detail' && `/api/items/${state.selected}`,
}

App.intent = ({ DOM }) => ({
  OPEN: DOM.click('.open').map((e) => Number(e.target.dataset.id)),
  BACK: DOM.click('.back'),
  EDIT: DOM.click('.edit-open'),
  TYPE: DOM.input('input[name="title"]').value(),
  SAVE: DOM.click('.save'),
})

App.model = {
  OPEN: (state, selected) => ({ ...state, view: 'detail', selected, editing: false, saveError: '' }),
  BACK: (state) => ({ ...state, view: 'list', editing: false, saveError: '' }),
  EDIT: (state) => ({ ...state, editing: true, draft: state.item.data.title, saveError: '' }),
  TYPE: (state, draft) => ({ ...state, draft }),
  SAVE: {
    STATE: (state) => ({ ...state, saveError: '' }),
    // '/api/items' is a URL prefix: the list and every item are marked stale, and the mounted
    // item reloads now (aborting a reload already in flight)
    HTTP: (state) => ({
      url: `/api/items/${state.selected}`,
      method: 'PUT',
      json: { title: state.draft },
      ok: 'SAVED',
      error: 'SAVE_FAILED',
      invalidates: '/api/items',
    }),
  },
  SAVED: (state) => ({ ...state, editing: false, saveError: '' }),
  // mutant: a failed save puts the saved title back into the field
  SAVE_FAILED: (state) => ({ ...state, draft: state.item.data.title, saveError: 'Could not save the item.' }),
}

export default App
