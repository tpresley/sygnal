import { SOURCES, condition, filterOf } from '../filters.js'

// The last step. Its own slice (`creating`, `error`) is its own: the wizard's `visit` sets it again
// on each entry. Create sends the request from here; the reply moves the flow to Created.
function Review({ state }) {
  const d = state.draft
  return (
    <div className="step">
      <h2 data-router-focus="">Review</h2>
      <dl>
        <dt>Name</dt><dd className="summary-name">{d.name}</dd>
        <dt>Source</dt><dd>{SOURCES[d.source]}</dd>
        <dt>Matches</dt><dd className="summary-condition">{condition(d)}</dd>
      </dl>
      <p><button type="button" className="rename">Change the name</button></p>
      {state.error && <p role="alert" className="error">{state.error}</p>}
      <button type="button" className="create" disabled={state.creating}>{state.creating ? 'Creating…' : 'Create filter'}</button>
    </div>
  )
}

Review.initialState = { creating: false, error: null }
Review.isolatedState = true

Review.intent = ({ DOM }) => ({
  RENAME: DOM.click('.rename'),
  CREATE: DOM.click('.create'),
})

Review.model = {
  // a step moves the flow with a PARENT message the wizard reads
  RENAME: { PARENT: () => ({ wizard: 'GOTO', step: 'describe' }) },
  CREATE: {
    STATE: (state) => ({ ...state, creating: true, error: null }),
    HTTP: (state) => ({ url: '/api/filters', json: filterOf(state.draft), ok: 'CREATED', error: 'CREATE_FAILED' }),
  },
  // The filter exists. Created starts the follow-up work (counting its matches) in its own
  // BOOTSTRAP: a request sent from here would be aborted as this step is left. So Review only
  // leaves what that work needs in the draft, with a flag, and moves on. The GOTO's `key` gives
  // the flow its key, the new filter's id (a key born mid-flow is adopted: the flow is kept).
  CREATED: {
    STATE: (state, filter) => ({ ...state, draft: { ...state.draft, created: { id: filter.id, countMatches: true } } }),
    PARENT: (state, filter) => ({ wizard: 'GOTO', step: 'created', key: String(filter.id) }),
  },
  CREATE_FAILED: (state, { status, body }) => ({ ...state, creating: false, error: body?.error ?? `The filter wasn’t created (${status ?? 'network error'}).` }),
}

export default Review
