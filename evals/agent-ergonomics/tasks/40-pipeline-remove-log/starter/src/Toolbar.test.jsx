import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const names = () => t.queryAll('.candidate .name').map((el) => el.textContent)

it('shows only the chosen role, combined with the stage tab', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent('[name="show-role"]', 'change', { value: 'Engineer' })
  await t.next((s) => s.view.role === 'Engineer')
  expect(names()).toEqual(['Ben Ode', 'Dee Park', 'Fay Wu', 'Hana Kim'])
  // The tab counts keep counting every candidate.
  expect(t.query('.tab[data-stage="all"]').textContent).toBe('All (8)')

  t.simulateEvent('.tab[data-stage="offer"]', 'click')
  await t.next((s) => s.view.tab === 'offer')
  expect(names()).toEqual(['Fay Wu'])

  t.simulateEvent('[name="show-role"]', 'change', { value: 'Product manager' })
  await t.next((s) => s.view.role === 'Product manager')
  expect(names()).toEqual([])
  expect(t.query('.candidate-list .empty').textContent).toBe('No candidates in this stage.')
  t.expectNoDiagnostics()
})

it('sorts newest first, and Reset view restores the board order and every role', async () => {
  t = renderComponent(App, { strict: true })
  await t.ready()
  expect(t.query('.reset-view').disabled).toBe(true)
  expect(t.query('.toolbar .total').textContent).toBe('8 candidates')

  t.simulateEvent('[name="sort"]', 'change', { value: 'newest' })
  await t.next((s) => s.view.sort === 'newest')
  expect(names()).toEqual(['Hana Kim', 'Gus Hale', 'Fay Wu', 'Eli Stone', 'Dee Park', 'Cy Lam', 'Ben Ode', 'Ana Ruiz'])
  // The array keeps its order: only the list is sorted.
  expect(t.state.candidates[0].name).toBe('Ana Ruiz')

  t.simulateEvent('[name="show-role"]', 'change', { value: 'Designer' })
  await t.next((s) => s.view.role === 'Designer')
  expect(names()).toEqual(['Eli Stone', 'Ana Ruiz'])
  expect(t.query('.reset-view').disabled).toBe(false)

  t.simulateEvent('.reset-view', 'click')
  await t.next((s) => s.view.role === 'all' && s.view.sort === 'board')
  expect(names()).toHaveLength(8)
  expect(names()[0]).toBe('Ana Ruiz')
  expect(t.query('.reset-view').disabled).toBe(true)
  t.expectNoDiagnostics()
})

it('searches by name, ignoring case and surrounding spaces, together with the role filter', async () => {
  t = renderComponent(App, { strict: true })
  t.simulateEvent('[name="search"]', 'input', { value: ' A ' })
  await t.next((s) => s.view.search === ' A ')
  expect(names()).toEqual(['Ana Ruiz', 'Cy Lam', 'Dee Park', 'Fay Wu', 'Gus Hale', 'Hana Kim'])

  t.simulateEvent('[name="show-role"]', 'change', { value: 'Engineer' })
  await t.next((s) => s.view.role === 'Engineer')
  expect(names()).toEqual(['Dee Park', 'Fay Wu', 'Hana Kim'])

  t.simulateEvent('[name="search"]', 'input', { value: 'zed' })
  await t.next((s) => s.view.search === 'zed')
  expect(names()).toEqual([])
  expect(t.query('.candidate-list .empty').textContent).toBe('No candidates in this stage.')

  t.simulateEvent('.reset-view', 'click')
  await t.next((s) => s.view.search === '')
  expect(names()).toHaveLength(8)
  expect(t.query('[name="search"]').value).toBe('')
  t.expectNoDiagnostics()
})
