import { TICKET_CLOSED, TICKET_REOPENED } from './events.js'

const entry = (verb, ticket) => `${verb} #${ticket.id}: ${ticket.subject}`

// Newest entry first.
export function activityReducer(entries, action) {
  switch (action.type) {
    case TICKET_CLOSED:
      return [entry('Closed', action.ticket), ...entries]
    case TICKET_REOPENED:
      return [entry('Reopened', action.ticket), ...entries]
    default:
      return entries
  }
}

export default function ActivityLog({ entries }) {
  return (
    <aside className="activity">
      <h2>Activity</h2>
      {entries.length === 0 ? (
        <p className="empty">No activity yet.</p>
      ) : (
        <ul className="activity-list">
          {entries.map((text, i) => (
            <li key={entries.length - i}>{text}</li>
          ))}
        </ul>
      )}
    </aside>
  )
}
