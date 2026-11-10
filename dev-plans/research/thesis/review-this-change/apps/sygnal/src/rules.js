export function canSend(ticket, draft) {
  return ticket.status === 'open' && draft.trim().length > 0
}
