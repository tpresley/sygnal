import { href } from '../routes.js'
import { SOURCES, condition } from '../filters.js'

function FilterPage({ state }) {
  const { status, data: f, error } = state.filter
  return (
    <section className="filter-page">
      {status === 'loading' && <p className="status">Loading…</p>}
      {status === 'error' && <p role="alert">{error.status === 404 ? 'There is no such filter.' : 'Couldn’t load the filter.'}</p>}
      {f && (
        <div>
          <h1>{f.name}</h1>
          <dl>
            <dt>Source</dt><dd>{SOURCES[f.source]}</dd>
            <dt>Matches</dt><dd className="condition">{condition(f)}</dd>
            <dt>Last hour</dt><dd className="matches">{f.matches == null ? 'not counted yet' : `${f.matches} matches`}</dd>
          </dl>
        </div>
      )}
      <p><a href={href('list')}>All filters</a></p>
    </section>
  )
}

// the id comes from the route, which the root puts in the context
FilterPage.resources = { filter: (state, { context }) => `/api/filters/${context.route.params.id}` }

export default FilterPage
