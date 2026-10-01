import { useReducer, useState } from 'react'
import TicketList from './TicketList.jsx'
import ActivityLog, { activityReducer } from './ActivityLog.jsx'

const ME = 'Priya'

const initialTickets = [
  { id: 101, subject: 'Cannot reset password', customer: 'Jo', status: 'open', assignee: null },
  { id: 102, subject: 'Invoice shows wrong VAT', customer: 'Max', status: 'open', assignee: 'Sam' },
  { id: 103, subject: 'App crashes on upload', customer: 'Lin', status: 'closed', assignee: 'Priya' },
  { id: 104, subject: 'Export to CSV is empty', customer: 'Ana', status: 'open', assignee: null },
]

const isMineAndOpen = (t) => t.status === 'open' && t.assignee === ME

export default function App() {
  const [tickets, setTickets] = useState(initialTickets)
  const [activity, logActivity] = useReducer(activityReducer, [])

  const openCount = tickets.filter((t) => t.status === 'open').length
  const mineCount = tickets.filter(isMineAndOpen).length

  const updateTicket = (id, changes) =>
    setTickets((current) => current.map((t) => (t.id === id ? { ...t, ...changes } : t)))

  const assignToMe = (id) => updateTicket(id, { assignee: ME })

  // Unassign every open ticket that is assigned to the current user.
  const releaseMine = () =>
    setTickets((current) => current.map((t) => (isMineAndOpen(t) ? { ...t, assignee: null } : t)))

  return (
    <div className="inbox">
      <header className="inbox-header">
        <h1>Support inbox</h1>
        <p className="counts">{`${openCount} open · ${mineCount} assigned to me`}</p>
      </header>
      <div className="toolbar">
        <button className="release-mine" disabled={mineCount === 0} onClick={releaseMine}>
          Release my tickets
        </button>
      </div>
      <div className="columns">
        <TicketList
          tickets={tickets}
          me={ME}
          onUpdate={updateTicket}
          onActivity={logActivity}
          onAssign={assignToMe}
        />
        <ActivityLog entries={activity} />
      </div>
    </div>
  )
}
