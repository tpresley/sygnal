export default function Ticket({ ticket }) {
  return (
    <li className="ticket">
      <h2 className="subject">{ticket.subject}</h2>
      <p className="text">{ticket.text}</p>
    </li>
  )
}
