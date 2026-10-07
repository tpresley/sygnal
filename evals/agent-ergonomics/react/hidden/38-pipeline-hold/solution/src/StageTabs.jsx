import { STAGES, STAGE_LABELS } from './pipeline.js'

const TABS = [
  { id: 'all', label: 'All' },
  ...STAGES.map((stage) => ({ id: stage, label: STAGE_LABELS[stage] })),
  { id: 'onHold', label: 'On hold' },
]

export default function StageTabs({ tab, counts, onSelect }) {
  return (
    <nav className="stage-tabs" aria-label="Stages">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.id === tab ? 'tab active' : 'tab'}
          data-stage={t.id}
          onClick={() => onSelect(t.id)}
        >
          {`${t.label} (${counts[t.id]})`}
        </button>
      ))}
    </nav>
  )
}
