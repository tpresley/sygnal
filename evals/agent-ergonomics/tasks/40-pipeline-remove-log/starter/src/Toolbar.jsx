import { ABORT, set } from 'sygnal'
import { ROLES, SORTS } from './pipeline.js'

const DEFAULT_VIEW = { search: '', role: 'all', sort: 'board' }

/** Searches the list by name, narrows it to one role and picks its order; the stage tabs keep counting everyone. */
function Toolbar({ state, context, uid }) {
  const { counts } = context
  const narrowed = state.search !== '' || state.role !== 'all' || state.sort !== 'board'
  return (
    <div className="toolbar">
      <label for={uid('search')}>Search</label>
      <input id={uid('search')} name="search" type="search" placeholder="Name" value={state.search} />
      <label for={uid('role')}>Show role</label>
      <select id={uid('role')} name="show-role" value={state.role}>
        <option value="all">All roles</option>
        {ROLES.map((role) => (
          <option value={role}>{role}</option>
        ))}
      </select>
      <label for={uid('sort')}>Sort by</label>
      <select id={uid('sort')} name="sort" value={state.sort}>
        {SORTS.map((sort) => (
          <option value={sort.id}>{sort.label}</option>
        ))}
      </select>
      <button type="button" className="reset-view" disabled={!narrowed}>
        Reset view
      </button>
      <span className="total">{`${counts.all} candidates`}</span>
    </div>
  )
}

Toolbar.intent = ({ DOM }) => ({
  SEARCH: DOM.input('[name="search"]').value(),
  SHOW_ROLE: DOM.change('[name="show-role"]').value(),
  SORT: DOM.change('[name="sort"]').value(),
  RESET_VIEW: DOM.click('.reset-view'),
})

Toolbar.model = {
  SEARCH: set((state, search) => ({ search })),
  SHOW_ROLE: set((state, role) => ({ role })),
  SORT: set((state, sort) => ({ sort })),
  RESET_VIEW: (state) =>
    state.search === '' && state.role === 'all' && state.sort === 'board' ? ABORT : { ...state, ...DEFAULT_VIEW },
}

export default Toolbar
