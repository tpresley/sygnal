// @vitest-environment jsdom
// Sift (Phase D): autoFocus focuses right after the patch that adds the element, as React focuses
// at mount: it waited for requestAnimationFrame (none in a hidden tab until it was shown, none at
// all in some test runtimes) and so came after the router's focus. An element that can't take
// focus yet tries again on the next frame.
import { it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'

afterEach(() => vi.unstubAllGlobals())

function Edit({ state }) {
  return h('div', null, h('button', { className: 'edit' }, 'Edit'), state.editing ? h('input', { className: 'field', autoFocus: true, autoSelect: true, value: 'abc' }) : null)
}
Edit.initialState = { editing: false }
Edit.intent = ({ DOM }) => ({ EDIT: DOM.click('.edit') })
Edit.model = { EDIT: s => ({ ...s, editing: true }) }

it('focuses (and selects) after the patch, with no requestAnimationFrame', async () => {
  vi.stubGlobal('requestAnimationFrame', undefined)
  const t = renderComponent(Edit, { dom: 'real' })
  await t.ready()
  await t.simulateEvent('.edit', 'click')
  await t.settle()
  const f = t.query('.field')
  expect(document.activeElement).toBe(f)
  expect([f.selectionStart, f.selectionEnd]).toEqual([0, 3])
  t.dispose()
})

it('an element that cannot take focus at the patch tries again on the next frame (once)', async () => {
  const frames = []
  vi.stubGlobal('requestAnimationFrame', (f) => frames.push(f))
  // the first focus() of the field is refused, as for an element not shown yet
  const focus = HTMLElement.prototype.focus
  let refused = 0
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (...a) {
    if (this.className == 'field' && !refused++) return
    return focus.apply(this, a)
  })
  const t = renderComponent(Edit, { dom: 'real' })
  await t.ready()
  await t.simulateEvent('.edit', 'click')
  await t.settle()
  expect(document.activeElement).not.toBe(t.query('.field'))
  expect(frames.length).toBe(1)
  frames.shift()()
  expect(document.activeElement).toBe(t.query('.field'))
  expect(frames.length).toBe(0)
  t.dispose()
  vi.restoreAllMocks()
})
