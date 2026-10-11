// The panel's prompts, schemas and requests. Pure functions of the state: the model entries in
// RootComponent.jsx send what these build to the LLM (chat) and HTTP (decision model) sinks.
import { decide, choice, noul, jsonSchema } from 'sygnal/ai'
import { OLLAMA_URL } from './config.js'

const EXPERT_TURNS = 8      // a discussion's expert turns
const MIN_TURNS = 3         // ... the decision model can't end it sooner
const FOLLOW_UP_TURNS = 3   // the expert turns a follow-up question adds
const WRAP_UP_AT = 0.6      // the decision model's "ready to wrap up" probability that ends a discussion

// ---- state helpers --------------------------------------------------------------------------

export const runState = {
  phase: 'idle',             // 'idle' | 'assembling' | 'deliberating' | 'completed' | 'stopped' | 'error'
  step: null,                // while deliberating: 'deciding' | 'handoff' | 'speaking' | 'synthesizing'
  error: null,
  panel: null,
  transcript: [],
  live: null,                // the entry that is streaming in: { kind, speakerId, speakerName, content, thinking }
  turnCount: 0,
  turnFloor: MIN_TURNS,      // the discussion may end from this turn on
  turnLimit: EXPERT_TURNS,   // ... and it ends at this one
  nextSpeakerId: null,
  pickedBy: null,           // who picked the next speaker: the decision model, the moderator, or 'you'
  queue: [],                 // speakers a follow-up asked for by name, before the moderator picks
  followUpQuestion: null,
  sessionId: null,
}

export function validateSetup(state) {
  if (!state.chatModel) return 'Pick a chat model (is Ollama running?).'
  if (!state.topic.trim()) return 'Topic is required.'
  return null
}

export function appendLog(logs, message) {
  return [`[${new Date().toLocaleTimeString()}] ${message}`, ...logs].slice(0, 60)
}

export function speakerName(panel, id) {
  if (!panel) return id
  if (panel.moderator.id === id) return panel.moderator.name
  return panel.experts.find((expert) => expert.id === id)?.name || id
}

export function newSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function defaultSessionTitle(topic) {
  const words = String(topic || '').replace(/[^\w\s-]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6)
  return words.length ? words.join(' ') : 'Untitled Discussion'
}

export function cleanTitle(text, topic) {
  const line = String(text || '').trim().split('\n')[0].replace(/^["'\s#*]+|["'\s*]+$/g, '').replace(/[.?!]+$/, '')
  const words = line.split(/\s+/).filter(Boolean).slice(0, 7)
  return words.length ? words.join(' ') : defaultSessionTitle(topic)
}

/** the speakers named in a follow-up question ("What does Dr. Lee think?") */
export function requestedSpeakerIds(question, panel) {
  const text = question.toLowerCase()
  return panel.experts.filter((expert) => text.includes(expert.name.toLowerCase())).map((expert) => expert.id)
}

/** a follow-up: a few more turns on the same panel, in the same saved session */
export function followUpTurns(state) {
  return { turnFloor: state.turnCount + 1, turnLimit: state.turnCount + FOLLOW_UP_TURNS }
}

/** the installed Ollama models (GET /api/tags) that can chat, and those that answer decisions */
export function chatModels(tags) {
  return (tags?.models || []).filter((m) => !m.capabilities || m.capabilities.includes('completion'))
}

export function decisionModels(tags) {
  return (tags?.models || []).filter((m) => m.capabilities?.includes('decision'))
}

// ---- the panel ------------------------------------------------------------------------------

const member = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    role: { type: 'string' },
    expertise: { type: 'string' },
    goal: { type: 'string' },
    styleGuidelines: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'role', 'expertise', 'goal', 'styleGuidelines'],
}

const PanelDesign = jsonSchema({
  type: 'object',
  properties: {
    topicSummary: { type: 'string' },
    moderator: member,
    experts: { type: 'array', items: member, minItems: 3 },
  },
  required: ['topicSummary', 'moderator', 'experts'],
})

const ANALYSIS_INSTRUCTIONS = [
  'You design virtual expert panels for discussions.',
  'Create one moderator and 3 to 5 experts who are directly relevant to the topic and disagree in useful ways.',
  'Keep names realistic but fictional. styleGuidelines are concrete speaking constraints.',
].join('\n')

export function analyzeRequest(state) {
  return {
    model: state.chatModel,
    instructions: ANALYSIS_INSTRUCTIONS,
    messages: [{ role: 'user', content: `Topic to analyze:\n${state.topic.trim()}` }],
    output: PanelDesign,
    key: 'panel',
    ok: 'PANEL_READY',
    error: 'LLM_FAILED',
  }
}

const toId = (name, fallback) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || fallback

/** the validated design → the panel, each member with an id and a system prompt */
export function buildPanel(design, topic) {
  const experts = design.experts.slice(0, 5).map((expert, index) => ({ ...expert, id: toId(expert.name, `expert-${index + 1}`) }))
  const moderator = { ...design.moderator, id: toId(design.moderator.name, 'moderator') }
  const roster = experts.map((e) => `- ${e.name} (${e.role}; ${e.expertise})`).join('\n')
  const persona = (m) => [
    `You are ${m.name}. Role: ${m.role}. Expertise: ${m.expertise}.`,
    `Topic: ${topic}`,
    `Goal: ${m.goal}`,
    'Style constraints:',
    ...m.styleGuidelines.map((rule) => `- ${rule}`),
  ]
  return {
    topicSummary: design.topicSummary || topic,
    moderator: {
      ...moderator,
      systemPrompt: [...persona(moderator), 'You moderate a virtual expert panel and keep it structured.', 'The panelists:', roster].join('\n'),
    },
    experts: experts.map((expert) => ({
      ...expert,
      systemPrompt: [...persona(expert), 'Respond as this persona only. Give concrete reasoning and practical recommendations.'].join('\n'),
    })),
  }
}

function formatTranscript(transcript) {
  if (transcript.length === 0) return 'No discussion has happened yet.'
  return transcript.slice(-14).map((entry) => `[${entry.speakerName}] ${entry.content}`).join('\n\n')
}

function context(state) {
  return [
    `Topic: ${state.topic}`,
    `Topic summary: ${state.panel.topicSummary}`,
    state.followUpQuestion && `The audience asked a follow-up question: ${state.followUpQuestion}`,
    'Transcript so far:',
    formatTranscript(state.transcript),
  ].filter(Boolean).join('\n')
}

// ---- who speaks next: the decision model ----------------------------------------------------

/** the decision model's questions for this panel (exported for the tests' answers()) */
export function turnQuestions(panel) {
  return {
    next: choice(
      'Which panelist should speak next to move the discussion forward? Prefer the expertise the discussion needs now, someone who has not spoken yet, and never the person who just spoke.',
      Object.fromEntries(panel.experts.map((e) => [e.id, `${e.name}, ${e.role}: ${e.expertise}`])),
    ),
    wrapUp: noul('Has the panel covered the topic (and the follow-up question, if there is one) well enough for the moderator to close with a synthesis?', {
      true: 'The main viewpoints have been heard and challenged; more turns would repeat them',
      false: 'Important viewpoints, disagreements or the follow-up question are still unexplored',
    }),
  }
}

export function decideRequest(state) {
  const last = state.transcript.findLast((entry) => entry.kind === 'expert')
  return decide({
    url: `${OLLAMA_URL}/v1/systemone`,
    model: state.decisionModel,
    state: {
      topic: state.topic,
      followUpQuestion: state.followUpQuestion,
      lastSpeaker: last ? last.speakerId : null,
      turnsTaken: state.turnCount,
      transcript: formatTranscript(state.transcript),
    },
    questions: turnQuestions(state.panel),
    key: 'decide',
    latest: true,
    ok: 'DECIDED',
    error: 'DECIDE_FAILED',
  })
}

/** the decision's answers → { speakerId, probability, wrapUp }; never the speaker who just spoke */
export function readDecision(state, answers) {
  const last = state.transcript.findLast((entry) => entry.kind === 'expert')?.speakerId
  const [speakerId, probability] = Object.entries(answers.next.probabilities)
    .filter(([id]) => id !== last || state.panel.experts.length === 1)
    .sort((a, b) => b[1] - a[1])[0]
  return { speakerId, probability, wrapUp: answers.wrapUp.noul >= WRAP_UP_AT && state.turnCount >= state.turnFloor }
}

// ---- who speaks next without a decision model: the moderator picks --------------------------

export function moderatorPickRequest(state) {
  const ids = state.panel.experts.map((e) => e.id)
  return {
    model: state.chatModel,
    instructions: state.panel.moderator.systemPrompt,
    messages: [{
      role: 'user',
      content: [
        context(state),
        `Completed expert turns: ${state.turnCount}. Pick the next speaker by id (${ids.join(', ')}), never the one who just spoke.`,
        state.turnCount >= state.turnFloor ? 'Set wrapUp to true if the discussion is ready for your closing synthesis.' : 'Set wrapUp to false: it is too early to close.',
      ].join('\n\n'),
    }],
    output: jsonSchema({
      type: 'object',
      properties: { nextSpeakerId: { type: 'string', enum: ids }, wrapUp: { type: 'boolean' } },
      required: ['nextSpeakerId', 'wrapUp'],
    }),
    key: 'moderator',
    ok: 'MODERATOR_PICKED',
    error: 'LLM_FAILED',
  }
}

// ---- the turns ------------------------------------------------------------------------------

const Handoff = jsonSchema({
  type: 'object',
  properties: {
    moderatorMessage: { type: 'string', description: 'One or two sentences to the audience: why this panelist speaks now' },
    promptToSpeaker: { type: 'string', description: 'The question or instruction for the panelist' },
  },
  required: ['moderatorMessage', 'promptToSpeaker'],
})

export function handoffRequest(state, speakerId) {
  return {
    model: state.chatModel,
    instructions: state.panel.moderator.systemPrompt,
    messages: [{ role: 'user', content: `${context(state)}\n\nYou give the floor to ${speakerName(state.panel, speakerId)} next. Introduce the handoff and write their prompt.` }],
    output: Handoff,
    key: 'moderator',
    ok: 'HANDED_OFF',
    error: 'LLM_FAILED',
  }
}

export function turnRequest(state, { speakerId, prompt }) {
  const speaker = state.panel.experts.find((expert) => expert.id === speakerId)
  return {
    model: state.chatModel,
    instructions: speaker.systemPrompt,
    messages: [{
      role: 'user',
      content: `${context(state)}\n\nThe moderator asks you: ${prompt}\n\nRespond in 1-2 concise paragraphs, with concrete reasoning and at least one practical recommendation.`,
    }],
    key: 'turn',
    delta: 'LIVE',
    ok: 'SPOKE',
    error: 'LLM_FAILED',
  }
}

export function synthesisRequest(state) {
  return {
    model: state.chatModel,
    instructions: state.panel.moderator.systemPrompt,
    messages: [{
      role: 'user',
      content: `${context(state)}\n\nClose the discussion with a final synthesis${state.followUpQuestion ? ' that answers the follow-up question' : ''}: the points of agreement, the open disagreements, and practical recommendations. Use short paragraphs or a bulleted list.`,
    }],
    key: 'turn',
    delta: 'LIVE',
    ok: 'SYNTHESIZED',
    error: 'LLM_FAILED',
  }
}

export function titleRequest(state, synthesis) {
  return {
    model: state.chatModel,
    instructions: 'You write concise titles for saved discussion transcripts. Answer with the title only: under 7 words, no quotes, no markdown, no final punctuation.',
    messages: [{ role: 'user', content: `Topic: ${state.topic}\nFinal summary excerpt: ${synthesis.slice(0, 500)}` }],
    key: 'title',
    ok: 'TITLED',
    error: 'TITLE_FAILED',
  }
}

// ---- the transcript as markdown -------------------------------------------------------------

export function toMarkdown(state) {
  const lines = ['# Virtual Panel Transcript', '', '## Topic', state.topic || 'Untitled topic', '']
  if (state.panel) {
    lines.push('## Panelists', `- **Moderator:** ${state.panel.moderator.name} (${state.panel.moderator.role})`)
    state.panel.experts.forEach((expert) => lines.push(`- **Expert:** ${expert.name} (${expert.role})`))
    lines.push('')
  }
  lines.push('## Transcript')
  if (state.transcript.length === 0) return [...lines, '_No discussion turns yet._'].join('\n')
  state.transcript.forEach((entry, index) => {
    lines.push(`${index + 1}. **${entry.speakerName}**`, entry.content.split('\n').map((line) => `   ${line}`).join('\n'), '')
  })
  return lines.join('\n')
}
