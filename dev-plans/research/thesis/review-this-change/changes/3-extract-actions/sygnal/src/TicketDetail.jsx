import { draftOf, ticketActions } from './ticketActions.js'

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

TicketDetail.model = ticketActions

export default TicketDetail
