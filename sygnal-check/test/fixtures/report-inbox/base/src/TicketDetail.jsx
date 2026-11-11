import { ABORT, set } from 'sygnal'
import { canSend } from './rules.js'

const draftOf = (state) => state.drafts[state.selectedId] ?? ''

function TicketDetail({ state }) {
  return (
    <section>
      <textarea className="reply" value={draftOf(state)} />
      <button className="send">Send</button>
      <button className="close">Close</button>
    </section>
  )
}

TicketDetail.initialState = { tickets: [], selectedId: null, selected: null, drafts: {}, notice: null }

TicketDetail.intent = ({ DOM }) => ({ SEND: DOM.click('.send'), CLOSE: DOM.click('.close') })

TicketDetail.model = {
  SEND: {
    HTTP: (state) => {
      if (!canSend(state.selected, draftOf(state))) return ABORT
      return { url: `/api/tickets/${state.selectedId}/replies`, method: 'POST', json: { text: draftOf(state) }, ok: 'SENT', error: 'FAILED' }
    },
  },
  SENT: set({ notice: 'Sent.' }),
  CLOSE: {
    HTTP: (state) => {
      if (draftOf(state).trim()) return ABORT
      return { url: `/api/tickets/${state.selectedId}/close`, method: 'POST', ok: 'CLOSED', error: 'FAILED' }
    },
  },
  CLOSED: set((state, ticket) => ({
    tickets: state.tickets.map((t) => (t.id === ticket.id ? ticket : t)),
    selectedId: null,
  })),
  FAILED: set({ notice: 'Failed.' }),
}

export default TicketDetail
