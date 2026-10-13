import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import EventExtractor from './EventExtractor.jsx'
import { Event } from './event.js'
import { EMAILS } from './emails.js'
import { OLLAMA_ONLY } from '../../shared/fixtures.js'

let t
afterEach(() => t?.dispose())

const start = async () => {
  t = renderComponent(EventExtractor, { initialState: { ...EventExtractor.initialState, today: '2026-10-12' } })
  await t.respond('HTTP', OLLAMA_ONLY)
  return t
}

const KICKOFF = {
  title: 'Atlas kickoff',
  date: '2026-10-22',
  start: '14:00',
  timeZone: null,
  durationMinutes: 90,
  location: '4th floor, "Fjord"',
  online: false,
  attendees: [
    { name: 'Priya Raman', email: 'priya.raman@northwind.io', role: 'organizer' },
    { name: 'Sam', email: null, role: 'optional' },
  ],
  agenda: ['Scope for v1', 'API migration owner'],
  priority: 'high',
}

it('sends the email with the schema and today\'s date', async () => {
  await start()
  t.simulateEvent('.extract', 'submit')
  const request = t.requests('LLM')[0]
  expect(request).toMatchObject({ model: 'ollama::qwen3:8b', output: Event, key: 'extract', messages: [{ role: 'user', content: EMAILS[0].text }] })
  expect(request.instructions).toContain('Today is Monday 2026-10-12')
  expect(request.instructions).toContain('Thursday 2026-10-15')
  expect(request.instructions).toContain('"Next month" is November 2026')
})

it('streams the raw JSON, then shows the validated event', async () => {
  await start()
  t.simulateEvent('.example', 'click', { dataset: { index: '2' } })
  expect(t.state.email).toBe(EMAILS[2].text)
  const json = JSON.stringify(KICKOFF)
  await t.stream('LLM', [json.slice(0, 30)], 'extract', { end: false })
  expect(t.state.raw).toBe(json.slice(0, 30))
  expect(t.html()).toContain('The model is writing JSON')
  await t.stream('LLM', [json.slice(30), { finish: { usage: { inputTokens: 1200, outputTokens: 210 } } }], 'extract')
  expect(t.state.event).toEqual(KICKOFF)
  const html = t.html()
  expect(html).toContain('Atlas kickoff')
  expect(html).toContain('Thu, Oct 22 · 14:00–15:30')
  expect(html).toContain('PR')                       // Priya's initials
  expect(html).toContain('1200 tokens in / 210 out')
})

it('shows the schema\'s issues and the raw text when the answer does not match', async () => {
  await start()
  t.simulateEvent('.extract', 'submit')
  await t.respond('LLM', { ...KICKOFF, date: 'next Thursday', priority: 'urgent' }, 'extract')
  expect(t.state.event).toBe(null)
  expect(t.state.issues.map((i) => i.path.join('.')).sort()).toEqual(['date', 'priority'])
  const html = t.html()
  expect(html).toContain('2 issues')
  expect(html).toContain('next Thursday')            // the raw text
})

it('reports a reply that is not JSON as an issue', async () => {
  await start()
  t.simulateEvent('.extract', 'submit')
  await t.respond('LLM', 'Sure! The meeting is on Thursday.', 'extract')
  expect(t.state.issues[0].message).toContain('not JSON')
})

it('shows a transport failure', async () => {
  await start()
  t.simulateEvent('.extract', 'submit')
  await t.fail('LLM', 500, 'extract')
  expect(t.html()).toContain('HTTP 500')
  expect(t.state.status).toBe('ready')
})
