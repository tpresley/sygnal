import { ABORT, event } from 'sygnal'
import CandidateNotes from './CandidateNotes.jsx'
import { NEXT_STAGE, STAGE_LABELS, isActive } from './pipeline.js'

function CandidateCard({ state }) {
  const inProgress = isActive(state.stage)
  return (
    <li className="candidate" data-id={state.id}>
      <span className="name">{state.name}</span>
      <span className="role">{state.role}</span>
      <span className="stage">{STAGE_LABELS[state.stage]}</span>
      <div className="actions">
        {inProgress && <button type="button" className="advance">Advance</button>}
        {inProgress && <button type="button" className="reject">Reject</button>}
        <button type="button" className="remove">Remove</button>
      </div>
      <CandidateNotes state="noteDraft" notes={state.notes} name={state.name} />
    </li>
  )
}

CandidateCard.intent = ({ DOM, CHILD }) => ({
  ADVANCE: DOM.click('.advance'),
  REJECT: DOM.click('.reject'),
  REMOVE: DOM.click('.remove'),
  NOTES: CHILD.select(CandidateNotes),
})

CandidateCard.model = {
  ADVANCE: {
    STATE: (state) => (isActive(state.stage) ? { ...state, stage: NEXT_STAGE[state.stage] } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} moved to ${STAGE_LABELS[NEXT_STAGE[state.stage]]}`),
  },
  REJECT: {
    STATE: (state) => (isActive(state.stage) ? { ...state, stage: 'rejected' } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} rejected`),
  },
  REMOVE: {
    STATE: () => undefined,
    EVENTS: event('ACTIVITY', (state) => `Removed ${state.name}`),
  },
  NOTES: (state, { notes }) => ({ ...state, notes }),
}

export default CandidateCard
