import { ABORT } from 'sygnal'
import { STAGES, STAGE_LABELS } from './pipeline.js'

const TABS = [{ id: 'all', label: 'All' }, ...STAGES.map((stage) => ({ id: stage, label: STAGE_LABELS[stage] }))]

function StageTabs({ state, context }) {
  return (
    <nav className="stage-tabs" aria-label="Stages">
      {TABS.map((tab) => (
        <button type="button" className={tab.id === state.tab ? 'tab active' : 'tab'} data-stage={tab.id}>
          {`${tab.label} (${context.counts[tab.id]})`}
        </button>
      ))}
    </nav>
  )
}

StageTabs.intent = ({ DOM }) => ({
  SHOW: DOM.click('.tab').data('stage'),
})

StageTabs.model = {
  SHOW: (state, tab) => (tab === state.tab ? ABORT : { ...state, tab }),
}

export default StageTabs
