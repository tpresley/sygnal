// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'

// Role + accessible-name matching, approximated in userland: filter a tag-level stream.
const label = (el) => (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || '').trim()
const byRole = (DOM, tag, name, type) => DOM.select(tag).events(type).filter((e) => label(e.target.closest(tag)) === name)

function Form({ state }) {
  return <div>
    <label>Title <input name="title" value={state.title} /></label>
    <button name="save">Save <b>now</b></button>
    <button aria-label="Delete draft">🗑</button>
    <p className="out">{state.log.join(',')}</p>
  </div>
}
Form.initialState = { title: '', log: [] }
Form.intent = ({ DOM }) => ({
  TITLE:  DOM.input('[name="title"]').value(),           // native name attribute: works today
  SAVE:   DOM.click('[name="save"]'),
  DELETE: byRole(DOM, 'button', 'Delete draft', 'click'), // role + accessible name
})
Form.model = {
  TITLE: (s, title) => ({ ...s, title }),
  SAVE: (s) => ({ ...s, log: [...s.log, 'save'] }),
  DELETE: (s) => ({ ...s, log: [...s.log, 'delete'] }),
}
let t; afterEach(() => t?.dispose())
it('native name + role/label selection (real DOM)', async () => {
  t = renderComponent(Form, { dom: 'real' }); await t.ready()
  t.simulateEvent('[name="title"]', 'input', { value: 'Hi' }); await t.next(s => s.title === 'Hi')
  t.simulateEvent('[name="save"] b', 'click'); await t.next(s => s.log.length === 1)
  t.simulateEvent('[aria-label="Delete draft"]', 'click'); await t.next(s => s.log.length === 2)
  expect(t.state.log).toEqual(['save', 'delete'])
})
