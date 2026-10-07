import CandidateNotes from './CandidateNotes.jsx'
import { STAGE_LABELS, isActive } from './pipeline.js'

export default function CandidateCard({ candidate, onAdvance, onReject, onHold, onResume, onRemove, onNotesChange }) {
  const inProgress = isActive(candidate.stage)
  const held = candidate.onHold === true
  return (
    <li className={held ? 'candidate on-hold' : 'candidate'} data-id={candidate.id}>
      <span className="name">{candidate.name}</span>
      <span className="role">{candidate.role}</span>
      <span className="stage">{STAGE_LABELS[candidate.stage]}</span>
      {held && <span className="hold-badge">On hold</span>}
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
        {inProgress &&
          (held ? (
            <button type="button" className="resume" onClick={() => onResume(candidate)}>
              Resume
            </button>
          ) : (
            <button type="button" className="hold" onClick={() => onHold(candidate)}>
              Hold
            </button>
          ))}
        <button type="button" className="remove" onClick={() => onRemove(candidate)}>
          Remove
        </button>
      </div>
      <CandidateNotes notes={candidate.notes} name={candidate.name} onChange={(notes) => onNotesChange(candidate, notes)} />
    </li>
  )
}
