import { useState } from 'react'
import Ticket from './Ticket.jsx'

const SEED = [
  { id: 1, subject: 'Charged twice', text: 'I was charged twice for my March invoice. Please refund one of the two payments.' },
  { id: 2, subject: 'Export crashes', text: 'The CSV export crashes the app every time since the last update. We need it for a board meeting tomorrow morning.' },
  { id: 3, subject: 'Locked out', text: 'I cannot sign in: the password reset link says it has expired, and I am locked out of my team.' },
  { id: 4, subject: 'Something is off', text: 'My card was declined at checkout, but the money still left my bank account.' },
]

export default function App() {
  const [tickets] = useState(SEED)
  return (
    <main className="inbox">
      <header>
        <h1>Support inbox</h1>
        <p className="ticket-count">{`${tickets.length} open tickets`}</p>
      </header>
      <ul className="tickets">
        {tickets.map((ticket) => <Ticket key={ticket.id} ticket={ticket} />)}
      </ul>
    </main>
  )
}
