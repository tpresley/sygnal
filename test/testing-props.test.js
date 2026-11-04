// @vitest-environment jsdom
// Sift (preview.5 #7): renderComponent's props option, a child tested alone with the props a
// parent would pass: the view, the intent's props$, handlers' 4th argument and context entries
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'

function Item({ state, context, label, unit }) {
  return h('li', { className: 'item' }, `${label}: ${state.n} ${unit} (${context.shout})`)
}
Item.initialState = { n: 1, seen: null }
Item.context = { shout: (s, { label }) => label.toUpperCase() }
Item.intent = ({ DOM, props$ }) => ({ ADD: DOM.click('.item'), SEEN: props$.map((p) => p.label).take(1) })
Item.model = {
  ADD: (s, _d, _n, props) => ({ ...s, n: s.n + props.step }),
  SEEN: (s, label) => ({ ...s, seen: label }),
}

describe('renderComponent props', () => {
  for (const dom of ['mock', 'real']) {
    it(`reach the view, props$, handlers and context entries (${dom} DOM)`, async () => {
      if (dom == 'real' && typeof document == 'undefined') return
      using t = renderComponent(Item, { dom, props: { label: 'Milk', unit: 'L', step: 2 } })
      await t.ready()
      expect(t.state.seen).toBe('Milk')
      await t.simulateEvent('.item', 'click')
      expect(t.state.n).toBe(3)
      expect(t.html()).toContain('Milk: 3 L (MILK)')
    })
  }

  it('without the option the root has no props, as before', async () => {
    function Plain({ state, ...props }) { return h('p', null, `${Object.keys(props).filter((k) => k != 'context' && k != 'uid' && k != 'children' && k != 'slots').length}`) }
    Plain.initialState = {}
    using t = renderComponent(Plain)
    await t.ready()
    expect(t.html()).toContain('<p>0</p>')
  })

  it('rejects a non-object and the names the runtime owns', () => {
    expect(() => renderComponent(Item, { props: [1] })).toThrow('props takes the object of props a parent would pass')
    expect(() => renderComponent(Item, { props: 'x' })).toThrow('not a string')
    expect(() => renderComponent(Item, { props: { state: {} } })).toThrow('Use the initialState option')
    expect(() => renderComponent(Item, { props: { context: {} } })).toThrow('Use the context option')
    expect(() => renderComponent(Item, { props: { children: [] } })).toThrow('host component')
  })
})
