import {
  appendLog,
  appendTranscript,
  buildModeratorFollowUpRequest,
  buildModeratorTurnRequest,
  buildPanelistTurnRequest,
  buildSessionTitleRequest,
  defaultSessionTitle,
  isBusyPhase,
  panelMemberCountText,
  parseAnalysisEvent,
  parseModeratorFollowUpPlan,
  parseModeratorDecision,
  parsePanelistResponse,
  parseSessionTitle
} from './panelLogic.js'
import HeroSection from './components/HeroSection.jsx'
import SetupCard from './components/SetupCard.jsx'
import PanelRosterCard from './components/PanelRosterCard.jsx'
import TranscriptCard from './components/TranscriptCard.jsx'
import HistoryDrawer from './components/HistoryDrawer.jsx'
import DebugLogDrawer from './components/DebugLogDrawer.jsx'

const HISTORY_STORAGE_KEY = 'sygnal.aiPanel.sessions'

const INITIAL_STATE = {
  apiKey: '',
  model: 'gpt-5.2',
  topic: '',
  phase: 'idle',
  error: null,
  panel: null,
  transcript: [],
  logs: [],
  turnCount: 0,
  maxTurns: 8,
  pendingRequest: null,
  copyTranscriptSuccess: false,
  discussionStarted: false,
  activeRunId: null,
  runCounter: 0,
  historyOpen: false,
  debugOpen: false,
  savedSessions: [],
  pendingSaveSession: null,
  followUpInput: '',
  followUpQuestion: null,
  pendingFollowUpQueue: []
}

function statusLabel(state) {
  if (state.phase === 'idle') return 'Idle'
  if (state.phase === 'analyzing') return 'Assembling panel'
  if (state.phase === 'deliberating') {
    if (state.pendingRequest === 'moderator-step') return 'Coordinating the next turn'
    if (state.pendingRequest === 'panelist-turn') return 'Panelist is responding'
    return 'Panel is deliberating'
  }
  if (state.phase === 'completed') return 'Completed'
  if (state.phase === 'error') return 'Error'
  return state.phase
}

function speakerById(panel, id) {
  if (!panel) return null
  if (panel.moderator.id === id) return panel.moderator
  return panel.experts.find((expert) => expert.id === id) || null
}

function createSessionDraft(state, transcript) {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    topic: state.topic,
    panel: state.panel,
    transcript,
    logs: Array.isArray(state.logs) ? state.logs : [],
    turnCount: state.turnCount,
    title: defaultSessionTitle(state.topic)
  }
}

function RootComponent({ state }) {
  const busy = isBusyPhase(state.phase)
  const status = statusLabel(state)
  const memberCount = panelMemberCountText(state.panel)

  return (
    <main className="app-shell">
      <HistoryDrawer />
      <DebugLogDrawer />
      <HeroSection />

      <section className="top-grid">
        <SetupCard
          busy={busy}
          statusLabel={status}
          panelMemberCountText={memberCount}
        />
        <PanelRosterCard panel={state.panel} />
      </section>

      <TranscriptCard speakerById={speakerById} />
    </main>
  )
}

RootComponent.initialState = INITIAL_STATE

RootComponent.intent = ({ KINDO }) => ({
  REQUEST_SUCCESS: KINDO.select('success'),
  REQUEST_ERROR: KINDO.select('error')
})

RootComponent.model = {
  REQUEST_MODERATOR_TURN: {
    STATE: (state, payload) => ({
      ...state,
      phase: 'deliberating',
      pendingRequest: 'moderator-step',
      logs: appendLog(state.logs, payload?.forceEnd ? 'Requesting final moderator synthesis' : 'Requesting moderator turn planning')
    }),
    KINDO: (state, payload) => buildModeratorTurnRequest(state, {
      ...(payload || {}),
      runId: state.activeRunId
    })
  },

  REQUEST_PANELIST_TURN: {
    STATE: (state, payload) => ({
      ...state,
      phase: 'deliberating',
      pendingRequest: 'panelist-turn',
      logs: appendLog(state.logs, `Moderator selected ${payload?.speakerId || 'unknown'} for next turn`)
    }),
    KINDO: (state, payload) => buildPanelistTurnRequest(state, payload, {
      runId: state.activeRunId
    })
  },

  REQUEST_FOLLOW_UP_MODERATOR: {
    STATE: (state, payload) => ({
      ...state,
      phase: 'deliberating',
      pendingRequest: 'moderator-followup-plan',
      followUpQuestion: payload?.question || state.followUpQuestion || null,
      logs: appendLog(state.logs, 'Requesting moderator follow-up plan')
    }),
    KINDO: (state, payload) => buildModeratorFollowUpRequest(state, {
      question: payload?.question || state.followUpQuestion,
      requestedSpeakerIds: payload?.requestedSpeakerIds || [],
      runId: payload?.runId || state.activeRunId,
      forceEnd: payload?.forceEnd === true
    })
  },

  GENERATE_SESSION_TITLE: {
    STATE: (state) => ({
      ...state,
      logs: appendLog(state.logs, 'Generating AI session title for saved transcript')
    }),
    KINDO: (state, payload) => buildSessionTitleRequest(state, payload?.session || state.pendingSaveSession)
  },

  SAVE_SESSION_HISTORY: {
    STATE: (state, session) => {
      const current = Array.isArray(state.savedSessions) ? state.savedSessions : []
      const next = [session, ...current.filter((entry) => entry.id !== session.id)].slice(0, 100)
      return {
        ...state,
        savedSessions: next,
        logs: appendLog(state.logs, `Saved session: ${session.title}`)
      }
    },
    STORAGE: (state, session) => {
      const current = Array.isArray(state.savedSessions) ? state.savedSessions : []
      const next = [session, ...current.filter((entry) => entry.id !== session.id)].slice(0, 100)
      return {
        key: HISTORY_STORAGE_KEY,
        value: next
      }
    }
  },

  REQUEST_SUCCESS: (state, event, next) => {
    const kind = event?.request?.kind
    const runId = event?.request?.runId

    if (kind !== 'session-title') {
      if (state.activeRunId == null || runId !== state.activeRunId) {
        return state
      }
    }

    if (kind === 'analyze-topic') {
      try {
        const panel = parseAnalysisEvent(event, state.topic)
        next('REQUEST_MODERATOR_TURN', { forceEnd: false }, 0)

        return {
          ...state,
          phase: 'deliberating',
          panel,
          pendingRequest: null,
          error: null,
          logs: appendLog(state.logs, `Panel created with ${panel.experts.length} experts`)
        }
      } catch (error) {
        return {
          ...state,
          phase: 'error',
          pendingRequest: null,
          activeRunId: null,
          error: error.message,
          logs: appendLog(state.logs, `Analysis parse error: ${error.message}`)
        }
      }
    }

    if (kind === 'moderator-step') {
      try {
        const decision = parseModeratorDecision(event, state)
        const moderatorEntry = {
          speakerId: state.panel.moderator.id,
          speakerName: state.panel.moderator.name,
          content: decision.moderatorMessage || (decision.shouldEnd ? 'I will now summarize the panel discussion.' : 'I have selected the next speaker.')
        }

        const transcript = appendTranscript(state.transcript, moderatorEntry)

        if (decision.shouldEnd) {
          const finalEntry = {
            speakerId: state.panel.moderator.id,
            speakerName: `${state.panel.moderator.name} (Final Synthesis)`,
            content: decision.finalSummary
          }

          const completedTranscript = appendTranscript(transcript, finalEntry)
          const sessionDraft = createSessionDraft({ ...state, transcript: completedTranscript }, completedTranscript)
          next('GENERATE_SESSION_TITLE', { session: sessionDraft }, 0)

          return {
            ...state,
            phase: 'completed',
            pendingRequest: null,
            activeRunId: null,
            transcript: completedTranscript,
            pendingSaveSession: sessionDraft,
            followUpQuestion: null,
            pendingFollowUpQueue: [],
            error: null,
            logs: appendLog(state.logs, 'Moderator ended the discussion with a final synthesis')
          }
        }

        next('REQUEST_PANELIST_TURN', {
          speakerId: decision.nextSpeakerId,
          promptToSpeaker: decision.promptToSpeaker
        }, 0)

        return {
          ...state,
          phase: 'deliberating',
          pendingRequest: null,
          transcript,
          error: null,
          logs: appendLog(state.logs, `Moderator handed off to ${decision.nextSpeakerId}`)
        }
      } catch (error) {
        return {
          ...state,
          phase: 'error',
          pendingRequest: null,
          activeRunId: null,
          error: error.message,
          logs: appendLog(state.logs, `Moderator parse error: ${error.message}`)
        }
      }
    }

    if (kind === 'panelist-turn') {
      try {
        const answer = parsePanelistResponse(event)
        const transcript = appendTranscript(state.transcript, answer)
        const turnCount = state.turnCount + 1
        const forceEnd = turnCount >= state.maxTurns
        const followUpQueue = Array.isArray(state.pendingFollowUpQueue) ? state.pendingFollowUpQueue : []
        const followUpActive = !!state.followUpQuestion

        if (followUpActive) {
          if (forceEnd) {
            next('REQUEST_FOLLOW_UP_MODERATOR', {
              question: state.followUpQuestion,
              runId: state.activeRunId,
              forceEnd: true
            }, 0)
          } else if (followUpQueue.length > 0) {
            const [nextSpeaker, ...remaining] = followUpQueue
            next('REQUEST_PANELIST_TURN', nextSpeaker, 0)
            return {
              ...state,
              transcript,
              turnCount,
              pendingFollowUpQueue: remaining,
              pendingRequest: null,
              error: null,
              logs: appendLog(state.logs, `Received follow-up panelist turn ${turnCount}/${state.maxTurns}`)
            }
          } else {
            next('REQUEST_FOLLOW_UP_MODERATOR', {
              question: state.followUpQuestion,
              runId: state.activeRunId,
              requestedSpeakerIds: []
            }, 0)
          }
        } else {
          next('REQUEST_MODERATOR_TURN', { forceEnd }, 0)
        }

        return {
          ...state,
          transcript,
          turnCount,
          pendingRequest: null,
          error: null,
          logs: appendLog(state.logs, `Received panelist turn ${turnCount}/${state.maxTurns}`)
        }
      } catch (error) {
        return {
          ...state,
          phase: 'error',
          pendingRequest: null,
          activeRunId: null,
          error: error.message,
          logs: appendLog(state.logs, `Panelist response error: ${error.message}`)
        }
      }
    }

    if (kind === 'moderator-followup-plan') {
      try {
        const plan = parseModeratorFollowUpPlan(event, state)
        const moderatorEntry = {
          speakerId: state.panel.moderator.id,
          speakerName: state.panel.moderator.name,
          content: plan.moderatorMessage || 'I have a follow-up plan for the panel.'
        }

        const transcript = appendTranscript(state.transcript, moderatorEntry)

        if (plan.shouldEnd) {
          const finalEntry = {
            speakerId: state.panel.moderator.id,
            speakerName: `${state.panel.moderator.name} (Follow-up Synthesis)`,
            content: plan.finalSummary
          }

          const completedTranscript = appendTranscript(transcript, finalEntry)
          const sessionDraft = createSessionDraft({ ...state, transcript: completedTranscript }, completedTranscript)
          next('GENERATE_SESSION_TITLE', { session: sessionDraft }, 0)

          return {
            ...state,
            phase: 'completed',
            pendingRequest: null,
            activeRunId: null,
            transcript: completedTranscript,
            pendingSaveSession: sessionDraft,
            pendingFollowUpQueue: [],
            followUpQuestion: null,
            error: null,
            logs: appendLog(state.logs, 'Follow-up discussion completed')
          }
        }

        const [first, ...rest] = plan.queue
        next('REQUEST_PANELIST_TURN', first, 0)

        return {
          ...state,
          phase: 'deliberating',
          pendingRequest: null,
          transcript,
          pendingFollowUpQueue: rest,
          error: null,
          logs: appendLog(state.logs, `Moderator assigned follow-up to ${plan.queue.length} panelist(s)`)
        }
      } catch (error) {
        return {
          ...state,
          phase: 'error',
          pendingRequest: null,
          activeRunId: null,
          pendingFollowUpQueue: [],
          followUpQuestion: null,
          error: error.message,
          logs: appendLog(state.logs, `Follow-up moderator parse error: ${error.message}`)
        }
      }
    }

    if (kind === 'session-title') {
      const draft = state.pendingSaveSession
      if (!draft) return state

      const title = parseSessionTitle(event, draft.topic)
      next('SAVE_SESSION_HISTORY', { ...draft, title }, 0)

      return {
        ...state,
        pendingSaveSession: null,
        logs: appendLog(state.logs, `Session title generated: ${title}`)
      }
    }

    return state
  },

  REQUEST_ERROR: (state, event, next) => {
    const kind = event?.request?.kind || 'unknown-request'
    const error = event?.error || 'Unknown driver error'

    if (kind !== 'session-title') {
      const runId = event?.request?.runId
      if (state.activeRunId == null || runId !== state.activeRunId) {
        return state
      }
    }

    if (kind === 'session-title' && state.pendingSaveSession) {
      const fallbackTitle = defaultSessionTitle(state.pendingSaveSession.topic)
      next('SAVE_SESSION_HISTORY', { ...state.pendingSaveSession, title: fallbackTitle }, 0)

      return {
        ...state,
        pendingSaveSession: null,
        logs: appendLog(state.logs, `Session title generation failed, used fallback: ${fallbackTitle}`)
      }
    }

    return {
      ...state,
      phase: 'error',
      pendingRequest: null,
      activeRunId: null,
      error: `${kind}: ${error}`,
      logs: appendLog(state.logs, `Driver error on ${kind}: ${error}`)
    }
  }
}

export default RootComponent
