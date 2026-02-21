const ENDPOINT = 'https://llm.kindo.ai/v1/chat/completions'

const ANALYSIS_SYSTEM_PROMPT = [
  'You design virtual expert panels for discussions.',
  'Return strict JSON only (no markdown), with this shape:',
  '{',
  '  "topicSummary": string,',
  '  "moderator": {"name": string, "role": string, "expertise": string, "goal": string, "styleGuidelines": string[]},',
  '  "experts": [',
  '    {"name": string, "role": string, "expertise": string, "goal": string, "styleGuidelines": string[]}',
  '  ]',
  '}',
  'Rules:',
  '- Create exactly 3 to 5 experts.',
  '- Pick experts that are directly relevant to the topic.',
  '- Keep names realistic but fictional.',
  '- styleGuidelines should be concrete speaking constraints.'
].join('\n')

const SESSION_TITLE_SYSTEM_PROMPT = [
  'You generate concise titles for saved discussion transcripts.',
  'Return title text only.',
  'No quotes, no markdown, no punctuation at the end.',
  'Keep it under 7 words.'
].join('\n')

function toId(value, fallback) {
  if (!value || typeof value !== 'string') return fallback
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return normalized || fallback
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function isBusyPhase(phase) {
  return phase === 'analyzing' || phase === 'deliberating'
}

export function validateInputs(state) {
  if (!state.apiKey?.trim()) return 'API key is required.'
  if (!state.model?.trim()) return 'Model name is required.'
  if (!state.topic?.trim()) return 'Topic is required.'
  return null
}

function extractAssistantText(response) {
  const message = response?.choices?.[0]?.message
  if (!message) return ''

  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry.text === 'string') return entry.text
        return ''
      })
      .join('\n')
  }
  return ''
}

function parseJsonFromText(text) {
  if (!text || typeof text !== 'string') return null

  try {
    return JSON.parse(text)
  } catch (_error) {
    // Fall through.
  }

  const block = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/)
  if (block?.[1]) {
    try {
      return JSON.parse(block[1])
    } catch (_error) {
      // Fall through.
    }
  }

  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch (_error) {
      return null
    }
  }

  return null
}

function normalizePanel(rawPanel, topic) {
  const moderatorSource = rawPanel?.moderator || {}
  const expertsSource = Array.isArray(rawPanel?.experts) ? rawPanel.experts : []
  const expertsTrimmed = expertsSource.slice(0, 5)

  if (expertsTrimmed.length < 3) {
    throw new Error('Panel analysis did not return enough experts (minimum is 3).')
  }

  const moderator = {
    id: toId(moderatorSource.name || 'Moderator', 'moderator'),
    name: moderatorSource.name || 'Moderator',
    role: moderatorSource.role || 'Moderator',
    expertise: moderatorSource.expertise || 'Discussion leadership',
    goal: moderatorSource.goal || `Guide the panel toward a practical answer for: ${topic}`,
    styleGuidelines: Array.isArray(moderatorSource.styleGuidelines)
      ? moderatorSource.styleGuidelines
      : ['Be neutral.', 'Keep speakers concise.', 'Focus on synthesis and tradeoffs.']
  }

  const experts = expertsTrimmed.map((member, index) => ({
    id: toId(member?.name || `Expert ${index + 1}`, `expert-${index + 1}`),
    name: member?.name || `Expert ${index + 1}`,
    role: member?.role || 'Expert',
    expertise: member?.expertise || 'General domain knowledge',
    goal: member?.goal || `Offer practical insight on: ${topic}`,
    styleGuidelines: Array.isArray(member?.styleGuidelines)
      ? member.styleGuidelines
      : ['Be specific.', 'Acknowledge uncertainty.', 'Give actionable advice.']
  }))

  return {
    topicSummary: rawPanel?.topicSummary || topic,
    moderator,
    experts
  }
}

function buildModeratorSystemPrompt(moderator, experts, topic) {
  const expertRoster = experts
    .map((expert) => `${expert.id}: ${expert.name} (${expert.role}; ${expert.expertise})`)
    .join('\n')

  return [
    `You are ${moderator.name}, the moderator of a virtual expert panel.`,
    `Topic: ${topic}`,
    `Your role: ${moderator.role}`,
    `Your expertise: ${moderator.expertise}`,
    `Your goal: ${moderator.goal}`,
    'Style constraints:',
    ...moderator.styleGuidelines.map((rule) => `- ${rule}`),
    'You must choose which expert speaks next and keep the conversation structured.',
    'You are the only one allowed to decide speaking order.',
    'Expert roster with IDs:',
    expertRoster
  ].join('\n')
}

function buildExpertSystemPrompt(expert, topic) {
  return [
    `You are ${expert.name}.`,
    `Role: ${expert.role}`,
    `Expertise: ${expert.expertise}`,
    `Topic: ${topic}`,
    `Goal: ${expert.goal}`,
    'Style constraints:',
    ...expert.styleGuidelines.map((rule) => `- ${rule}`),
    'Respond as this persona only. Do not break character.',
    'Provide concrete reasoning and practical recommendations.'
  ].join('\n')
}

function attachSystemPrompts(panel, topic) {
  const experts = panel.experts.map((expert) => ({
    ...expert,
    systemPrompt: buildExpertSystemPrompt(expert, topic)
  }))

  const moderator = {
    ...panel.moderator,
    systemPrompt: buildModeratorSystemPrompt(panel.moderator, experts, topic)
  }

  return {
    ...panel,
    moderator,
    experts
  }
}

function formatTranscript(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return 'No discussion has happened yet.'
  }

  return transcript
    .slice(-14)
    .map((entry, index) => `${index + 1}. [${entry.speakerName}] ${entry.content}`)
    .join('\n')
}

export function buildAnalyzeRequest(state, options = {}) {
  const runId = options.runId || state.activeRunId || null
  return {
    requestId: uid('analyze'),
    kind: 'analyze-topic',
    runId,
    endpoint: ENDPOINT,
    apiKey: state.apiKey,
    body: {
      model: state.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: `Topic to analyze:\n${state.topic.trim()}` }
      ]
    }
  }
}

export function parseAnalysisEvent(event, topic) {
  const text = extractAssistantText(event?.response)
  const parsed = parseJsonFromText(text)
  if (!parsed) {
    throw new Error('Could not parse topic analysis response as JSON.')
  }
  const normalized = normalizePanel(parsed, topic)
  return attachSystemPrompts(normalized, topic)
}

function buildModeratorUserPrompt(state, options = {}) {
  const speakerIds = state.panel.experts.map((expert) => expert.id)
  const forceEnd = options.forceEnd === true

  return [
    `Topic: ${state.topic}`,
    `Topic summary: ${state.panel.topicSummary}`,
    `Completed expert turns: ${state.turnCount} / ${state.maxTurns}`,
    forceEnd
      ? 'You must end now with a final synthesis. Set shouldEnd=true.'
      : 'Pick exactly one next expert speaker.',
    'Return strict JSON only with this shape:',
    '{',
    '  "shouldEnd": boolean,',
    '  "moderatorMessage": string,',
    '  "nextSpeakerId": string|null,',
    '  "promptToSpeaker": string|null,',
    '  "finalSummary": string|null',
    '}',
    'Rules:',
    '- nextSpeakerId must be one of these IDs when shouldEnd=false:',
    `  ${speakerIds.join(', ')}`,
    '- When shouldEnd=true, finalSummary must be non-empty and nextSpeakerId/promptToSpeaker must be null.',
    '- moderatorMessage should be concise and explain who speaks next or why the discussion is ending.',
    'Current transcript:',
    formatTranscript(state.transcript)
  ].join('\n')
}

function buildFollowUpModeratorUserPrompt(state, options = {}) {
  const forceEnd = options.forceEnd === true
  const question = String(options.question || state.followUpQuestion || '').trim()
  const requestedIds = Array.isArray(options.requestedSpeakerIds) ? options.requestedSpeakerIds : []
  const speakerIds = state.panel.experts.map((expert) => expert.id)
  const remainingTurns = Math.max(0, (state.maxTurns || 0) - (state.turnCount || 0))

  return [
    `Topic: ${state.topic}`,
    `Follow-up question: ${question}`,
    `Topic summary: ${state.panel.topicSummary}`,
    `Remaining expert turns allowed: ${remainingTurns}`,
    requestedIds.length > 0
      ? `User requested these speakers: ${requestedIds.join(', ')}`
      : 'No specific speaker requested by user; choose speakers yourself.',
    forceEnd
      ? 'You must end now with finalSummary and shouldEnd=true.'
      : 'Choose as few or as many speakers as needed for this follow-up, up to the remaining turn limit.',
    'Return strict JSON only with this shape:',
    '{',
    '  "shouldEnd": boolean,',
    '  "moderatorMessage": string,',
    '  "selectedSpeakerIds": string[]|null,',
    '  "promptToAll": string|null,',
    '  "promptsBySpeaker": [{"speakerId": string, "prompt": string}]|null,',
    '  "finalSummary": string|null',
    '}',
    'Rules:',
    '- selectedSpeakerIds entries must be expert IDs only from this list:',
    `  ${speakerIds.join(', ')}`,
    '- Number of selectedSpeakerIds must be <= remaining turn limit.',
    '- If shouldEnd=true, finalSummary must be non-empty and selectedSpeakerIds can be null or empty.',
    '- If shouldEnd=false, selectedSpeakerIds must contain at least one speaker.',
    '- Use promptToAll for shared guidance, and/or promptsBySpeaker for per-speaker instructions.',
    'Current transcript:',
    formatTranscript(state.transcript)
  ].join('\n')
}

export function buildModeratorTurnRequest(state, options = {}) {
  const moderator = state.panel.moderator
  const runId = options.runId || state.activeRunId || null

  return {
    requestId: uid('moderator'),
    kind: 'moderator-step',
    runId,
    endpoint: ENDPOINT,
    apiKey: state.apiKey,
    body: {
      model: state.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: moderator.systemPrompt },
        { role: 'user', content: buildModeratorUserPrompt(state, options) }
      ]
    }
  }
}

export function buildModeratorFollowUpRequest(state, options = {}) {
  const moderator = state.panel.moderator
  const runId = options.runId || state.activeRunId || null

  return {
    requestId: uid('moderator-followup'),
    kind: 'moderator-followup-plan',
    runId,
    endpoint: ENDPOINT,
    apiKey: state.apiKey,
    body: {
      model: state.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: moderator.systemPrompt },
        { role: 'user', content: buildFollowUpModeratorUserPrompt(state, options) }
      ]
    }
  }
}

export function parseModeratorDecision(event, state) {
  const text = extractAssistantText(event?.response)
  const parsed = parseJsonFromText(text)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Could not parse moderator decision JSON.')
  }

  const decision = {
    shouldEnd: parsed.shouldEnd === true,
    moderatorMessage: typeof parsed.moderatorMessage === 'string' ? parsed.moderatorMessage.trim() : '',
    nextSpeakerId: typeof parsed.nextSpeakerId === 'string' ? parsed.nextSpeakerId.trim() : null,
    promptToSpeaker: typeof parsed.promptToSpeaker === 'string' ? parsed.promptToSpeaker.trim() : null,
    finalSummary: typeof parsed.finalSummary === 'string' ? parsed.finalSummary.trim() : null
  }

  if (!decision.shouldEnd) {
    const hasExpert = state.panel.experts.some((expert) => expert.id === decision.nextSpeakerId)
    if (!hasExpert) {
      throw new Error('Moderator selected an unknown next speaker ID.')
    }
    if (!decision.promptToSpeaker) {
      throw new Error('Moderator response is missing promptToSpeaker.')
    }
  }

  if (decision.shouldEnd && !decision.finalSummary) {
    throw new Error('Moderator ended discussion without finalSummary.')
  }

  return decision
}

export function buildPanelistTurnRequest(state, payload, options = {}) {
  const speaker = state.panel.experts.find((expert) => expert.id === payload.speakerId)
  if (!speaker) {
    throw new Error(`Unknown speaker ID: ${payload.speakerId}`)
  }
  const runId = options.runId || state.activeRunId || null

  const userPrompt = [
    `Topic: ${state.topic}`,
    `Moderator instruction for you: ${payload.promptToSpeaker}`,
    'Current transcript for context:',
    formatTranscript(state.transcript),
    'Respond in 1-2 concise paragraphs, with concrete reasoning and at least one practical recommendation.'
  ].join('\n')

  return {
    requestId: uid('panelist'),
    kind: 'panelist-turn',
    runId,
    endpoint: ENDPOINT,
    apiKey: state.apiKey,
    meta: {
      speakerId: speaker.id,
      speakerName: speaker.name
    },
    body: {
      model: state.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: speaker.systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }
  }
}

export function parsePanelistResponse(event) {
  const content = extractAssistantText(event?.response).trim()
  if (!content) {
    throw new Error('Panelist response was empty.')
  }

  return {
    speakerId: event?.request?.meta?.speakerId || 'unknown',
    speakerName: event?.request?.meta?.speakerName || 'Panelist',
    content
  }
}

export function extractRequestedSpeakerIds(question, panel) {
  const text = String(question || '').toLowerCase()
  if (!panel || !text) return []

  const matches = panel.experts
    .filter((expert) => {
      const name = String(expert.name || '').toLowerCase()
      return name && text.includes(name)
    })
    .map((expert) => expert.id)

  return Array.from(new Set(matches))
}

export function parseModeratorFollowUpPlan(event, state) {
  const text = extractAssistantText(event?.response)
  const parsed = parseJsonFromText(text)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Could not parse follow-up moderator plan JSON.')
  }

  const remainingTurns = Math.max(0, (state.maxTurns || 0) - (state.turnCount || 0))
  const expertIds = state.panel.experts.map((expert) => expert.id)
  const shouldEnd = parsed.shouldEnd === true
  const moderatorMessage = typeof parsed.moderatorMessage === 'string' ? parsed.moderatorMessage.trim() : ''
  const selectedSpeakerIds = Array.isArray(parsed.selectedSpeakerIds) ? parsed.selectedSpeakerIds.filter((id) => typeof id === 'string') : []
  const promptToAll = typeof parsed.promptToAll === 'string' ? parsed.promptToAll.trim() : null
  const promptsBySpeaker = Array.isArray(parsed.promptsBySpeaker) ? parsed.promptsBySpeaker : []
  const finalSummary = typeof parsed.finalSummary === 'string' ? parsed.finalSummary.trim() : null

  if (shouldEnd) {
    if (!finalSummary) throw new Error('Follow-up ended without finalSummary.')
    return {
      shouldEnd: true,
      moderatorMessage,
      finalSummary,
      queue: []
    }
  }

  const normalizedIds = selectedSpeakerIds.filter((id) => expertIds.includes(id))
  if (normalizedIds.length === 0) {
    throw new Error('Follow-up plan missing selectedSpeakerIds.')
  }

  const cappedIds = normalizedIds.slice(0, remainingTurns)
  if (cappedIds.length === 0) {
    throw new Error('Follow-up plan selected no speakers within remaining turn limit.')
  }
  const bySpeakerMap = promptsBySpeaker.reduce((acc, item) => {
    if (item && typeof item.speakerId === 'string' && typeof item.prompt === 'string') {
      acc[item.speakerId] = item.prompt.trim()
    }
    return acc
  }, {})

  const queue = cappedIds.map((speakerId) => ({
    speakerId,
    promptToSpeaker: bySpeakerMap[speakerId] || promptToAll || 'Address the follow-up question directly with practical detail.'
  }))

  return {
    shouldEnd: false,
    moderatorMessage,
    finalSummary: null,
    queue
  }
}

export function defaultSessionTitle(topic) {
  const cleaned = String(topic || '').trim()
  if (!cleaned) return 'Untitled Discussion'
  const words = cleaned
    .replace(/[^\w\s-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
  return words.length ? words.join(' ') : 'Untitled Discussion'
}

export function buildSessionTitleRequest(state, sessionDraft) {
  const topic = sessionDraft?.topic || state.topic || ''
  const summaryEntry = Array.isArray(sessionDraft?.transcript) ? sessionDraft.transcript.slice(-1)[0] : null
  const summaryText = summaryEntry?.content || ''

  return {
    requestId: uid('session-title'),
    kind: 'session-title',
    runId: null,
    endpoint: ENDPOINT,
    apiKey: state.apiKey,
    meta: {
      sessionId: sessionDraft?.id || null
    },
    body: {
      model: state.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SESSION_TITLE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Topic: ${topic}`,
            `Final summary excerpt: ${summaryText.slice(0, 500)}`,
            'Generate a compact session title.'
          ].join('\n')
        }
      ]
    }
  }
}

export function parseSessionTitle(event, topic) {
  const text = extractAssistantText(event?.response)
  const firstLine = String(text || '')
    .split('\n')[0]
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/[.?!]+$/, '')
    .trim()

  if (!firstLine) return defaultSessionTitle(topic)
  const words = firstLine.split(/\s+/).filter(Boolean).slice(0, 7)
  if (words.length === 0) return defaultSessionTitle(topic)
  return words.join(' ')
}

export function appendLog(logs, message) {
  const next = Array.isArray(logs) ? logs.slice() : []
  next.unshift(`[${new Date().toLocaleTimeString()}] ${message}`)
  return next.slice(0, 40)
}

export function appendTranscript(transcript, entry) {
  const next = Array.isArray(transcript) ? transcript.slice() : []
  next.push(entry)
  return next
}

export function panelMemberCountText(panel) {
  if (!panel) return '0 members'
  return `${1 + panel.experts.length} members`
}
