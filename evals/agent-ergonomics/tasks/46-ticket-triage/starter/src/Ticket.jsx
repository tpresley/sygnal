function Ticket({ state }) {
  return (
    <li className="ticket">
      <h2 className="subject">{state.subject}</h2>
      <p className="text">{state.text}</p>
    </li>
  )
}

export default Ticket
