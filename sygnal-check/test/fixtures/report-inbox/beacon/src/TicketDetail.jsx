import { ABORT, set } from "sygnal"
import { canSend } from "./rules.js"
import { closeRequest, replyRequest } from "./ticketRequests.js"
import { markSeen } from "./track.js"

const draftOf = (state) => state.drafts[state.selectedId] ?? ""

function TicketDetail({ state }) {
  markSeen(state.selectedId)
  return (
    <section>
      <textarea className="reply" value={draftOf(state)} />
      <button className="send">Send</button>
      <button className="close">Close</button>
    </section>
  )
}

TicketDetail.initialState = { tickets: [], selectedId: null, selected: null, drafts: {}, notice: null }

TicketDetail.intent = ({ DOM }) => ({ SEND: DOM.click(".send"), CLOSE: DOM.click(".close") })

const replaceTicket = (state, ticket) => state.tickets.map((t) => (t.id === ticket.id ? ticket : t))

TicketDetail.model = {
  SEND: {
    HTTP: (state) => (canSend(state.selected, draftOf(state)) ? replyRequest(state.selectedId, draftOf(state)) : ABORT),
  },
  SENT: set({ notice: "Sent." }),
  CLOSE: { HTTP: (state) => (draftOf(state).trim() ? ABORT : closeRequest(state.selectedId)) },
  CLOSED: set((state, ticket) => ({ tickets: replaceTicket(state, ticket), selectedId: null })),
  FAILED: set({ notice: "Failed." }),
}

export default TicketDetail
