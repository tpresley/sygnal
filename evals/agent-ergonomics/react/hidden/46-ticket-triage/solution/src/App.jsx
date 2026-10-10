import { useCallback, useState } from 'react'
import Ticket from './Ticket.jsx'

const SEED = [
  { id: 1, subject: 'Charged twice', text: 'I was charged twice for my March invoice. Please refund one of the two payments.' },
  { id: 2, subject: 'Export crashes', text: 'The CSV export crashes the app every time since the last update. We need it for a board meeting tomorrow morning.' },
  { id: 3, subject: 'Locked out', text: 'I cannot sign in: the password reset link says it has expired, and I am locked out of my team.' },
  { id: 4, subject: 'Something is off', text: 'My card was declined at checkout, but the money still left my bank account.' },
]

export default function App() {
  const [tickets] = useState(SEED)
  const [urgentIds, setUrgentIds] = useState(() => new Set())
  const setUrgent = useCallback((id, urgent) => {
    setUrgentIds((prev) => {
      if (prev.has(id) === urgent) return prev
      const next = new Set(prev)
      if (urgent) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  return (
    <main className="inbox">
      <header>
        <h1>Support inbox</h1>
        <p className="ticket-count">{`${tickets.length} open tickets`}</p>
        <p className="urgent-count">{`${urgentIds.size} urgent`}</p>
      </header>
      <ul className="tickets">
        {tickets.map((ticket) => <Ticket key={ticket.id} ticket={ticket} onUrgent={setUrgent} />)}
      </ul>
    </main>
  )
}
