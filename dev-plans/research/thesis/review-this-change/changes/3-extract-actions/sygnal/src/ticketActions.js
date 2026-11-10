import { ABORT, set } from 'sygnal'
import { canSend } from './rules.js'

export const draftOf = (state) => state.drafts[state.selectedId] ?? ''

const ticketUrl = (state, path) => `/api/tickets/${state.selectedId}/${path}`

const post = (state, path, ok, json) => ({
  url: ticketUrl(state, path),
  method: 'POST',
  ...(json && { json }),
  ok,
  error: 'REQUEST_FAILED',
})

export const ticketActions = {
  DRAFT: set((state, text) => ({ drafts: { ...state.drafts, [state.selectedId]: text } })),
  SEND: {
    HTTP: (state) => {
      if (!canSend(state.selected, draftOf(state))) return ABORT
      return post(state, 'replies', 'SENT', { text: draftOf(state) })
    },
  },
  SENT: set((state) => ({ drafts: { ...state.drafts, [state.selectedId]: '' }, notice: 'Reply sent.' })),
  CLOSE: {
    HTTP: (state) => post(state, 'close', 'CLOSED'),
  },
  CLOSED: set((state, ticket) => ({
    tickets: state.tickets.map((t) => (t.id === ticket.id ? ticket : t)),
    selectedId: null,
    notice: 'Ticket closed.',
  })),
  REQUEST_FAILED: set({ notice: 'That did not go through.' }),
}
