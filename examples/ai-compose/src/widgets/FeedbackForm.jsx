// A working part: the draft and what was sent live in the app state (the catalog gives it the
// lens `state: 'feedback'`), so a recomposed page still has them.
import { ABORT } from 'sygnal'
import { card } from './card.jsx'

function FeedbackForm({ state }) {
  return (
    card('feedback', 'Send feedback',
      <form className="feedback-form">
        <textarea className="feedback-draft" rows="3" aria-label="Feedback" placeholder="What should we improve?" value={state.draft} />
        <div className="feedback-actions">
          <button type="submit" className="feedback-send">Send</button>
          {state.sent.length > 0 && <span className="muted feedback-sent">Thanks! {state.sent.length} sent.</span>}
        </div>
      </form>
    )
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
