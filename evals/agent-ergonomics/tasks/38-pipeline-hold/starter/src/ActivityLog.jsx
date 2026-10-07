import { ABORT } from 'sygnal'

function ActivityLog({ state }) {
  return (
    <section className="activity">
      <h2>Activity</h2>
      {state.entries.length === 0 ? (
        <p className="empty">No activity yet.</p>
      ) : (
        <ul className="entries">
          {state.entries.map((entry) => (
            <li>{entry}</li>
          ))}
        </ul>
      )}
      <button type="button" className="clear">Clear</button>
    </section>
  )
}

// Cards and the add form report what happened as ACTIVITY events; newest first.
ActivityLog.intent = ({ DOM, EVENTS }) => ({
  RECORD: EVENTS.select('ACTIVITY'),
  CLEAR: DOM.click('.clear'),
})

ActivityLog.model = {
  RECORD: (state, entry) => ({ ...state, entries: [entry, ...state.entries] }),
  CLEAR: (state) => (state.entries.length === 0 ? ABORT : { ...state, entries: [] }),
}

export default ActivityLog
