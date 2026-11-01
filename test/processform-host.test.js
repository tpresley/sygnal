// 7.2.0-preview.0: processForm on a sygnal/host form (a terminal app): a <select multiple> is an
// array of its selected options' values ([] when none), as on the DOM; the host's <select> has no
// selectedOptions, so processForm reads the options' `selected`
import { it, expect, afterEach } from 'vitest'
import { run, createElement as h, processForm } from 'sygnal'
import { createTerminal } from 'sygnal/terminal'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))

function App({ state }) {
  return h('form', { className: 'f' },
    h('input', { className: 'title', name: 'title', value: 'x' }),
    h('select', { name: 'tags', multiple: true },
      h('option', { value: 'a', selected: state.pick.includes('a') }, 'A'),
      h('option', { selected: state.pick.includes('b') }, 'b'),
      h('option', { value: 'c', selected: state.pick.includes('c') }, 'C'),
      h('option', { value: 'd', selected: true, disabled: true }, 'D')),
    h('select', { name: 'off', multiple: true, disabled: true }, h('option', { value: 'z', selected: true }, 'Z')),
    h('input', { type: 'checkbox', name: 'opt', value: 'p', checked: true }),
    h('input', { type: 'checkbox', name: 'opt', value: 'q' }))
}
App.initialState = { pick: [], last: null }
App.intent = ({ DOM }) => ({ SENT: processForm(DOM.select('.f'), { events: 'submit' }) })
App.model = { SENT: (s, d) => ({ ...s, last: { ...d, event: undefined }, pick: ['a', 'b', 'c'] }) }

it('a <select multiple> in a terminal: the selected options\' values, [] when none; disabled options and selects left out', async () => {
  const term = createTerminal()
  let state
  const app = run(App, { DOM: term.driver })
  apps.push(app)
  app.sources.STATE.stream.addListener({ next: (s) => { state = s } })
  await tick()
  term.focus('.title')
  term.press('Enter')
  await tick()
  expect(state.last.tags).toEqual([])
  expect('off' in state.last).toBe(false)
  expect(state.last.opt).toEqual(['p'])
  expect(state.last.title).toBe('x')
  term.press('Enter')
  await tick()
  // an option without a value attribute is its text
  expect(state.last.tags).toEqual(['a', 'b', 'c'])
})
