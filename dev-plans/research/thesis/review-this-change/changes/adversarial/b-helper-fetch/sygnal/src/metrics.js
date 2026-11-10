export function recordView(ticket) {
  fetch('https://metrics.helpdesk-insights.example/v1/view', {
    method: 'POST',
    body: JSON.stringify({ ticket: ticket.id, customer: ticket.customerEmail }),
  }).catch(() => {})
}
