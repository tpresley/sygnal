import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import KitchenHelper from './KitchenHelper.jsx'
import { runTool } from './tools.js'
import { OLLAMA_ONLY } from '../../shared/fixtures.js'

let t
afterEach(() => t?.dispose())

const start = async () => {
  t = renderComponent(KitchenHelper)
  await t.respond('HTTP', OLLAMA_ONLY)
  return t
}

const toolPart = (message, id) => message.parts.find((p) => p.toolCallId === id)

it('runs a tool call, and sends the conversation back with its output', async () => {
  await start()
  t.simulateEvent('.example', 'click', { dataset: { prompt: 'Bake at 350°F in Celsius?' } })
  expect(t.requests('LLM')[0]).toMatchObject({ model: 'ollama::qwen3:8b', tools: { convert_units: {}, exchange_rate: {}, calculate: {} } })

  await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'convert_units', input: { value: 350, from: 'F', to: 'C' } } }], 'reply')
  expect(t.state.results.c1).toEqual({ ok: true, output: { value: 176.7, unit: 'C' } })

  const second = t.requests('LLM')[1]
  expect(second.continue).toBe(true)
  expect(toolPart(second.messages.at(-1), 'c1')).toMatchObject({ state: 'output-available', output: { value: 176.7, unit: 'C' } })
  expect(t.html()).toContain('convert_units')

  await t.stream('LLM', ['That is about 177 °C.'], 'reply')
  expect(t.state.status).toBe('ready')
  const reply = t.state.messages.at(-1)
  expect(reply.parts.map((p) => p.type)).toEqual(['tool-convert_units', 'step-start', 'text'])   // one message, two steps
  expect(t.html()).toContain('2 requests')
})

it('answers bad input with an error the model can read', async () => {
  await start()
  t.simulateEvent('.prompt', 'input', { value: 'Weigh my cat in stone' })
  t.simulateEvent('.ask', 'submit')
  await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'convert_units', input: { value: 4, from: 'kg', to: 'stone' } } }], 'reply')
  const part = toolPart(t.requests('LLM')[1].messages.at(-1), 'c1')
  expect(part).toMatchObject({ state: 'output-error', errorText: 'Unknown unit "stone"' })
  expect(t.html()).toContain('tool-card failed')
})

it('stops after six requests in a turn', async () => {
  await start()
  t.simulateEvent('.prompt', 'input', { value: 'Keep adding' })
  t.simulateEvent('.ask', 'submit')
  for (let i = 1; i <= 6; i++) {
    await t.stream('LLM', [{ toolCall: { id: `c${i}`, name: 'calculate', input: { expression: `${i} + 1` } } }], 'reply')
  }
  expect(t.requests('LLM')).toHaveLength(6)
  expect(t.state.status).toBe('ready')
  expect(t.html()).toContain('stopped at the 6-request limit')
})

it('stops on Stop, keeping what streamed', async () => {
  await start()
  t.simulateEvent('.prompt', 'input', { value: 'Hi' })
  t.simulateEvent('.ask', 'submit')
  await t.stream('LLM', ['Let me'], 'reply', { end: false })
  t.simulateEvent('.stop', 'click')
  await t.settle()
  expect(t.state.status).toBe('ready')
  expect(t.state.messages.at(-1).parts[0].text).toBe('Let me')
})

it('the tools are pure functions with checked input', () => {
  expect(runTool({ name: 'convert_units', input: { value: 3, from: 'cups', to: 'g', ingredient: 'sugar' } })).toMatchObject({ value: 600, unit: 'g' })
  expect(runTool({ name: 'exchange_rate', input: { amount: 42, from: 'eur', to: 'usd' } })).toMatchObject({ amount: 45.65, currency: 'USD' })
  expect(runTool({ name: 'calculate', input: { expression: '(1133.98 + 600) / -2' } })).toEqual({ result: -866.99 })
  expect(runTool({ name: 'calculate', input: { expression: 'process.exit()' } })).toBeInstanceOf(Error)
  expect(runTool({ name: 'calculate', input: { expression: '1 / 0' } }).message).toContain('Division by zero')
})
