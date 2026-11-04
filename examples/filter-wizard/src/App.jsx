import { Outlet, persist } from 'sygnal'
import { router, href, inWizard } from './routes.js'
import FilterList from './pages/FilterList.jsx'
import FilterPage from './pages/FilterPage.jsx'
import NotFound from './pages/NotFound.jsx'
import NewFilter from './new-filter/NewFilter.jsx'

const PAGES = { list: FilterList, filter: FilterPage, newFilter: NewFilter, notFound: NotFound }
// both wizard routes are one page: the wizard host stays the same instance while its steps change
const pageFor = (route) => (inWizard(route) ? 'newFilter' : route.name)
const pageIdentity = (route) => (route.name === 'filter' ? `filter:${route.params.id}` : pageFor(route))

function App({ state }) {
  const { route } = state
  return (
    <div className="app">
      <header className="top">
        <a className="home" href={href('list')}>Filters</a>
      </header>
      <main>
        {/* the wizard page binds `flow`; the other pages share this state */}
        <Outlet of={PAGES} current={pageFor(route)} identity={pageIdentity(route)} fallback={NotFound} state={{ newFilter: 'flow' }} />
      </main>
    </div>
  )
}

App.route = 'ROUTE'
App.initialState = { route: router.current(), flow: {} }
// the flow survives a reload of the tab: the step, the draft and each step's own slice
App.persist = persist({ key: 'filter-wizard', pick: ['flow'], storage: 'session' })
App.context = { route: (state) => state.route }
App.model = {
  // The wizard reads the route from its own state (`flow.route`), so the flow key and the URL
  // binding see it. Entering the wizard from another page starts a new flow; moving between its
  // steps (and a reload) keeps the one there is.
  ROUTE: (state, route) => {
    if (!inWizard(route)) return { ...state, route }
    const flow = inWizard(state.route) ? state.flow : {}
    return { ...state, route, flow: { ...flow, route } }
  },
}

export default App
