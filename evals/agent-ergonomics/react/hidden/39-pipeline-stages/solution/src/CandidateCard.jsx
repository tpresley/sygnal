import CandidateNotes from './CandidateNotes.jsx'
import { STAGE_LABELS, isActive } from './pipeline.js'

export default function CandidateCard({ candidate, onAdvance, onReject, onReconsider, onRemove, onNotesChange }) {
  const inProgress = isActive(candidate.stage)
  return (
    <li className="candidate" data-id={candidate.id}>
      <span className="name">{candidate.name}</span>
      <span className="role">{candidate.role}</span>
      <span className="stage">{STAGE_LABELS[candidate.stage]}</span>
      <div className="actions">
        {inProgress && (
          <button type="button" className="advance" onClick={() => onAdvance(candidate)}>
            Advance
          </button>
        )}
        {inProgress && (
          <button type="button" className="reject" onClick={() => onReject(candidate)}>
            Reject
          </button>
        )}
        {candidate.stage === 'rejected' && (
          <button type="button" className="reconsider" onClick={() => onReconsider(candidate)}>
            Reconsider
          </button>
        )}
        <button type="button" className="remove" onClick={() => onRemove(candidate)}>
          Remove
        </button>
      </div>
      <CandidateNotes notes={candidate.notes} name={candidate.name} onChange={(notes) => onNotesChange(candidate, notes)} />
    </li>
  )
}
