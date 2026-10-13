// The trip planner without a model: t.stream answers the chat's requests, composeWith answers a
// card's composition with the backend's own fake reply, and a click on a part answers the card.
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import Trips from './Trips.jsx'
import { catalog } from './cards.jsx'
import { PROVIDERS, OLLAMA_ONLY } from '../../shared/fixtures.js'

let t
afterEach(() => { t?.dispose(); t = null })

const chatRequests = () => t.requests('LLM').filter((r) => r.key === 'assistant')
const cardRequests = () => t.requests('LLM').filter((r) => r.key?.startsWith('assistant.ask:'))
const askCall = (id, need) => ({ toolCall: { id, name: 'ask_user', input: { need } } })
/** the ask_user part of call `id` in the last chat request: what went back to the model */
const sent = (id) => chatRequests().at(-1).messages.flatMap((m) => m.parts ?? []).find((p) => p.toolCallId === id)

async function start(providers = PROVIDERS) {
  t = renderComponent(Trips)
  await t.respond('HTTP', providers)
  await t.settle()
}

async function answered(n) {
  await t.waitForState((s) => s.assistant.status === 'submitted' && chatRequests().length === n)
}

it('asks with the chat model, which composes the card; the pick goes back to it and fills in the trip', async () => {
  await start(OLLAMA_ONLY)
  t.simulateEvent('.example', 'click', { dataset: { prompt: 'Plan me a long weekend somewhere warm' } })
  await t.waitForState((s) => s.assistant.status === 'submitted')
  expect(chatRequests()[0]).toMatchObject({ model: 'ollama::qwen3:8b' })
  // nothing to book yet: trips_book is offered only once the cards filled in the trip
  expect(Object.keys(chatRequests()[0].tools)).toContain('ask_user')
  expect(Object.keys(chatRequests()[0].tools)).not.toContain('trips_book')

  await t.stream('LLM', ['Let me ask. ', askCall('c1', 'Pick a warm destination for your long weekend')], 'assistant')
  await t.settle()
  expect(t.query('.tc-card.composing .tc-need').textContent).toBe('Pick a warm destination for your long weekend')
  // the card is a second request on the chat's sink, with the need as its message
  expect(cardRequests()[0]).toMatchObject({ key: 'assistant.ask:c1', model: 'ollama::qwen3:8b' })
  expect(cardRequests()[0].messages.at(-1)).toEqual({ role: 'user', content: 'Pick a warm destination for your long weekend' })

  await composeWith(t, catalog, [{ part: 'destinations', params: { vibe: 'warm' } }])
  expect(t.queryAll('.tc-card.open .tc-dest').map((b) => b.getAttribute('data-id'))).toEqual(['lisbon', 'marrakech', 'bali'])

  t.simulateEvent('.tc-dest[data-id="lisbon"]', 'click')
  await answered(2)
  expect(sent('c1').output).toEqual({ part: 'destinations', answer: 'lisbon' })
  expect(t.state.trip.destination).toBe('lisbon')
  expect(t.query('.tc-trip').textContent).toContain('Lisbon')
  expect(t.query('.tc-card').getAttribute('class')).toContain('answered')
  expect(t.query('.tc-dest.picked').getAttribute('data-id')).toBe('lisbon')
  expect(t.query('.tc-dest[data-id="bali"]').disabled).toBe(true)
})

it('a stepper with its own state, a confirmation, then the agent books the trip', async () => {
  await start()
  t.simulateAction('assistant.SEND', 'Lisbon for 4 people')
  await t.stream('LLM', [askCall('s', 'How many travelers and nights?')], 'assistant')
  await composeWith(t, catalog, [{ part: 'tripSize' }])
  t.simulateEvent('.tc-plus[data-field="travelers"]', 'click')
  await t.settle()
  t.simulateEvent('.tc-plus[data-field="travelers"]', 'click')
  await t.settle()
  expect(t.query('.tc-step b').textContent).toBe('4')
  t.simulateEvent('.tc-done', 'click')
  await answered(2)
  expect(sent('s').output).toEqual({ part: 'tripSize', answer: { travelers: 4, nights: 3 } })

  t.simulateAction('PICKED', { value: 'lisbon' })
  await t.stream('LLM', [askCall('ok', 'Book this trip?')], 'assistant')
  await composeWith(t, catalog, [{ part: 'tripSummary' }, { part: 'confirm' }])
  expect(t.query('.tc-summary').textContent).toContain('$420')
  t.simulateEvent('.tc-yes', 'click')
  await answered(3)
  expect(sent('ok').output).toEqual({ part: 'confirm', answer: true })
  expect(Object.keys(chatRequests().at(-1).tools)).toContain('trips_book')

  await t.stream('LLM', [{ toolCall: { id: 'b', name: 'trips_book', input: {} } }], 'assistant')
  await t.waitForState((s) => s.trip.booked)
  await t.stream('LLM', ['Booked: Lisbon, 3 nights for 4.'], 'assistant')
  await t.settle()
  expect(t.query('.tc-trip .badge').textContent).toBe('Booked')
  expect(t.html()).toContain('✓ Booked the trip')
})

it('a generated choice (LLM-only params), and a rating the trip panel shows', async () => {
  await start()
  t.simulateAction('assistant.SEND', 'Rate this chat')
  await t.stream('LLM', [askCall('q', 'What kind of trip?')], 'assistant')
  await composeWith(t, catalog, [{ part: 'choice', params: { question: 'Beach or city?', options: ['Beach', 'City'] } }])
  t.simulateEvent('.tc-option[data-value="City"]', 'click')
  await answered(2)
  expect(sent('q').output).toEqual({ part: 'choice', answer: 'City' })

  await t.stream('LLM', [askCall('r', 'How would you rate this chat?')], 'assistant')
  await composeWith(t, catalog, [{ part: 'rating' }])
  t.simulateEvent('.tc-star[data-n="4"]', 'click')
  await answered(3)
  expect(sent('r').output).toEqual({ part: 'rating', answer: 4 })
  expect(t.query('.tc-rated').textContent).toContain('★★★★☆')
  expect(t.queryAll('.tc-star.on')).toHaveLength(4)
})

it('Skip closes an open card unanswered; New trip starts over', async () => {
  await start()
  t.simulateAction('assistant.SEND', 'Somewhere warm')
  await t.stream('LLM', [askCall('w', 'Pick a destination')], 'assistant')
  await composeWith(t, catalog, [{ part: 'destinations' }])
  expect(t.query('.stop').textContent).toBe('Skip the card')
  t.simulateEvent('.stop', 'click')
  await t.settle()
  expect(t.query('.tc-card').getAttribute('class')).toContain('cancelled')
  expect(t.query('.tc-dest').disabled).toBe(true)
  t.simulateEvent('.new-chat', 'click')
  await t.settle()
  expect(t.state.assistant.messages).toEqual([])
  expect(t.queryAll('.example')).toHaveLength(3)
  t.expectNoDiagnostics()
})
