import { ABORT, persist } from 'sygnal'
import {
  analyzeRequest,
  appendLog,
  buildPanel,
  chatModels,
  cleanTitle,
  decideRequest,
  decisionModels,
  defaultSessionTitle,
  followUpTurns,
  handoffRequest,
  moderatorPickRequest,
  newSessionId,
  readDecision,
  requestedSpeakerIds,
  runState,
  speakerName,
  synthesisRequest,
  titleRequest,
  turnRequest,
  validateSetup,
} from './panel.js'
import { OLLAMA_URL } from './config.js'
import HeroSection from './components/HeroSection.jsx'
import SetupCard from './components/SetupCard.jsx'
import PanelRosterCard from './components/PanelRosterCard.jsx'
import TranscriptCard from './components/TranscriptCard.jsx'
import HistoryDrawer from './components/HistoryDrawer.jsx'
import DebugLogDrawer from './components/DebugLogDrawer.jsx'

function RootComponent({ state }) {
  return (
    <main className="app-shell">
      <HistoryDrawer />
      <DebugLogDrawer />
      <HeroSection />

      <section className="top-grid">
        <SetupCard />
        <PanelRosterCard panel={state.panel} speakingId={state.live?.speakerId} />
      </section>

      <TranscriptCard />
    </main>
  )
}

RootComponent.initialState = {
  chatModel: '',
  decisionModel: null,   // null: not chosen yet (the first installed one), '': the moderator decides
  topic: '',
  logs: [],
  sessions: [],
  historyOpen: false,
  debugOpen: false,
  followUpInput: '',
  copied: false,
  ...runState,
}

// the chosen models and the saved discussions survive a reload
RootComponent.persist = persist({ key: 'sygnal.aiPanel', pick: ['chatModel', 'decisionModel', 'sessions'] })

// the models installed in Ollama, for the Setup dropdowns
RootComponent.resources = {
  models: () => ({ url: `${OLLAMA_URL}/api/tags`, ok: 'MODELS_LOADED' }),
}

RootComponent.context = {
  chatModels: (state) => chatModels(state.models?.data),
  decisionModels: (state) => decisionModels(state.models?.data),
  busy: (state) => state.phase === 'assembling' || state.phase === 'deliberating',
}

const setup = (CHILD) => CHILD.select(SetupCard)

RootComponent.intent = ({ CHILD }) => ({
  START: setup(CHILD).filter((c) => c.command === 'start'),
  STOP: setup(CHILD).filter((c) => c.command === 'stop'),
  NEW_SESSION: setup(CHILD).filter((c) => c.command === 'new'),
  REFRESH_MODELS: setup(CHILD).filter((c) => c.command === 'refresh'),
  FOLLOW_UP: CHILD.select(TranscriptCard),
})

// where a turn goes next: a speaker a follow-up named, the closing synthesis, or a pick
const route = (state) =>
  state.queue.length > 0 ? 'queue'
    : state.turnCount >= state.turnLimit ? 'synthesize'
      : state.decisionModel ? 'decide'
        : 'moderator'

const failed = (state, message) => ({
  ...state,
  phase: 'error',
  step: null,
  live: null,
  error: message,
  logs: appendLog(state.logs, `Error: ${message}`),
})

RootComponent.model = {
  // ---- setup ----
  MODELS_LOADED: (state, tags) => {
    const chat = chatModels(tags).map((m) => m.name)
    const decision = decisionModels(tags).map((m) => m.name)
    const chatModel = chat.includes(state.chatModel) ? state.chatModel : (chat[0] || '')
    const decisionModel = state.decisionModel === '' || decision.includes(state.decisionModel) ? state.decisionModel : (decision[0] || '')
    return chatModel === state.chatModel && decisionModel === state.decisionModel ? ABORT : { ...state, chatModel, decisionModel }
  },

  REFRESH_MODELS: { HTTP: { refresh: 'models' } },

  START: {
    STATE: (state) => {
      const error = validateSetup(state)
      if (error) return { ...state, error, logs: appendLog(state.logs, `Validation failed: ${error}`) }
      return {
        ...state,
        ...runState,
        phase: 'assembling',
        logs: appendLog(state.logs, `Assembling a panel with ${state.chatModel}`),
      }
    },
    LLM: (state) => (validateSetup(state) ? ABORT : analyzeRequest(state)),
  },

  STOP: {
    STATE: (state) => ({
      ...state,
      phase: 'stopped',
      step: null,
      live: null,
      queue: [],
      logs: appendLog(state.logs, 'Discussion stopped by user'),
    }),
    LLM: { abort: true },
    HTTP: { abort: 'decide' },
  },

  NEW_SESSION: (state) => ({ ...state, ...runState, topic: '', logs: [], followUpInput: '' }),

  // ---- the discussion ----
  PANEL_READY: (state, { value }, next) => {
    const panel = buildPanel(value, state.topic)
    next('NEXT_TURN')
    return { ...state, phase: 'deliberating', panel, logs: appendLog(state.logs, `Panel created with ${panel.experts.length} experts`) }
  },

  NEXT_TURN: {
    STATE: (state) => {
      const r = route(state)
      if (r === 'queue') return { ...state, queue: state.queue.slice(1) }
      if (r === 'synthesize') return { ...state, logs: appendLog(state.logs, 'Turn limit reached') }
      return {
        ...state,
        step: 'deciding',
        logs: appendLog(state.logs, r === 'decide' ? `Asking ${state.decisionModel} who speaks next` : 'Asking the moderator who speaks next'),
      }
    },
    EFFECT: (state, _, next, { previousState }) => {
      const r = route(previousState)
      if (r === 'queue') next('PICKED', { speakerId: previousState.queue[0], by: 'you' })
      if (r === 'synthesize') next('SYNTHESIZE')
    },
    HTTP: (state, data, next, { previousState }) => (route(previousState) === 'decide' ? decideRequest(state) : ABORT),
    LLM: (state, data, next, { previousState }) => (route(previousState) === 'moderator' ? moderatorPickRequest(state) : ABORT),
  },

  // the decision model's answer: who speaks next, and whether it is time to wrap up
  DECIDED: (state, { answers }, next) => {
    const { speakerId, probability, wrapUp } = readDecision(state, answers)
    const percent = Math.round(probability * 100)
    if (wrapUp) next('SYNTHESIZE')
    else next('PICKED', { speakerId, by: `${state.decisionModel} · ${percent}%` })
    return {
      ...state,
      logs: appendLog(state.logs, wrapUp
        ? `${state.decisionModel}: ready to wrap up (${Math.round(answers.wrapUp.noul * 100)}%)`
        : `${state.decisionModel} picked ${speakerName(state.panel, speakerId)} (${percent}%)`),
    }
  },

  // no decision model answer (not running, not installed): the moderator picks instead
  DECIDE_FAILED: {
    STATE: (state, { error }) => ({ ...state, logs: appendLog(state.logs, `Decision model failed (${error.message}); the moderator picks`) }),
    LLM: (state) => moderatorPickRequest(state),
  },

  MODERATOR_PICKED: (state, { value }, next) => {
    const wrapUp = value.wrapUp && state.turnCount >= state.turnFloor
    if (wrapUp) next('SYNTHESIZE')
    else next('PICKED', { speakerId: value.nextSpeakerId, by: 'moderator' })
    return { ...state, logs: appendLog(state.logs, wrapUp ? 'Moderator is wrapping up' : `Moderator picked ${speakerName(state.panel, value.nextSpeakerId)}`) }
  },

  PICKED: {
    STATE: (state, { speakerId, by }) => ({ ...state, step: 'handoff', nextSpeakerId: speakerId, pickedBy: by }),
    LLM: (state, { speakerId }) => handoffRequest(state, speakerId),
  },

  HANDED_OFF: (state, { value }, next) => {
    next('SPEAK', { speakerId: state.nextSpeakerId, prompt: value.promptToSpeaker })
    return {
      ...state,
      transcript: [...state.transcript, {
        kind: 'moderator',
        speakerId: state.panel.moderator.id,
        speakerName: state.panel.moderator.name,
        content: value.moderatorMessage,
        pickedBy: state.pickedBy,
      }],
    }
  },

  SPEAK: {
    STATE: (state, { speakerId }) => ({
      ...state,
      step: 'speaking',
      live: { kind: 'expert', speakerId, speakerName: speakerName(state.panel, speakerId), content: '', thinking: true },
    }),
    LLM: (state, turn) => turnRequest(state, turn),
  },

  // the reply so far, while a turn or the synthesis streams in
  LIVE: (state, { text }) => ({ ...state, live: { ...state.live, content: text, thinking: text === '' } }),

  SPOKE: (state, { text }, next) => {
    next('NEXT_TURN')
    return {
      ...state,
      live: null,
      turnCount: state.turnCount + 1,
      transcript: [...state.transcript, { ...state.live, content: text, thinking: false }],
      logs: appendLog(state.logs, `${state.live.speakerName} spoke (turn ${state.turnCount + 1})`),
    }
  },

  SYNTHESIZE: {
    STATE: (state) => ({
      ...state,
      step: 'synthesizing',
      live: {
        kind: 'synthesis',
        speakerId: state.panel.moderator.id,
        speakerName: `${state.panel.moderator.name} (${state.followUpQuestion ? 'Follow-up Synthesis' : 'Final Synthesis'})`,
        content: '',
        thinking: true,
      },
    }),
    LLM: (state) => synthesisRequest(state),
  },

  // the discussion is done: save it (a follow-up updates the same saved session), then title it
  SYNTHESIZED: {
    STATE: (state, { text }) => {
      const transcript = [...state.transcript, { ...state.live, content: text, thinking: false }]
      const sessionId = state.sessionId || newSessionId()
      const saved = state.sessions.find((s) => s.id === sessionId)
      const session = {
        id: sessionId,
        createdAt: saved?.createdAt || new Date().toISOString(),
        title: saved?.title || defaultSessionTitle(state.topic),
        topic: state.topic,
        panel: state.panel,
        transcript,
        turnCount: state.turnCount,
      }
      return {
        ...state,
        phase: 'completed',
        step: null,
        live: null,
        transcript,
        sessionId,
        followUpQuestion: null,
        sessions: [session, ...state.sessions.filter((s) => s.id !== sessionId)].slice(0, 100),
        logs: appendLog(state.logs, 'Discussion complete and saved'),
      }
    },
    LLM: (state, { text }, next, { previousState }) => (previousState.sessionId ? ABORT : titleRequest(state, text)),
  },

  TITLED: (state, { text }) => ({
    ...state,
    sessions: state.sessions.map((s) => (s.id === state.sessionId ? { ...s, title: cleanTitle(text, s.topic) } : s)),
    logs: appendLog(state.logs, `Session titled: ${cleanTitle(text, state.topic)}`),
  }),

  TITLE_FAILED: (state, { error }) => ({ ...state, logs: appendLog(state.logs, `Title generation failed (${error.message}); kept the default`) }),

  FOLLOW_UP: (state, { question }, next) => {
    if (state.phase !== 'completed' || !state.panel) return ABORT
    next('NEXT_TURN')
    return {
      ...state,
      ...followUpTurns(state),
      phase: 'deliberating',
      error: null,
      followUpQuestion: question,
      queue: requestedSpeakerIds(question, state.panel),
      transcript: [...state.transcript, { kind: 'user', speakerId: 'you', speakerName: 'You', content: question }],
      logs: appendLog(state.logs, 'Follow-up question sent to the panel'),
    }
  },

  LLM_FAILED: (state, { error, issues }) =>
    failed(state, issues ? `The model's answer did not match the expected shape (${issues[0].message}). Try again or pick a larger model.` : error.message),
}

export default RootComponent
