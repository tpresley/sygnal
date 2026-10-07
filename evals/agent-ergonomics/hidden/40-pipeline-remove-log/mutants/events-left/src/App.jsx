import { event } from 'sygnal'
import Header from './Header.jsx'
import StageTabs from './StageTabs.jsx'
import Toolbar from './Toolbar.jsx'
import CandidateList from './CandidateList.jsx'
import AddCandidateForm from './AddCandidateForm.jsx'
import { SEED_CANDIDATES, countRoles, countStages } from './pipeline.js'

function App() {
  return (
    <div className="pipeline">
      <Header />
      <StageTabs state="view" />
      <Toolbar state="view" />
      <div className="board">
        <CandidateList />
        <aside className="sidebar">
          <AddCandidateForm state="draft" />
        </aside>
      </div>
    </div>
  )
}

App.initialState = {
  candidates: SEED_CANDIDATES,
  nextId: 9,
  // What the list shows: the stage tab, the name search, the role filter and the order.
  view: { tab: 'all', search: '', role: 'all', sort: 'board' },
  draft: { name: '', role: 'Engineer', error: '' },
  activity: { entries: [] },
}

// Read by Header, StageTabs, Toolbar and CandidateList.
App.context = {
  counts: (state) => countStages(state.candidates),
  roles: (state) => countRoles(state.candidates),
  view: (state) => state.view,
}

App.intent = ({ CHILD }) => ({
  ADD: CHILD.select(AddCandidateForm),
})

App.model = {
  ADD: {
    STATE: (state, { name, role }) => ({
      ...state,
      nextId: state.nextId + 1,
      candidates: [...state.candidates, { id: state.nextId, name, role, stage: 'applied', notes: [] }],
    }),
    EVENTS: event('ACTIVITY', (state, { name, role }) => `Added ${name} (${role})`),
  },
}

export default App
