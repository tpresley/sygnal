import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const names = () => t.queryAll('.candidate .name').map((el) => el.textContent)

it('shows the stage tabs with counts and the summary', async () => {
  t = renderComponent(App, { strict: true })
  await t.ready()
  expect(t.query('h1').textContent).toBe('Hiring pipeline')
  expect(t.queryAll('.stage-tabs .tab').map((el) => el.textContent)).toEqual([
    'All (8)',
    'Applied (2)',
    'Interview (2)',
    'Offer (2)',
    'Hired (1)',
    'Rejected (1)',
  ])
  expect(t.query('.tab.active').textContent).toBe('All (8)')
  expect(t.query('.summary').textContent).toBe('6 active · 1 hired')
  expect(t.query('.roles').textContent).toBe('Engineer: 4, Designer: 2, Product manager: 2')
  expect(names()).toHaveLength(8)
})

it('filters the list by stage and shows a message for an empty stage', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent('.tab[data-stage="offer"]', 'click')
  await t.next((s) => s.view.tab === 'offer')
  expect(names()).toEqual(['Eli Stone', 'Fay Wu'])
  expect(t.query('.tab.active').textContent).toBe('Offer (2)')
  expect(t.query('.candidate-list .empty')).toBeNull()

  t.simulateEvent('.tab[data-stage="hired"]', 'click')
  await t.next((s) => s.view.tab === 'hired')
  expect(names()).toEqual(['Gus Hale'])
  t.simulateEvent('.candidate[data-id="7"] .remove', 'click')
  await t.next((s) => s.candidates.length === 7)
  expect(names()).toEqual([])
  expect(t.query('.candidate-list .empty').textContent).toBe('No candidates in this stage.')
  t.expectNoDiagnostics()
})

it('adds a candidate at the end of Applied and clears the form', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent('[name="name"]', 'input', { value: '  Ivy Chen ' })
  t.simulateEvent('[name="role"]', 'change', { value: 'Designer' })
  t.simulateEvent('.add-candidate', 'submit')
  await t.next((s) => s.candidates.length === 9)
  expect(t.state.candidates.at(-1)).toMatchObject({ id: 9, name: 'Ivy Chen', role: 'Designer', stage: 'applied', notes: [] })
  expect(names().at(-1)).toBe('Ivy Chen')
  expect(t.query('.candidate[data-id="9"] .stage').textContent).toBe('Applied')
  expect(t.query('.tab[data-stage="applied"]').textContent).toBe('Applied (3)')
  expect(t.query('[name="name"]').value).toBe('')
  t.expectNoDiagnostics()
})

it('refuses a candidate without a name', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent('[name="name"]', 'input', { value: '   ' })
  t.simulateEvent('.add-candidate', 'submit')
  await t.next((s) => s.draft.error !== '')
  expect(t.query('.add-candidate .error').textContent).toBe('Enter a name.')
  expect(t.state.candidates).toHaveLength(8)

  t.simulateEvent('[name="name"]', 'input', { value: 'Jo Bell' })
  t.simulateEvent('.add-candidate', 'submit')
  await t.next((s) => s.candidates.length === 9)
  expect(t.query('.add-candidate .error')).toBeNull()
  t.expectNoDiagnostics()
})
