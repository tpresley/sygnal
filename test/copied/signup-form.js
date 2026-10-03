// A small form with reply actions (makeFetchDriver: ok / error), for the copied test (PLAN-4 3-E)
import { h, set } from 'sygnal'

export default function SignupForm({ state }) {
  return h('div.signup', [
    h('input.email', { attrs: { 'aria-label': 'Email', value: state.email } }),
    h('button.submit', { attrs: { type: 'button', disabled: state.saving } }, 'Sign up'),
    state.error ? h('p.error', state.error) : null,
    state.user ? h('p.welcome', `Welcome, ${state.user.name}`) : null,
  ])
}

SignupForm.initialState = { email: '', saving: false, user: null, error: null }

SignupForm.intent = ({ DOM }) => ({
  EMAIL: DOM.input('.email').map(e => e.target.value),
  SUBMIT: DOM.click('.submit'),
})

SignupForm.model = {
  EMAIL: set((_state, email) => ({ email })),
  SUBMIT: {
    STATE: set({ saving: true, error: null }),
    HTTP: (state) => ({ url: '/api/signup', method: 'POST', json: { email: state.email }, ok: 'SIGNED_UP', error: 'SIGNUP_FAILED' }),
  },
  SIGNED_UP: set((_state, user) => ({ saving: false, user })),
  SIGNUP_FAILED: set((_state, { status, body }) => ({ saving: false, error: body?.message ?? `HTTP ${status}` })),
}
