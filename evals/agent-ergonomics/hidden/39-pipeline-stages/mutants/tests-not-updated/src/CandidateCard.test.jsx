import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const card = (id) => `.candidate[data-id="${id}"]`
const stageOf = (id) => t.query(`${card(id)} .stage`).textContent
const tabText = (stage) => t.query(`.tab[data-stage="${stage}"]`).textContent
const candidate = (id) => t.state.candidates.find((c) => c.id === id)

it('advances a candidate from Applied through Interview and Offer to Hired', async () => {
  t = renderComponent(App, { strict: true })
  await t.ready()

  t.simulateEvent(`${card(1)} .advance`, 'click')
  await t.next(() => candidate(1).stage === 'interview')
  expect(stageOf(1)).toBe('Interview')
  expect(tabText('applied')).toBe('Applied (1)')
  expect(tabText('interview')).toBe('Interview (3)')

  t.simulateEvent(`${card(1)} .advance`, 'click')
  await t.next(() => candidate(1).stage === 'offer')
  expect(stageOf(1)).toBe('Offer')
  expect(tabText('offer')).toBe('Offer (3)')

  t.simulateEvent(`${card(1)} .advance`, 'click')
  await t.next(() => candidate(1).stage === 'hired')
  expect(stageOf(1)).toBe('Hired')
  expect(tabText('hired')).toBe('Hired (2)')
  expect(t.query('.summary').textContent).toBe('5 active · 2 hired')
  // A hired candidate can no longer be advanced or rejected.
  expect(t.query(`${card(1)} .advance`)).toBeNull()
  expect(t.query(`${card(1)} .reject`)).toBeNull()
  t.expectNoDiagnostics()
})

it('rejects a candidate', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent(`${card(3)} .reject`, 'click')
  await t.next(() => candidate(3).stage === 'rejected')
  expect(stageOf(3)).toBe('Rejected')
  expect(tabText('interview')).toBe('Interview (1)')
  expect(tabText('rejected')).toBe('Rejected (2)')
  expect(t.query('.summary').textContent).toBe('5 active · 1 hired')
  expect(t.query(`${card(3)} .advance`)).toBeNull()
  t.expectNoDiagnostics()
})

it('removes a candidate', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent(`${card(2)} .remove`, 'click')
  await t.next((s) => s.candidates.length === 7)
  expect(t.query(card(2))).toBeNull()
  expect(t.queryAll('.candidate .name').map((el) => el.textContent)).not.toContain('Ben Ode')
  expect(tabText('all')).toBe('All (7)')
  expect(tabText('applied')).toBe('Applied (1)')
  t.expectNoDiagnostics()
})
