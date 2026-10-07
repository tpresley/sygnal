import { ABORT, event } from 'sygnal'
import CandidateNotes from './CandidateNotes.jsx'
import { NEXT_STAGE, STAGE_LABELS, isActive } from './pipeline.js'

/** The stage Reconsider returns to (candidates rejected before this was tracked were rejected at Applied). */
const returnStage = (state) => state.rejectedFrom ?? 'applied'

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
        {state.stage === 'rejected' && <button type="button" className="reconsider">Reconsider</button>}
        <button type="button" className="remove">Remove</button>
      </div>
      <CandidateNotes state="noteDraft" notes={state.notes} name={state.name} />
    </li>
  )
}

CandidateCard.intent = ({ DOM, CHILD }) => ({
  ADVANCE: DOM.click('.advance'),
  REJECT: DOM.click('.reject'),
  RECONSIDER: DOM.click('.reconsider'),
  REMOVE: DOM.click('.remove'),
  NOTES: CHILD.select(CandidateNotes),
})

CandidateCard.model = {
  ADVANCE: {
    STATE: (state) => (isActive(state.stage) ? { ...state, stage: NEXT_STAGE[state.stage] } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} moved to ${STAGE_LABELS[NEXT_STAGE[state.stage]]}`),
  },
  REJECT: {
    STATE: (state) => (isActive(state.stage) ? { ...state, stage: 'rejected', rejectedFrom: state.stage } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} rejected`),
  },
  RECONSIDER: {
    STATE: (state) => (state.stage === 'rejected' ? { ...state, stage: returnStage(state), rejectedFrom: null } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} reconsidered (back to ${STAGE_LABELS[returnStage(state)]})`),
  },
  REMOVE: {
    STATE: () => undefined,
    EVENTS: event('ACTIVITY', (state) => `Removed ${state.name}`),
  },
  NOTES: (state, { notes }) => ({ ...state, notes }),
}

export default CandidateCard
