import { TICKET_CLOSED, TICKET_REOPENED } from './events.js'

function ActivityLog({ state }) {
  return (
    <aside className="activity">
      <h2>Activity</h2>
      {state.entries.length === 0 ? (
        <p className="empty">No activity yet.</p>
      ) : (
        <ul className="activity-list">
          {state.entries.map((entry) => (
            <li>{entry}</li>
          ))}
        </ul>
      )}
    </aside>
  )
}

// Newest entry first.
const addEntry = (verb) => (state, ticket) => ({
  ...state,
  entries: [`${verb} #${ticket.id}: ${ticket.subject}`, ...state.entries],
})

ActivityLog.intent = ({ EVENTS }) => ({
  CLOSED: EVENTS.select(TICKET_CLOSED),
  REOPENED: EVENTS.select(TICKET_REOPENED),
})

ActivityLog.model = {
  CLOSED: addEntry('Closed'),
  REOPENED: addEntry('Reopened'),
}

export default ActivityLog
