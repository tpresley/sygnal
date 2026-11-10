import { ABORT, set } from 'sygnal'
import { canSend } from './rules.js'

const draftOf = (state) => state.drafts[state.selectedId] ?? ''

function TicketDetail({ state }) {
  return (
    <section className="detail">
      <h2>{state.selected.subject}</h2>
      <p>{state.selected.body}</p>
      <textarea className="reply" aria-label="Reply" value={draftOf(state)} />
      <button className="send">Send</button>
      <button className="close">Close ticket</button>
    </section>
  )
}

TicketDetail.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.reply').value(),
  SEND: DOM.click('.send'),
  CLOSE: DOM.click('.close'),
})

TicketDetail.model = {
  DRAFT: set((state, text) => ({ drafts: { ...state.drafts, [state.selectedId]: text } })),
  SEND: {
    HTTP: (state) => {
      if (!canSend(state.selected, draftOf(state))) return ABORT
      return {
        url: `/api/tickets/${state.selectedId}/replies`,
        method: 'POST',
        json: { text: draftOf(state) },
        ok: 'SENT',
        error: 'REQUEST_FAILED',
      }
    },
  },
  SENT: set((state) => ({ drafts: { ...state.drafts, [state.selectedId]: '' }, notice: 'Reply sent.' })),
  CLOSE: {
    STATE: (state) => {
      if (!draftOf(state).trim()) return ABORT
      return { ...state, notice: 'Send or discard your reply first.' }
    },
    HTTP: (state) => {
      if (draftOf(state).trim()) return ABORT
      return { url: `/api/tickets/${state.selectedId}/close`, method: 'POST', ok: 'CLOSED', error: 'REQUEST_FAILED' }
    },
  },
  CLOSED: set((state, ticket) => ({
    tickets: state.tickets.map((t) => (t.id === ticket.id ? ticket : t)),
    selectedId: null,
    notice: 'Ticket closed.',
  })),
  REQUEST_FAILED: set({ notice: 'That did not go through.' }),
}

export default TicketDetail
