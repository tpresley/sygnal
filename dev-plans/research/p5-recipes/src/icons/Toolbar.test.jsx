// Toolbar.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Toolbar } from './Toolbar.jsx'

test('decorative icons are hidden, a meaningful icon has a name', async () => {
  const t = renderComponent(Toolbar)
  await t.ready()
  expect(t.query('.add svg').getAttribute('aria-hidden')).toBe('true')
  expect(t.query('.remove svg').getAttribute('aria-hidden')).toBe('true')
  expect(t.query('.remove').getAttribute('aria-label')).toBe('Remove the last item')
  expect(t.query('.status svg').getAttribute('role')).toBe('img')
  expect(t.query('.status svg').getAttribute('aria-label')).toBe('Saved')
  expect(t.queryAll('.add svg path').length).toBe(2)

  t.simulateEvent('.add', 'click')
  await t.next((state) => state.count === 1)
  expect(t.query('.count').textContent).toBe('1 items')
  t.dispose()
})
