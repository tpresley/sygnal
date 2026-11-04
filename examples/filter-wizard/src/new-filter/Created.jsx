import { ABORT } from 'sygnal'
import { href } from '../routes.js'

// The outcome step: a final screen after the flow. Back and the browser's back button don't
// reopen the steps; Start over (here: Create a similar filter) and leaving still work.
function Created({ state }) {
  const { name, created } = state.draft
  const counted = state.matches != null
  return (
    <div className="step outcome" role="status">
      <h2 data-router-focus="">Filter created</h2>
      <p>“{name}” is saved. {created && <a className="open" href={href('filter', { id: String(created.id) })}>Open it</a>}</p>
      <p className="matches">{state.error ?? (counted ? `${state.matches} matches in the last hour.` : 'Counting matches in the last hour…')}</p>
      <p className="actions">
        <button type="button" className="similar">Create a similar filter</button>{' '}
        <a href={href('list')}>All filters</a>
      </p>
    </div>
  )
}

Created.initialState = { matches: null, error: null }
Created.isolatedState = true

Created.intent = ({ DOM }) => ({ SIMILAR: DOM.click('.similar') })

Created.model = {
  // The outcome's work, started here from the draft. The flag is cleared, so this step mounted
  // again (a reload restores the flow) doesn't count twice. STATE runs first: HTTP reads the flag
  // from the state before (`previousState`).
  BOOTSTRAP: {
    STATE: (state) => (state.draft.created?.countMatches
      ? { ...state, draft: { ...state.draft, created: { ...state.draft.created, countMatches: false } } }
      : ABORT),
    HTTP: (state, data, next, { previousState }) => (previousState.draft.created?.countMatches
      ? { url: `/api/filters/${previousState.draft.created.id}/preview`, method: 'POST', ok: 'COUNTED', error: 'COUNT_FAILED' }
      : ABORT),
  },
  COUNTED: (state, { matches }) => ({ ...state, matches }),
  COUNT_FAILED: (state) => ({ ...state, error: 'The matches couldn’t be counted.' }),
  // a new flow, from a copy of this one's draft
  SIMILAR: { PARENT: (state) => ({ wizard: 'RESET', draft: { ...state.draft, name: `${state.draft.name} (copy)`, created: null } }) },
}

export default Created
