// @vitest-environment jsdom
// PLAN-5 3-F G-425: the Testing examples of docs ui/dialog.md and ui/popover.md, as written:
// t.commands('ELEMENT') logs a sygnal/ui dialog / popover command with its selector
// ({ showModal: '.profile' }), not the guarded target object the behavior sends.
import { it, expect } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog, popover } from '../src/ui.ts'

// docs ui/dialog.md
function Profile({ state, uid }) {
  return h('div', null,
    h('button', { className: 'edit-profile' }, 'Edit profile'),
    h('dialog', { className: 'profile', 'aria-labelledby': uid('title') },
      h('h2', { id: uid('title') }, 'Edit profile'),
      h('label', null, 'Name ', h('input', { className: 'name', value: state.name })),
      h('button', { className: 'save' }, 'Save'),
      h('button', { className: 'cancel' }, 'Cancel')),
    h('p', null, state.profile.returnValue === 'saved' ? 'Profile saved' : ''))
}
Profile.initialState = { name: '' }
Profile.uses = { profile: dialog({ dialog: '.profile', trigger: '.edit-profile', close: '.cancel' }) }
Profile.intent = ({ DOM }) => ({ NAME: DOM.input('.name').value(), SAVE: DOM.click('.save') })
Profile.model = {
  NAME: (state, name) => ({ ...state, name }),
  SAVE: { ELEMENT: { close: '.profile', returnValue: 'saved' } },
}

// docs ui/popover.md
function Filters({ state, uid }) {
  return h('div', null,
    h('button', { className: 'filters-button', popovertarget: uid('filters') }, 'Filters'),
    h('div', { className: 'filters', id: uid('filters'), popover: 'auto', 'aria-label': 'Filters' },
      h('label', null, h('input', { type: 'checkbox', className: 'only-open', checked: state.onlyOpen }), ' Only open tasks'),
      h('button', { className: 'filters-done' }, 'Done')),
    h('p', null, state.filters.open ? 'Choosing filters…' : ''))
}
Filters.initialState = { onlyOpen: false }
Filters.uses = { filters: popover({ popover: '.filters', close: '.filters-done' }) }
Filters.intent = ({ DOM }) => ({ ONLY_OPEN: DOM.change('.only-open').checked() })
Filters.model = { ONLY_OPEN: (state, onlyOpen) => ({ ...state, onlyOpen }) }

it('dialog.md: opens the dialog and keeps the return value', async () => {
  const t = renderComponent(Profile)
  await t.ready()
  t.simulateEvent('.edit-profile', 'click')
  await t.next((s) => s.profile.open)
  expect(t.commands('ELEMENT')).toEqual([{ showModal: '.profile' }])

  t.simulateEvent('.save', 'click')
  await t.settle()
  expect(t.commands('ELEMENT').at(-1)).toEqual({ close: '.profile', returnValue: 'saved' })

  t.simulateEvent('.profile', 'close', { target: { returnValue: 'saved' } })
  await t.next((s) => !s.profile.open)
  expect(t.state.profile.returnValue).toBe('saved')
  expect(t.actions.map((a) => [a.type, a.cause])).toEqual([
    ['INITIALIZE', 'built-in'],
    ['profile.OPEN', 'behavior'],
    ['SAVE', 'intent'],
    ['profile.CLOSED', 'behavior'],
  ])
  t.dispose()
})

it('popover.md: follows the popover and closes it from the Done button', async () => {
  const t = renderComponent(Filters)
  await t.ready()
  t.simulateEvent('.filters', 'toggle', { newState: 'open', oldState: 'closed' })
  await t.next((s) => s.filters.open)

  t.simulateEvent('.filters-done', 'click')
  await t.settle()
  expect(t.commands('ELEMENT')).toEqual([{ hidePopover: '.filters' }])
  expect(t.actions.map((a) => a.type)).toEqual(['INITIALIZE', 'filters.TOGGLED', 'filters.CLOSE'])
  t.dispose()
})

it('dom: real still runs the guarded command (the log entry is a copy)', async () => {
  HTMLDialogElement.prototype.showModal ||= function () { this.open = true }
  const t = renderComponent(Profile, { dom: 'real' })
  await t.ready()
  t.simulateEvent('.edit-profile', 'click')
  await t.next((s) => s.profile.open)
  await t.settle()
  expect(t.commands('ELEMENT')).toEqual([{ showModal: '.profile' }])
  expect(t.container.querySelector('.profile').open).toBe(true)
  t.dispose()
})
