// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { renderComponent } from 'sygnal'

function Add({ state }) {
  return <form className="f"><label>Task <input className="draft" value={state.draft} /></label>
    <button type="button" className="add">Add task</button><ul>{state.items.map(i => <li>{i}</li>)}</ul></form>
}
Add.initialState = { draft: '', items: [] }
Add.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), ADD: DOM.click('.add') })
Add.model = { DRAFT: (s, draft) => ({ ...s, draft }), ADD: (s) => ({ ...s, draft: '', items: [...s.items, s.draft] }) }

let t; afterEach(() => t?.dispose())
it('Testing Library queries + user-event against dom: real', async () => {
  t = renderComponent(Add, { dom: 'real' })
  await t.ready()
  const screen = within(t.container)
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Task' }), 'Milk')
  await user.click(screen.getByRole('button', { name: 'Add task' }))
  await t.next(s => s.items.length === 1).catch(() => {})
  expect(await screen.findByText('Milk')).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Task' }).value).toBe('')
})
