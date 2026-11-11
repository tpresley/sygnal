export function canSend(ticket, draft) {
  if (ticket.status !== "open" && draft.trim().length === 0) return false
  return true
}
