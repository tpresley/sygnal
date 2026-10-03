// @vitest-environment jsdom
// Copied from a sygnal/devtools session of APP (18 recorded actions, 7 replayed)
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { APP, localStorageDriver, silentRouter } from './todomvc-app.js'

it('TodoMVC: a recorded session replays (copied from sygnal/devtools)', async () => {
  const t = renderComponent(APP, {
    drivers: { STORE: localStorageDriver, ROUTER: silentRouter },
  })
  try {
    await t.ready()
    t.simulateAction('FROM_STORE', [])
    t.simulateAction('NEW_TODO', 'Buy milk')
    t.simulateAction('NEW_TODO', 'Walk the dog')
    // TOGGLE_ALL: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('TOGGLE_ALL', { type: 'click', target: { id: 'toggle-all', value: 'on', checked: false } })
    t.simulateAction('NEW_TODO', 'Write tests')
    t.simulateAction('VISIBILITY', 'active')
    // CLEAR_COMPLETED: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('CLEAR_COMPLETED', { type: 'click' })
    await t.settle()
    expect(t.state).toEqual({
      visibility: 'active',
      todos: [{ id: 3, title: 'Write tests', completed: false }],
      total: 1,
      remaining: 1,
      completed: 0,
      allDone: false,
    })
  } finally {
    t.dispose()
  }
})
