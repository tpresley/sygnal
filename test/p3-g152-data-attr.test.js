// @vitest-environment jsdom
// PLAN-3 G-152: a `data-task-id="…"` JSX attribute became the dataset key `task-id`, which the
// DOM rejects with a bare DOMException. The pragma now camelCases the dataset key, so plain
// HTML data attributes render as written and `.data('taskId')` reads them.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement } from '../src/pragma/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null })

describe('G-152: data-* JSX attributes', () => {
  it('maps data-task-id to the dataset key taskId', () => {
    const vnode = createElement('div', { 'data-task-id': '7', 'data-id': '3', 'data-a-b-c': 'x' })
    expect(vnode.data.dataset).toEqual({ taskId: '7', id: '3', aBC: 'x' })
  })

  it('renders data-task-id in a real DOM, readable with .data()', async () => {
    function Board({ state }) {
      return createElement('div', null,
        createElement('button', { className: 'card', 'data-task-id': '7' }, 'pick'),
        createElement('p', { className: 'picked' }, String(state.picked)))
    }
    Board.initialState = { picked: null }
    Board.intent = ({ DOM }) => ({ PICK: DOM.click('.card').data('taskId', Number) })
    Board.model = { PICK: (state, picked) => ({ ...state, picked }) }
    t = renderComponent(Board, { dom: 'real' })
    await t.ready()
    expect(t.query('.card').getAttribute('data-task-id')).toBe('7')
    t.query('.card').click()
    await t.waitForState(s => s.picked === 7)
  })
})
