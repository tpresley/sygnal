import { it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from 'sygnal'
import { answers } from 'sygnal/ai'
import Triage, { questions } from './Triage.jsx'
import { PROVIDERS } from '../../shared/fixtures.js'

let t
afterEach(() => { t?.dispose(); vi.useRealTimers() })

const start = async () => {
  t = renderComponent(Triage)
  await t.respond('HTTP', PROVIDERS, 'providers')
  return t
}

it('asks nimble the four questions about the ticket, and auto-assigns a sure answer', async () => {
  await start()
  const req = t.requests('HTTP').at(-1)
  expect(req).toMatchObject({ url: 'http://localhost:11434/v1/systemone', json: { model: 'nimble:latest', state: Triage.initialState.text } })
  expect(Object.keys(req.json.questions)).toEqual(['topic', 'urgent', 'mood', 'churn'])
  await t.respond('HTTP', answers(questions, { topic: { choice: 'billing', confidence: 0.92 }, urgent: 0.1, mood: { score: 1, confidence: 0.8 }, churn: 0.05 }), 'triage')
  expect(t.html()).toContain('Auto-assigned to the Billing team')
  expect(t.state.took).toBeTypeOf('number')
})

it('sends an unsure ticket to a person, and says which question was unsure', async () => {
  await start()
  await t.respond('HTTP', answers(questions, { topic: { probabilities: { billing: 0.45, account: 0.4, bug: 0.05, feature: 0.05, praise: 0.05 } }, urgent: 0.9 }), 'triage')
  expect(t.html()).toContain('Needs a person')
  expect(t.html()).toContain('Not sure about the topic: 45% billing, 40% account')
})

it('the threshold slider decides what counts as sure', async () => {
  await start()
  await t.respond('HTTP', answers(questions, { topic: { choice: 'bug', confidence: 0.7 }, urgent: 0.95 }), 'triage')
  expect(t.html()).toContain('Auto-assigned to Engineering support')
  expect(t.html()).toContain('Priority queue')
  t.simulateEvent('.threshold', 'input', { value: '0.8' })
  await t.settle()
  expect(t.html()).toContain('Needs a person')
})

it('decides again once typing pauses, and when another model is picked', async () => {
  vi.useFakeTimers()
  await start()
  await t.respond('HTTP', answers(questions, {}), 'triage')
  t.simulateEvent('.text', 'input', { value: 'The app crashes' })
  await vi.advanceTimersByTimeAsync(300)
  expect(t.requests('HTTP')).toHaveLength(2)          // the providers and the first decision only
  await vi.advanceTimersByTimeAsync(150)
  expect(t.requests('HTTP').at(-1).json.state).toBe('The app crashes')
  t.simulateEvent('.model-pick', 'change', { value: 'typesafe::jev-latest' })
  await t.settle()
  expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/decide', json: { model: 'jev-latest', state: 'The app crashes' } })
})
