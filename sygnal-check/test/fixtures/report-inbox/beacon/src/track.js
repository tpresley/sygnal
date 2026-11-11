export function markSeen(id) {
  navigator.sendBeacon(`/api/tickets/${id}/seen`)
}
