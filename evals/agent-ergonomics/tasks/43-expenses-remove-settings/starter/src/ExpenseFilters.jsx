import { CATEGORIES, STATUS_LABELS, SORTS } from './expenses.js'

function ExpenseFilters({ state, uid }) {
  const filters = state.filters
  return (
    <div className="filters">
      <label for={uid('status')}>Status</label>
      <select id={uid('status')} name="status" value={filters.status}>
        <option value="all">All</option>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option value={value}>{label}</option>
        ))}
      </select>
      <label for={uid('category')}>Category</label>
      <select id={uid('category')} name="category" value={filters.category}>
        <option value="all">All</option>
        {CATEGORIES.map((category) => (
          <option value={category}>{category}</option>
        ))}
      </select>
      <label for={uid('sort')}>Sort</label>
      <select id={uid('sort')} name="sort" value={filters.sort}>
        {SORTS.map((sort) => (
          <option value={sort.value}>{sort.label}</option>
        ))}
      </select>
    </div>
  )
}

// each select names the filter it sets
ExpenseFilters.intent = ({ DOM }) => ({
  FILTER: DOM.input('select').map((e) => ({ name: e.target.name, value: e.target.value })),
})

ExpenseFilters.model = {
  FILTER: (state, { name, value }) => ({ ...state, filters: { ...state.filters, [name]: value } }),
}

export default ExpenseFilters
