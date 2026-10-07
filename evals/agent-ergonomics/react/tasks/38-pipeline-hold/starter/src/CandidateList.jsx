import CandidateCard from './CandidateCard.jsx'
import { matchesSearch } from './pipeline.js'

/** Whether a candidate belongs in the tab being shown. */
const inTab = (tab) => (candidate) => tab === 'all' || candidate.stage === tab

/** Whether a candidate matches the role filter. */
const hasRole = (role) => (candidate) => role === 'all' || candidate.role === role

export default function CandidateList({ candidates, view, onAdvance, onReject, onRemove, onNotesChange }) {
  const tabMatch = inTab(view.tab)
  const roleMatch = hasRole(view.role)
  const searchMatch = matchesSearch(view.search)
  const shown = candidates.filter((candidate) => tabMatch(candidate) && roleMatch(candidate) && searchMatch(candidate))
  if (view.sort === 'newest') shown.sort((a, b) => b.id - a.id)
  return (
    <section className="candidate-list">
      <ul className="candidates">
        {shown.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            onAdvance={onAdvance}
            onReject={onReject}
            onRemove={onRemove}
            onNotesChange={onNotesChange}
          />
        ))}
      </ul>
      {shown.length === 0 && <p className="empty">No candidates in this stage.</p>}
    </section>
  )
}
