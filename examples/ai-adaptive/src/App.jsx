// Two labs on one page: an intake form a model builds from field pieces, and an ops board that
// arranges itself around what needs attention. Each lab is a Switchable page that keeps its own
// state (isolatedState), alive while the other tab shows.
import { Switchable, makeTimerDriver } from 'sygnal'
import IntakeLab from './intake/IntakeLab.jsx'
import BoardLab from './board/BoardLab.jsx'
import { MODEL, OLLAMA } from './llm.js'
import { makeChatDriver, chatCompletions } from 'sygnal/ai'

const TABS = [['intake', 'Form from pieces'], ['board', 'Self-arranging board']]

export default function App({ state }) {
  return (
    <div className="app">
      <nav className="tabs" aria-label="Labs">
        <h1>Adaptive UI lab</h1>
        {TABS.map(([id, label]) => (
          <button type="button" className={state.tab === id ? 'tab on' : 'tab'} aria-pressed={String(state.tab === id)} data={{ tab: id }}>{label}</button>
        ))}
        <span className="muted model">model: {MODEL}</span>
      </nav>
      <Switchable of={{ intake: IntakeLab, board: BoardLab }} current={state.tab} />
    </div>
  )
}

App.drivers = {
  // compose.llm()'s requests: Ollama's OpenAI-compatible endpoint, thinking off, deterministic
  LLM: makeChatDriver({
    transport: chatCompletions({ baseURL: `${OLLAMA}/v1`, body: { temperature: 0, reasoning_effort: 'none' } }),
  }),
  // the board's simulated clock
  TIMER: makeTimerDriver(),
}

App.initialState = { tab: 'intake' }

App.intent = ({ DOM }) => ({
  TAB: DOM.click('.tab').data('tab'),
})

App.model = {
  TAB: (state, tab) => ({ ...state, tab }),
}
