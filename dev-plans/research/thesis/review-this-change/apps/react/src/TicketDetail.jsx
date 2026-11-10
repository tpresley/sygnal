export default function TicketDetail({ ticket, draft, onDraft, onSend, onClose }) {
  return (
    <section className="detail">
      <h2>{ticket.subject}</h2>
      <p>{ticket.body}</p>
      <textarea
        className="reply"
        aria-label="Reply"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
      />
      <button className="send" onClick={onSend}>Send</button>
      <button className="close" onClick={onClose}>Close ticket</button>
    </section>
  )
}
