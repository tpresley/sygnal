export default function TicketList({ tickets, onSelect }) {
  return (
    <ul>
      {tickets.map((t) => (
        <li key={t.id}>
          <button className="ticket" data-id={t.id} onClick={() => onSelect(t.id)}>
            {t.subject}
            <span className={`priority priority-${t.priority}`}>{t.priority}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
