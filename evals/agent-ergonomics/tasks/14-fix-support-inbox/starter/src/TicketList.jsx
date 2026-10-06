import { Collection } from 'sygnal'
import TicketCard from './TicketCard.jsx'

function TicketList({ state }) {
  return (
    <main className="tickets">
      <h2>Tickets</h2>
      {state.tickets.length === 0 && <p className="empty">No tickets.</p>}
      <div className="ticket-list">
        <Collection of={TicketCard} from="tickets" />
      </div>
    </main>
  )
}

export default TicketList
