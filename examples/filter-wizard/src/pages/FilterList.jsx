import { href } from '../routes.js'
import { condition } from '../filters.js'

function FilterList({ state }) {
  const { status, data } = state.filters
  return (
    <section className="filter-list">
      <h1>Filters</h1>
      <p><a className="new-filter" href={href('newFilter')}>New filter</a></p>
      {status === 'loading' && <p className="status">Loading…</p>}
      {status === 'error' && <p role="alert">Couldn’t load the filters.</p>}
      {data && (
        <ul className="filters">
          {data.map((f) => (
            <li>
              <a href={href('filter', { id: String(f.id) })}>{f.name}</a>: {condition(f)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

FilterList.resources = { filters: () => '/api/filters' }

export default FilterList
