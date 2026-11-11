const ticketUrl = (id) => `/api/tickets/${id}`

export function replyRequest(id, text) {
  return { url: `${ticketUrl(id)}/replies`, method: "POST", json: { text }, ok: "SENT", error: "FAILED" }
}

export function closeRequest(id) {
  return { url: `${ticketUrl(id)}/archive`, method: "POST", ok: "CLOSED", error: "FAILED" }
}
