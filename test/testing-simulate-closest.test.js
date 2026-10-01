// 3E/R2: simulateEvent's synthetic target supports closest(), so `.data(name)` finds the
// ancestor carrying the data attribute, like the real DOM (and the browser test for B-028).
import { describe, it, expect } from 'vitest'
import { renderComponent, h } from '../src/index.ts'

function Row() {
  return h('ul', [
    h('li.row', { dataset: { taskId: 5 } }, [
      h('b.in', 'x'),
      h('i.self', { dataset: { taskId: 7 } }, 'y'),
      h('span.deep', [h('em.leaf', 'z')]),
    ]),
  ])
}
Row.initialState = { v: 'init' }
Row.intent = ({ DOM }) => ({
  NESTED: DOM.click('.in').data('taskId'),
  KEBAB: DOM.click('.leaf').data('task-id', Number),
  SELF: DOM.click('.self').data('taskId'),
  ROW: DOM.click('.row').data('taskId'),
  NONE: DOM.click('.in').data('laneId'),
  CLOSEST: DOM.click('.leaf').map(e => {
    const li = e.target.closest('li.row')
    return [
      e.target.closest('.leaf') === e.target,
      li && li.tagName,
      li && li.dataset.taskId,
      e.target.closest('.nope, ul > li .deep') && 'deep',
      e.target.closest('.nope'),
    ]
  }),
})
Row.model = {
  NESTED: (s, v) => ({ ...s, v: 'NESTED=' + v }),
  KEBAB: (s, v) => ({ ...s, v: 'KEBAB=' + v }),
  SELF: (s, v) => ({ ...s, v: 'SELF=' + v }),
  ROW: (s, v) => ({ ...s, v: 'ROW=' + v }),
  NONE: (s, v) => ({ ...s, v: 'NONE=' + v }),
  CLOSEST: (s, v) => ({ ...s, v: JSON.stringify(v) }),
}

describe('simulateEvent target.closest() (3E/R2)', () => {
  it('.data() on a nested target reads the ancestor row, and the bubbled row listener does too', async () => {
    const t = renderComponent(Row)
    t.simulateEvent('.in', 'click'); await t.settle()
    t.simulateEvent('.leaf', 'click'); await t.settle()
    t.simulateEvent('.self', 'click'); await t.settle()
    t.simulateEvent('.row', 'click'); await t.settle()
    const seen = t.states.map(s => s.v)
    t.dispose()
    // the click on .in reaches both the .in listener and (bubbling) the .row listener;
    // both read e.target = .in, whose closest('[data-task-id]') is the row
    expect(seen).toContain('NESTED=5')
    expect(seen).not.toContain('NESTED=undefined')
    expect(seen).not.toContain('ROW=undefined')
    expect(seen.filter(v => v == 'ROW=5').length).toBeGreaterThanOrEqual(2)
    expect(seen).toContain('KEBAB=5')
    expect(seen).toContain('SELF=7')
    expect(seen).toContain('NONE=undefined')
    expect(seen).toContain(JSON.stringify([true, 'LI', '5', 'deep', null]))
  })
})
