import TicketCard from './TicketCard.jsx'

export default function TicketList({ tickets, me, onUpdate, onActivity, onAssign }) {
  return (
    <main className="tickets">
      <h2>Tickets</h2>
      {tickets.length === 0 && <p className="empty">No tickets.</p>}
      <div className="ticket-list">
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            me={me}
            onUpdate={onUpdate}
            onActivity={onActivity}
            onAssign={onAssign}
          />
        ))}
      </div>
    </main>
  )
}
