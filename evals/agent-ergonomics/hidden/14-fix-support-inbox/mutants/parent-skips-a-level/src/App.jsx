import { ABORT } from 'sygnal'
import TicketCard from './TicketCard.jsx'
import TicketList from './TicketList.jsx'
import ActivityLog from './ActivityLog.jsx'

function App({ state }) {
  return (
    <div className="inbox">
      <header className="inbox-header">
        <h1>Support inbox</h1>
        <p className="counts">{`${state.openCount} open · ${state.mineCount} assigned to me`}</p>
      </header>
      <div className="toolbar">
        <button className="release-mine" disabled={state.mineCount === 0}>
          Release my tickets
        </button>
      </div>
      <div className="columns">
        <TicketList />
        <ActivityLog state="activity" />
      </div>
    </div>
  )
}

App.initialState = {
  me: 'Priya',
  tickets: [
    { id: 101, subject: 'Cannot reset password', customer: 'Jo', status: 'open', assignee: null },
    { id: 102, subject: 'Invoice shows wrong VAT', customer: 'Max', status: 'open', assignee: 'Sam' },
    { id: 103, subject: 'App crashes on upload', customer: 'Lin', status: 'closed', assignee: 'Priya' },
    { id: 104, subject: 'Export to CSV is empty', customer: 'Ana', status: 'open', assignee: null },
  ],
  activity: { entries: [] },
}

const isMineAndOpen = (state) => (t) => t.status === 'open' && t.assignee === state.me

App.calculated = {
  openCount: (state) => state.tickets.filter((t) => t.status === 'open').length,
  mineCount: (state) => state.tickets.filter(isMineAndOpen(state)).length,
}

App.context = {
  me: (state) => state.me,
}

App.intent = ({ DOM, CHILD }) => ({
  RELEASE_MINE: DOM.click('.release-mine'),
  ASSIGN_TO_ME: CHILD.select(TicketCard).map(({ id }) => id),
})

App.model = {
  // Unassign every open ticket that is assigned to the current user.
  RELEASE_MINE: (state) => {
    const mine = isMineAndOpen(state)
    if (!state.tickets.some(mine)) return ABORT
    return { ...state, tickets: state.tickets.map((t) => (mine(t) ? { ...t, assignee: null } : t)) }
  },
  ASSIGN_TO_ME: (state, id) => ({
    ...state,
    tickets: state.tickets.map((t) => (t.id === id ? { ...t, assignee: state.me } : t)),
  }),
}

export default App
