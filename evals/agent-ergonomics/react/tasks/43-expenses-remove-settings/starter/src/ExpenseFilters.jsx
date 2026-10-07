import { useId } from 'react'
import { CATEGORIES, STATUS_LABELS, SORTS } from './expenses.js'

export default function ExpenseFilters({ filters, onChange }) {
  const id = useId()
  // each select names the filter it sets
  const change = (e) => onChange(e.target.name, e.target.value)
  return (
    <div className="filters">
      <label htmlFor={`${id}-status`}>Status</label>
      <select id={`${id}-status`} name="status" value={filters.status} onChange={change}>
        <option value="all">All</option>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-category`}>Category</label>
      <select id={`${id}-category`} name="category" value={filters.category} onChange={change}>
        <option value="all">All</option>
        {CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-sort`}>Sort</label>
      <select id={`${id}-sort`} name="sort" value={filters.sort} onChange={change}>
        {SORTS.map((sort) => (
          <option key={sort.value} value={sort.value}>
            {sort.label}
          </option>
        ))}
      </select>
    </div>
  )
}
