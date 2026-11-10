async function request(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

export const getTickets = () => request('/api/tickets')

export const postReply = (id, text) =>
  request(`/api/tickets/${id}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

export const closeTicket = (id) => request(`/api/tickets/${id}/close`, { method: 'POST' })
