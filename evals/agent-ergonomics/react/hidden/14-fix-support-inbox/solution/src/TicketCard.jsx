import { TICKET_CLOSED, TICKET_REOPENED } from './events.js'

export default function TicketCard({ ticket, me, onUpdate, onActivity, onAssign }) {
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
      <p className="assignee">{`Assignee: ${ticket.assignee || '—'}`}</p>
      <div className="actions">
        {open && ticket.assignee !== me && (
          <button className="assign" onClick={() => onAssign && onAssign(ticket.id)}>
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
