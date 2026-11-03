// SYG410 (dev entry): a child's state="" (or a path with an empty segment) names an empty key, so
// the child gets no state and is left out of the view, with nothing reported before.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks } from './helpers.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null })

function RangeField({ state }) { return h('input', { className: 'r', value: String(state?.v ?? '') }) }

const parentWith = (designator) => {
  function Form() { return h('form', null, h(RangeField, { state: designator, id: 'r' }), h(RangeField, { state: designator, id: 'r2' })) }
  Form.initialState = { v: 1, a: { b: { v: 2 } }, x: { v: 3 } }
  return Form
}
const syg410 = () => t.diagnostics.filter((d) => d.code === 'SYG410')

describe('SYG410: an empty state key', () => {
  it('state="" is reported once per component and value, as an error', async () => {
    t = renderComponent(parentWith(''))
    await t.ready()
    expect(t.html()).toBe('<form></form>')
    const found = syg410()
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('error')
    expect(found[0].component).toBe('RangeField')
    expect(found[0].message).toBe("<RangeField state=\"\"> names an empty key, so RangeField gets no state and doesn't render")
    expect(found[0].fix).toMatch(/Leave state out to share the parent's state/)
    expect(found[0].data).toEqual({ designator: '' })
  })

  it.each(['a..b', 'x.', '.x', 'a.b[0].'])('state="%s" (an empty path segment) is reported', async (p) => {
    t = renderComponent(parentWith(p))
    await t.ready()
    const [d] = syg410()
    expect(d?.message).toMatch(/has an empty path segment, so RangeField gets no state and doesn't render/)
    expect(d.data).toEqual({ designator: p })
  })

  it('a normal key, a path, a list position and no state prop are not reported', async () => {
    for (const p of ['x', 'a.b', 'a[0]', undefined]) {
      t = renderComponent(parentWith(p))
      await t.ready()
      expect(syg410()).toEqual([])
      t.dispose(); t = null
    }
  })
})
