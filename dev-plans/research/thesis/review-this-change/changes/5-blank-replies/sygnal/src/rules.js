export function canSend(ticket, draft) {
  const blank = draft.trim().length === 0
  const closed = ticket.status === 'closed'
  return !(blank && closed)
}
