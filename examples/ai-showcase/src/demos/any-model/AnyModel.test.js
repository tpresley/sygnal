import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import AnyModel from './AnyModel.jsx'
import { PROVIDERS, OLLAMA_ONLY } from '../../shared/fixtures.js'

let t
afterEach(() => t?.dispose())

const start = async (providers = PROVIDERS) => {
  t = renderComponent(AnyModel)
  await t.respond('HTTP', providers)
  return t
}

it('defaults to Kimi K3 on Kindo, and streams a reply into the transcript', async () => {
  await start()
  t.simulateEvent('.prompt', 'input', { value: 'Hello' })
  t.simulateEvent('.ask', 'submit')
  expect(t.requests('LLM')[0]).toMatchObject({ model: 'kindo::moonshotai/Kimi-K3', key: 'reply' })
  await t.stream('LLM', ['Hi', ' there'], 'reply', { end: false })
  expect(t.state.draft).toBe('Hi there')
  await t.stream('LLM', ['!'], 'reply')
  expect(t.state.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  expect(t.html()).toContain('Open Responses') // the via line names the wire format
})

it('falls back to qwen3 on Ollama without a Kindo key, and asks for reasoning when Thinking is on', async () => {
  await start(OLLAMA_ONLY)
  t.simulateEvent('.think', 'change', { checked: true })
  t.simulateEvent('.example', 'click', { dataset: { prompt: 'Why?' } })
  expect(t.requests('LLM')[0]).toMatchObject({ model: 'ollama::qwen3:8b', body: { reasoning: { effort: 'medium' } } })
  await t.stream('LLM', [{ reasoning: 'Let me think.' }], 'reply', { end: false })
  expect(t.state.reasoning).toBe('Let me think.')
})

it('keeps the partial reply when stopped', async () => {
  await start()
  t.simulateEvent('.prompt', 'input', { value: 'Tell me a story' })
  t.simulateEvent('.ask', 'submit')
  await t.stream('LLM', ['Once upon'], 'reply', { end: false })
  t.simulateEvent('.stop', 'click')
  await t.settle()
  expect(t.state.messages.at(-1).parts[0].text).toBe('Once upon')
  expect(t.state.status).toBe('ready')
})

it('shows a failure', async () => {
  await start()
  t.simulateEvent('.prompt', 'input', { value: 'Hello' })
  t.simulateEvent('.ask', 'submit')
  await t.fail('LLM', 429, 'reply')
  expect(t.html()).toContain('HTTP 429')
})
