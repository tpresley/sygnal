// B-028: .data('taskId') must find an ancestor rendered as `data-task-id` when the event
// target is a nested child. jsdom-free: a minimal element mock with closest()/dataset.
import { describe, it, expect } from 'vitest'
import xs from 'xstream'
import { enrichEventStream } from '../src/cycle/dom/enrichEventStream.js'

// attrs: real (kebab-case) attribute names → values; dataset derived like the DOM does
function el(attrs, parent = null) {
  const dataset = {}
  for (const k in attrs) {
    if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attrs[k]
  }
  const node = {
    parent, dataset,
    closest(sel) {
      const m = sel.match(/^\[([\w-]+)\]$/)
      if (!m) throw new Error('unsupported selector ' + sel)
      for (let n = node; n; n = n.parent) if (n.has(m[1])) return n
      return null
    },
    has: name => name in attrs,
  }
  return node
}

function collect(stream$) {
  const out = []
  stream$.addListener({ next: v => out.push(v) })
  return out
}

describe('enrichEventStream .data() with camelCase names (B-028)', () => {
  const card = el({ 'data-task-id': '42', 'data-id': '9' })
  const title = el({ class: 'title' }, card)
  const icon = el({ class: 'icon' }, title)

  it('finds data-task-id on an ancestor of a nested click target', () => {
    expect(collect(enrichEventStream(xs.of({ target: icon })).data('taskId'))).toEqual(['42'])
  })

  it('still works on the element itself and for one-word names', () => {
    expect(collect(enrichEventStream(xs.of({ target: card })).data('taskId', Number))).toEqual([42])
    expect(collect(enrichEventStream(xs.of({ target: icon })).data('id', Number))).toEqual([9])
  })

  it('returns undefined when no ancestor has the attribute', () => {
    expect(collect(enrichEventStream(xs.of({ target: icon })).data('laneId'))).toEqual([undefined])
  })
})

describe('enrichEventStream .data() with kebab-case names (3E/R3)', () => {
  const card = el({ 'data-task-id': '42', 'data-lane-ref-id': '3' })
  const icon = el({ class: 'icon' }, el({ class: 'title' }, card))

  it(".data('task-id') reads the same attribute as .data('taskId')", () => {
    expect(collect(enrichEventStream(xs.of({ target: icon })).data('task-id'))).toEqual(['42'])
    expect(collect(enrichEventStream(xs.of({ target: card })).data('task-id', Number))).toEqual([42])
    expect(collect(enrichEventStream(xs.of({ target: icon })).data('lane-ref-id'))).toEqual(['3'])
    expect(collect(enrichEventStream(xs.of({ target: icon })).data('laneRefId'))).toEqual(['3'])
  })
})
