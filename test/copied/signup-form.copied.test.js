// Copied from a sygnal/devtools session of SignupForm (7 recorded actions, 6 replayed)
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import SignupForm from './signup-form.js'

it('signup form: a recorded session with replies replays (copied from sygnal/devtools)', async () => {
  const t = renderComponent(SignupForm)
  try {
    await t.ready()
    t.simulateAction('EMAIL', 'ada')
    // SUBMIT: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('SUBMIT', { type: 'click' })
    await t.fail('HTTP', 422, { request: (r) => r.error === 'SIGNUP_FAILED', body: { message: 'Email is invalid' } })
    t.simulateAction('EMAIL', 'ada@example.com')
    // SUBMIT: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('SUBMIT', { type: 'click' })
    await t.respond('HTTP', { id: 1, name: 'Ada', email: 'ada@example.com' }, 'SIGNED_UP')
    await t.settle()
    expect(t.state).toEqual({
      email: 'ada@example.com',
      saving: false,
      user: { id: 1, name: 'Ada', email: 'ada@example.com' },
      error: null,
    })
  } finally {
    t.dispose()
  }
})
