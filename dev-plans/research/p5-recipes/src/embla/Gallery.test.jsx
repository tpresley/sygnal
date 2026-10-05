// Gallery.test.jsx
import { test, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Gallery } from './Gallery.jsx'

test('the buttons send commands, and the shown slide comes back as state', async () => {
  const t = renderComponent(Gallery)
  await t.ready()
  t.simulateEvent('.next', 'click')
  t.simulateEvent('.dot[data-index="2"]', 'click')
  await t.settle()
  expect(t.commands()).toEqual([{ next: '.photos' }, { goTo: '.photos', index: 2 }])

  t.widget('.photos').dispatch('slide', 2)
  await t.next((state) => state.index === 2)
  expect(t.query('.where').textContent).toBe('Photo 3 of 3')
  expect(t.query('.next').disabled).toBe(true)
  t.dispose()
})
