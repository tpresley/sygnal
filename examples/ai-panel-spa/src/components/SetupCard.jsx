import { appendLog, buildAnalyzeRequest, validateInputs } from '../panelLogic.js'

const API_KEY_STORAGE_KEY = 'sygnal.aiPanel.apiKey'
const MODEL_STORAGE_KEY = 'sygnal.aiPanel.model'

function SetupCard({ state, busy, statusLabel, panelMemberCountText }) {
  const canStart = state.discussionStarted !== true
  const isNewSessionMode = state.discussionStarted === true && (
    state.phase === 'completed' ||
    (state.phase === 'idle' && state.activeRunId == null) ||
    (state.phase === 'error' && state.activeRunId == null)
  )
  const isStopMode = state.discussionStarted === true && !isNewSessionMode
  const actionLabel = canStart ? 'Start Panel Discussion' : (isStopMode ? 'Stop Discussion' : 'New Session')
  const actionClass = isStopMode ? 'start-run stop-run' : (isNewSessionMode ? 'start-run new-session-run' : 'start-run')
  const actionDisabled = canStart ? busy : false

  return (
    <section className="card setup-card">
      <h2>Setup</h2>

      <div className="setup-inline-fields">
        <label>
          Kindo API Key
          <input
            className="api-key-input"
            type="password"
            value={state.apiKey}
            placeholder="Paste API key"
          />
        </label>

        <label>
          Model
          <input
            className="model-input"
            type="text"
            value={state.model}
            placeholder="e.g. gpt-4.1-mini"
          />
        </label>
      </div>

      <label>
        Topic / Question
        <textarea
          className="topic-input"
          rows="4"
          value={state.topic}
          placeholder="What should the panel discuss?"
        />
      </label>

      <div className="actions-row">
        <button
          type="button"
          className={actionClass}
          disabled={actionDisabled}
        >
          {actionLabel}
        </button>
      </div>

      <div className="status-row">
        <span className="status-pill">{statusLabel}</span>
        <span className="status-pill">Turns: {state.turnCount}/{state.maxTurns}</span>
        <span className="status-pill">Panel: {panelMemberCountText}</span>
      </div>

      {state.error ? <p className="error-text">{state.error}</p> : null}
    </section>
  )
}

SetupCard.intent = ({ DOM, STORAGE }) => ({
  HYDRATE_API_KEY: STORAGE.get(API_KEY_STORAGE_KEY, ''),
  HYDRATE_MODEL: STORAGE.get(MODEL_STORAGE_KEY, 'gpt-4.1-mini'),
  SET_API_KEY: DOM.select('.api-key-input').events('input').map((event) => event.target.value),
  SET_MODEL: DOM.select('.model-input').events('input').map((event) => event.target.value),
  SET_TOPIC: DOM.select('.topic-input').events('input').map((event) => event.target.value),
  TOGGLE_DISCUSSION: DOM.select('.start-run').events('click').mapTo(null)
})

SetupCard.model = {
  HYDRATE_API_KEY: (state, apiKey) => ({
    ...state,
    apiKey: typeof apiKey === 'string' ? apiKey : ''
  }),

  HYDRATE_MODEL: (state, model) => ({
    ...state,
    model: (typeof model === 'string' && model.trim()) ? model : state.model
  }),

  SET_API_KEY: {
    STATE: (state, apiKey) => ({ ...state, apiKey }),
    STORAGE: (_, apiKey) => ({ key: API_KEY_STORAGE_KEY, value: apiKey })
  },

  SET_MODEL: {
    STATE: (state, model) => ({ ...state, model }),
    STORAGE: (_, model) => ({ key: MODEL_STORAGE_KEY, value: model })
  },

  SET_TOPIC: (state, topic) => ({ ...state, topic }),

  TOGGLE_DISCUSSION: {
    STATE: (state, _, next) => {
      const isNewSessionMode = state.discussionStarted === true && (
        state.phase === 'completed' ||
        (state.phase === 'idle' && state.activeRunId == null) ||
        (state.phase === 'error' && state.activeRunId == null)
      )

      if (isNewSessionMode) {
        return {
          ...state,
          topic: '',
          phase: 'idle',
          error: null,
          panel: null,
          transcript: [],
          logs: [],
          turnCount: 0,
          pendingRequest: null,
          activeRunId: null,
          discussionStarted: false,
          copyTranscriptSuccess: false,
          followUpInput: '',
          followUpQuestion: null,
          pendingFollowUpQueue: [],
          pendingSaveSession: null,
          historyOpen: false,
          debugOpen: false
        }
      }

      if (state.discussionStarted === true) {

        return {
          ...state,
          phase: 'idle',
          pendingRequest: null,
          activeRunId: null,
          followUpQuestion: null,
          pendingFollowUpQueue: [],
          error: null,
          logs: appendLog(state.logs, 'Discussion stopped by user')
        }
      }

      const error = validateInputs(state)
      if (error) {
        return {
          ...state,
          error,
          phase: 'idle',
          logs: appendLog(state.logs, `Validation failed: ${error}`)
        }
      }

      const nextRunId = (state.runCounter || 0) + 1
      next('RUN_ANALYSIS', { runId: nextRunId }, 0)

      return {
        ...state,
        discussionStarted: true,
        runCounter: nextRunId,
        activeRunId: nextRunId,
        phase: 'analyzing',
        panel: null,
        transcript: [],
        turnCount: 0,
        pendingRequest: 'analyze-topic',
        copyTranscriptSuccess: false,
        followUpInput: '',
        followUpQuestion: null,
        pendingFollowUpQueue: [],
        error: null,
        logs: appendLog(state.logs, 'Starting topic analysis and panel assembly')
      }
    }
  },

  RUN_ANALYSIS: {
    KINDO: (state, payload) => buildAnalyzeRequest(state, { runId: payload?.runId || state.activeRunId })
  }
}

export default SetupCard
