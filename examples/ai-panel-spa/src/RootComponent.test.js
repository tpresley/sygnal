import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { answers } from 'sygnal/ai'
import RootComponent from './RootComponent.jsx'
import { buildPanel, turnQuestions } from './panel.js'

// GET /api/tags: two chat models, a decision model and an embedding model
const TAGS = {
  models: [
    { name: 'qwen3:8b', details: { parameter_size: '8.2B' }, capabilities: ['completion', 'tools', 'thinking'] },
    { name: 'llama3.2:latest', details: { parameter_size: '3.2B' }, capabilities: ['completion', 'tools'] },
    { name: 'nimble:latest', details: { parameter_size: '9.0B' }, capabilities: ['decision'] },
    { name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
  ],
}

const member = (name, role) => ({ name, role, expertise: `${role} things`, goal: 'Be useful', styleGuidelines: ['Be brief.'] })

// the analysis reply (structured output)
const DESIGN = {
  topicSummary: 'Indentation wars',
  moderator: member('Mo Derator', 'Moderator'),
  experts: [member('Ada Tabs', 'Compiler engineer'), member('Sam Spaces', 'Style guide author'), member('Lin Linter', 'Tooling lead')],
}
const QUESTIONS = turnQuestions(buildPanel(DESIGN, 'Tabs or spaces?'))
const handoff = { moderatorMessage: 'Over to you.', promptToSpeaker: 'Your view?' }

let t
afterEach(() => t?.dispose())

async function startDiscussion(options) {
  t = renderComponent(RootComponent, { strict: true, ...options })
  await t.respond('HTTP', TAGS, 'models')
  t.simulateEvent('.topic-input', 'input', { value: 'Tabs or spaces?' })
  t.simulateEvent('.start-run', 'click')
  await t.respond('LLM', DESIGN, 'panel')
}

// the decision model picks a speaker, the moderator hands off, the speaker streams a reply
async function turn(speakerId, text) {
  await t.respond('HTTP', answers(QUESTIONS, { next: speakerId, wrapUp: false }), 'decide')
  await t.respond('LLM', handoff, 'moderator')
  await t.stream('LLM', [`${text} `, 'indeed.'], 'turn')
}

describe('RootComponent', () => {
  it('lists the installed models and picks the first chat and decision models', async () => {
    t = renderComponent(RootComponent, { strict: true })
    await t.respond('HTTP', TAGS, 'models')
    expect(t.state.chatModel).toBe('qwen3:8b')
    expect(t.state.decisionModel).toBe('nimble:latest')
    const html = t.html()
    expect(html).toContain('llama3.2:latest (3.2B)')
    expect(html).toContain('nimble:latest (decision model)')
    expect(html).not.toContain('nomic-embed-text')

    t.simulateEvent('.chat-model', 'change', { value: 'llama3.2:latest' })
    await t.next((s) => s.chatModel === 'llama3.2:latest')
    t.expectNoDiagnostics()
  })

  it('says so when Ollama is not running', async () => {
    t = renderComponent(RootComponent, { strict: true })
    await t.fail('HTTP', new TypeError('Failed to fetch'), 'models')
    expect(t.html()).toContain("Can't reach Ollama")
    t.simulateEvent('.refresh-models', 'click')
    await t.respond('HTTP', TAGS, 'models')
    expect(t.state.chatModel).toBe('qwen3:8b')
  })

  it('runs a discussion with the decision model choosing speakers, saves and titles it', async () => {
    await startDiscussion()
    expect(t.state.panel.experts.map((e) => e.id)).toEqual(['ada-tabs', 'sam-spaces', 'lin-linter'])
    expect(t.requests('LLM')[0].model).toBe('qwen3:8b')

    await turn('ada-tabs', 'Tabs')
    expect(t.requests('HTTP').find((r) => r.key === 'decide').json.model).toBe('nimble:latest')
    await turn('sam-spaces', 'Spaces')
    await turn('lin-linter', 'Whatever the linter says')
    expect(t.state.turnCount).toBe(3)
    expect(t.html()).toContain('next speaker picked by nimble:latest')

    // enough turns: the decision model wraps up, the moderator streams the synthesis
    await t.respond('HTTP', answers(QUESTIONS, { wrapUp: true }), 'decide')
    await t.stream('LLM', ['Use a formatter.'], 'turn')
    expect(t.state.phase).toBe('completed')
    expect(t.state.transcript.at(-1)).toMatchObject({ kind: 'synthesis', content: 'Use a formatter.' })
    expect(t.state.sessions).toHaveLength(1)

    await t.respond('LLM', '"Tabs Versus Spaces."', 'title')
    expect(t.state.sessions[0].title).toBe('Tabs Versus Spaces')
    t.expectNoDiagnostics()
  })

  it('never lets the same panelist speak twice in a row', async () => {
    await startDiscussion()
    await turn('ada-tabs', 'Tabs')
    await t.respond('HTTP', answers(QUESTIONS, { next: { probabilities: { 'ada-tabs': 0.7, 'sam-spaces': 0.2, 'lin-linter': 0.1 } } }), 'decide')
    expect(t.state.nextSpeakerId).toBe('sam-spaces')
  })

  it('lets the moderator pick when no decision model is chosen', async () => {
    t = renderComponent(RootComponent, { strict: true })
    await t.respond('HTTP', TAGS, 'models')
    t.simulateEvent('.decision-model', 'change', { value: '' })
    t.simulateEvent('.topic-input', 'input', { value: 'Tabs or spaces?' })
    t.simulateEvent('.start-run', 'click')
    await t.respond('LLM', DESIGN, 'panel')
    expect(t.requests('HTTP').some((r) => r.key === 'decide')).toBe(false)
    await t.respond('LLM', { nextSpeakerId: 'lin-linter', wrapUp: false }, 'moderator')
    expect(t.state.nextSpeakerId).toBe('lin-linter')
    t.expectNoDiagnostics()
  })

  it('falls back to the moderator when the decision model fails', async () => {
    await startDiscussion()
    await t.fail('HTTP', 404, 'decide')
    await t.respond('LLM', { nextSpeakerId: 'sam-spaces', wrapUp: false }, 'moderator')
    expect(t.state.nextSpeakerId).toBe('sam-spaces')
  })

  it('stops a discussion, then starts a new session', async () => {
    await startDiscussion()
    await t.respond('HTTP', answers(QUESTIONS, { next: 'ada-tabs' }), 'decide')
    await t.respond('LLM', handoff, 'moderator')
    await t.stream('LLM', ['Tabs are'], 'turn', { end: false })
    expect(t.html()).toContain('Tabs are')

    t.simulateEvent('.stop-run', 'click')
    await t.next((s) => s.phase === 'stopped')
    expect(t.sinkValues('LLM').at(-1)).toEqual({ abort: true })
    t.simulateEvent('.new-session-run', 'click')
    await t.next((s) => s.phase === 'idle' && s.transcript.length === 0 && s.topic === '')
  })

  it('answers a follow-up in the same saved session, the named panelist first', async () => {
    await startDiscussion()
    await turn('ada-tabs', 'Tabs')
    await turn('sam-spaces', 'Spaces')
    await turn('lin-linter', 'Linters')
    await t.respond('HTTP', answers(QUESTIONS, { wrapUp: true }), 'decide')
    await t.stream('LLM', ['Use a formatter.'], 'turn')
    await t.respond('LLM', 'Tabs Versus Spaces', 'title')

    t.simulateEvent('.followup-input', 'input', { value: 'What would Sam Spaces do in Go?' })
    t.simulateEvent('.followup-row', 'submit')
    // Sam was named: no decision for the first follow-up turn
    await t.respond('LLM', handoff, 'moderator')
    expect(t.state.nextSpeakerId).toBe('sam-spaces')
    expect(t.state.pickedBy).toBe('you')
    await t.stream('LLM', ['gofmt uses tabs.'], 'turn')
    await t.respond('HTTP', answers(QUESTIONS, { wrapUp: true }), 'decide')
    await t.stream('LLM', ['Follow the language.'], 'turn')

    expect(t.state.transcript.at(-1).speakerName).toBe('Mo Derator (Follow-up Synthesis)')
    expect(t.state.sessions).toHaveLength(1)
    expect(t.state.sessions[0]).toMatchObject({ title: 'Tabs Versus Spaces', turnCount: 4 })
    expect(t.requests('LLM').filter((r) => r.key === 'title')).toHaveLength(1)
    t.expectNoDiagnostics()
  })

  it('copies the transcript as markdown', async () => {
    await startDiscussion()
    await turn('ada-tabs', 'Tabs')
    t.simulateEvent('.copy-transcript', 'click')
    await t.next((s) => s.copied)
    expect(t.browser.clipboard()).toContain('**Ada Tabs**')
  })

  it('reopens and deletes saved sessions from the history drawer', async () => {
    const session = { id: 's1', createdAt: '2026-10-01T10:00:00Z', title: 'Old talk', topic: 'Old topic', panel: buildPanel(DESIGN, 'Old topic'), transcript: [{ kind: 'expert', speakerId: 'ada-tabs', speakerName: 'Ada Tabs', content: 'Hi' }], turnCount: 1 }
    t = renderComponent(RootComponent, { strict: true, storage: { 'sygnal.aiPanel': { version: 1, state: { sessions: [session] } } } })
    t.simulateEvent('.history-toggle', 'click')
    await t.next((s) => s.historyOpen)
    t.simulateEvent('.history-item[data-id="s1"] .history-open', 'click')
    await t.next((s) => s.sessionId === 's1' && s.phase === 'completed')
    expect(t.html()).toContain('Old topic')
    t.simulateEvent('.history-toggle', 'click')
    t.simulateEvent('.history-item[data-id="s1"] .history-delete', 'click')
    await t.next((s) => s.sessions.length === 0)
  })
})
