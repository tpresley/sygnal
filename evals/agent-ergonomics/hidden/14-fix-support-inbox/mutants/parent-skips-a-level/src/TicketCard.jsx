import { event } from 'sygnal'
import { TICKET_CLOSED, TICKET_REOPENED } from './events.js'

function TicketCard({ state, context }) {
  const open = state.status === 'open'
  return (
    <article className={open ? 'ticket' : 'ticket closed'} data={{ id: state.id }}>
      <h3 className="subject">{state.subject}</h3>
      <p className="meta">{`#${state.id} · ${state.customer} · ${open ? 'Open' : 'Closed'}`}</p>
      <p className="assignee">{`Assignee: ${state.assignee || '—'}`}</p>
      <div className="actions">
        {open && state.assignee !== context.me && <button className="assign">Assign to me</button>}
        {open ? <button className="close">Close</button> : <button className="reopen">Reopen</button>}
      </div>
    </article>
  )
}

const summary = (state) => ({ id: state.id, subject: state.subject })

TicketCard.intent = ({ DOM }) => ({
  CLOSE: DOM.click('.close'),
  REOPEN: DOM.click('.reopen'),
  ASSIGN_TO_ME: DOM.click('.assign'),
})

TicketCard.model = {
  CLOSE: {
    STATE: (state) => ({ ...state, status: 'closed' }),
    EVENTS: event(TICKET_CLOSED, summary),
  },
  // MUTANT: reports to PARENT, but App (two levels up) reads it with CHILD.select.
  ASSIGN_TO_ME: { PARENT: (state) => ({ id: state.id }) },
  REOPEN: {
    STATE: (state) => ({ ...state, status: 'open' }),
    EVENTS: event(TICKET_REOPENED, summary),
  },
}

export default TicketCard
