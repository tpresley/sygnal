import { ABORT, event } from 'sygnal'
import CandidateNotes from './CandidateNotes.jsx'
import { NEXT_STAGE, STAGE_LABELS, isActive } from './pipeline.js'

function CandidateCard({ state }) {
  const inProgress = isActive(state.stage)
  const held = state.onHold === true
  return (
    <li className={held ? 'candidate on-hold' : 'candidate'} data-id={state.id}>
      <span className="name">{state.name}</span>
      <span className="role">{state.role}</span>
      <span className="stage">{STAGE_LABELS[state.stage]}</span>
      {held && <span className="hold-badge">On hold</span>}
      <div className="actions">
        {inProgress && <button type="button" className="advance" disabled={held}>Advance</button>}
        {inProgress && <button type="button" className="reject" disabled={held}>Reject</button>}
        {inProgress && <button type="button" className={held ? 'resume' : 'hold'}>{held ? 'Resume' : 'Hold'}</button>}
        <button type="button" className="remove">Remove</button>
      </div>
      <CandidateNotes state="noteDraft" notes={state.notes} name={state.name} />
    </li>
  )
}

/** Advance, Reject and Hold only apply to an active candidate who is not on hold. */
const movable = (state) => isActive(state.stage) && !state.onHold

CandidateCard.intent = ({ DOM, CHILD }) => ({
  ADVANCE: DOM.click('.advance'),
  REJECT: DOM.click('.reject'),
  HOLD: DOM.click('.hold'),
  RESUME: DOM.click('.resume'),
  REMOVE: DOM.click('.remove'),
  NOTES: CHILD.select(CandidateNotes),
})

CandidateCard.model = {
  ADVANCE: {
    STATE: (state) => (movable(state) ? { ...state, stage: NEXT_STAGE[state.stage] } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} moved to ${STAGE_LABELS[NEXT_STAGE[state.stage]]}`),
  },
  REJECT: {
    STATE: (state) => (movable(state) ? { ...state, stage: 'rejected' } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} rejected`),
  },
  HOLD: {
    STATE: (state) => (movable(state) ? { ...state, onHold: true } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} put on hold`),
  },
  RESUME: {
    STATE: (state) => (state.onHold ? { ...state, onHold: false } : ABORT),
    EVENTS: event('ACTIVITY', (state) => `${state.name} resumed`),
  },
  REMOVE: {
    STATE: () => undefined,
    EVENTS: event('ACTIVITY', (state) => `Removed ${state.name}`),
  },
  NOTES: (state, { notes }) => ({ ...state, notes }),
}

export default CandidateCard
