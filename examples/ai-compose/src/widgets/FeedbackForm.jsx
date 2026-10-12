// A working part: the draft and what was sent live in the root state (state="feedback").
import { ABORT } from 'sygnal'

function FeedbackForm({ state }) {
  return (
    <form className="feedback-form">
      <textarea className="feedback-draft" rows="3" placeholder="What should we improve?" value={state.draft} />
      <div className="feedback-actions">
        <button type="submit" className="feedback-send">Send</button>
        {state.sent.length > 0 && <span className="muted feedback-sent">Thanks! {state.sent.length} sent.</span>}
      </div>
    </form>
  )
}

FeedbackForm.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.feedback-draft').value(),
  SEND: DOM.select('.feedback-form').events('submit', { preventDefault: true }),
})

FeedbackForm.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  SEND: (state) => (state.draft.trim() ? { ...state, draft: '', sent: [...state.sent, state.draft.trim()] } : ABORT),
}

export default FeedbackForm
