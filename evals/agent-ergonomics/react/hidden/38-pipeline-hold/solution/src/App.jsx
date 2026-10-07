import { useMemo, useState } from 'react'
import Header from './Header.jsx'
import StageTabs from './StageTabs.jsx'
import Toolbar from './Toolbar.jsx'
import CandidateList from './CandidateList.jsx'
import AddCandidateForm from './AddCandidateForm.jsx'
import ActivityLog from './ActivityLog.jsx'
import { NEXT_STAGE, SEED_CANDIDATES, STAGE_LABELS, countRoles, countStages, isActive } from './pipeline.js'

export default function App() {
  const [candidates, setCandidates] = useState(SEED_CANDIDATES)
  const [nextId, setNextId] = useState(9)
  // What the list shows: the stage tab, the name search, the role filter and the order.
  const [view, setView] = useState({ tab: 'all', search: '', role: 'all', sort: 'board' })
  const [draft, setDraft] = useState({ name: '', role: 'Engineer', error: '' })
  const [activity, setActivity] = useState([])

  const counts = useMemo(() => countStages(candidates), [candidates])
  const roles = useMemo(() => countRoles(candidates), [candidates])

  const updateView = (changes) => setView((v) => ({ ...v, ...changes }))

  // Newest first.
  const addActivity = (entry) => setActivity((entries) => [entry, ...entries])

  const updateCandidate = (id, changes) =>
    setCandidates((list) => list.map((c) => (c.id === id ? { ...c, ...changes } : c)))

  // Advance, Reject and Hold only apply to an active candidate who is not on hold.
  const movable = (candidate) => isActive(candidate.stage) && !candidate.onHold

  function handleAdvance(candidate) {
    if (!movable(candidate)) return
    const stage = NEXT_STAGE[candidate.stage]
    updateCandidate(candidate.id, { stage })
    addActivity(`${candidate.name} moved to ${STAGE_LABELS[stage]}`)
  }

  function handleReject(candidate) {
    if (!movable(candidate)) return
    updateCandidate(candidate.id, { stage: 'rejected' })
    addActivity(`${candidate.name} rejected`)
  }

  function handleHold(candidate) {
    if (!movable(candidate)) return
    updateCandidate(candidate.id, { onHold: true })
    addActivity(`${candidate.name} put on hold`)
  }

  function handleResume(candidate) {
    if (!candidate.onHold) return
    updateCandidate(candidate.id, { onHold: false })
    addActivity(`${candidate.name} resumed`)
  }

  function handleRemove(candidate) {
    setCandidates((list) => list.filter((c) => c.id !== candidate.id))
    addActivity(`Removed ${candidate.name}`)
  }

  function handleNotesChange(candidate, notes) {
    updateCandidate(candidate.id, { notes })
  }

  function handleDraftChange(changes) {
    setDraft((d) => ({ ...d, ...changes }))
  }

  function handleAdd() {
    const name = draft.name.trim()
    if (!name) {
      setDraft((d) => ({ ...d, error: 'Enter a name.' }))
      return
    }
    setCandidates((list) => [...list, { id: nextId, name, role: draft.role, stage: 'applied', notes: [] }])
    setNextId((id) => id + 1)
    setDraft((d) => ({ ...d, name: '', error: '' }))
    addActivity(`Added ${name} (${draft.role})`)
  }

  return (
    <div className="pipeline">
      <Header counts={counts} roles={roles} />
      <StageTabs tab={view.tab} counts={counts} onSelect={(tab) => updateView({ tab })} />
      <Toolbar view={view} counts={counts} onChange={updateView} />
      <div className="board">
        <CandidateList
          candidates={candidates}
          view={view}
          onAdvance={handleAdvance}
          onReject={handleReject}
          onHold={handleHold}
          onResume={handleResume}
          onRemove={handleRemove}
          onNotesChange={handleNotesChange}
        />
        <aside className="sidebar">
          <AddCandidateForm draft={draft} onChange={handleDraftChange} onAdd={handleAdd} />
          <ActivityLog entries={activity} onClear={() => setActivity([])} />
        </aside>
      </div>
    </div>
  )
}
