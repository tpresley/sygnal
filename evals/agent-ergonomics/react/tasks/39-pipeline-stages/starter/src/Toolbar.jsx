import { useId } from 'react'
import { ROLES, SORTS } from './pipeline.js'

const DEFAULT_VIEW = { search: '', role: 'all', sort: 'board' }

/** Searches the list by name, narrows it to one role and picks its order; the stage tabs keep counting everyone. */
export default function Toolbar({ view, counts, onChange }) {
  const id = useId()
  const narrowed = view.search !== '' || view.role !== 'all' || view.sort !== 'board'
  return (
    <div className="toolbar">
      <label htmlFor={`${id}-search`}>Search</label>
      <input
        id={`${id}-search`}
        name="search"
        type="search"
        placeholder="Name"
        value={view.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />
      <label htmlFor={`${id}-role`}>Show role</label>
      <select id={`${id}-role`} name="show-role" value={view.role} onChange={(e) => onChange({ role: e.target.value })}>
        <option value="all">All roles</option>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-sort`}>Sort by</label>
      <select id={`${id}-sort`} name="sort" value={view.sort} onChange={(e) => onChange({ sort: e.target.value })}>
        {SORTS.map((sort) => (
          <option key={sort.id} value={sort.id}>
            {sort.label}
          </option>
        ))}
      </select>
      <button type="button" className="reset-view" disabled={!narrowed} onClick={() => onChange(DEFAULT_VIEW)}>
        Reset view
      </button>
      <span className="total">{`${counts.all} candidates`}</span>
    </div>
  )
}
