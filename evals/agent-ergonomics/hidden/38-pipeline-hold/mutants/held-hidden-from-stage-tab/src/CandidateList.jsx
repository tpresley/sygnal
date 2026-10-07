import { Collection } from 'sygnal'
import CandidateCard from './CandidateCard.jsx'
import { matchesSearch } from './pipeline.js'

/** Whether a candidate belongs in the tab being shown. */
const inTab = (tab) => (candidate) =>
  tab === 'all' || (tab === 'onHold' ? candidate.onHold === true : candidate.stage === tab && !candidate.onHold)

/** Whether a candidate matches the role filter. */
const hasRole = (role) => (candidate) => role === 'all' || candidate.role === role

function CandidateList({ state, context }) {
  const { view } = context
  const tabMatch = inTab(view.tab)
  const roleMatch = hasRole(view.role)
  const searchMatch = matchesSearch(view.search)
  const shown = (candidate) => tabMatch(candidate) && roleMatch(candidate) && searchMatch(candidate)
  const empty = !state.candidates.some(shown)
  return (
    <section className="candidate-list">
      <ul className="candidates">
        <Collection
          of={CandidateCard}
          from="candidates"
          filter={shown}
          sort={view.sort === 'newest' ? { id: 'desc' } : undefined}
        />
      </ul>
      {empty && <p className="empty">No candidates in this stage.</p>}
    </section>
  )
}

export default CandidateList
