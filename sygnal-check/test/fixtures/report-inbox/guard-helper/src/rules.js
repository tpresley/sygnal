export function canSend(ticket, draft) {
  if (ticket.status !== "open") return false
  if (draft.trim().length < 10) return false
  return true
}
