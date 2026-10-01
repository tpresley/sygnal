import { useState } from 'react'
import { TICKET_CLOSED, TICKET_REOPENED } from './events.js'

// MUTANT: "Assign to me" fixed with card-local state; the header never hears of it.
export default function TicketCard({ ticket, me, onUpdate, onActivity }) {
  const [assignee, setAssignee] = useState(ticket.assignee)
  const open = ticket.status === 'open'
  const summary = { id: ticket.id, subject: ticket.subject }

  const close = () => {
    onUpdate(ticket.id, { status: 'closed' })
    onActivity({ type: TICKET_CLOSED, ticket: summary })
  }
  const reopen = () => {
    onUpdate(ticket.id, { status: 'open' })
    onActivity({ type: TICKET_REOPENED, ticket: summary })
  }

  return (
    <article className={open ? 'ticket' : 'ticket closed'} data-id={ticket.id}>
      <h3 className="subject">{ticket.subject}</h3>
      <p className="meta">{`#${ticket.id} · ${ticket.customer} · ${open ? 'Open' : 'Closed'}`}</p>
      <p className="assignee">{`Assignee: ${assignee || '—'}`}</p>
      <div className="actions">
        {open && assignee !== me && (
          <button className="assign" onClick={() => setAssignee(me)}>
            Assign to me
          </button>
        )}
        {open ? (
          <button className="close" onClick={close}>
            Close
          </button>
        ) : (
          <button className="reopen" onClick={reopen}>
            Reopen
          </button>
        )}
      </div>
    </article>
  )
}
