// PLAN-5 3-M G-492: the pragma routes `form` and `list` to attrs on built-in elements (G-463:
// getter-only DOM properties there), but on a custom element (a hyphenated tag) `list` is its own
// property (Lit, Stencil, sygnal/element), so it stays a prop, on the client and in SSR. 3-Q
// G-519: `form` is an attribute on every tag (a form-associated element's `form` is a getter).
import { describe, it, expect } from 'vitest'
import { renderToString } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

describe('G-492: form / list on custom elements', () => {
  it('a custom element keeps list as a prop, form as an attribute (any selector form)', () => {
    const list = [1, 2]
    for (const sel of ['my-list', 'my-list.c', 'my-list#i']) {
      const d = h(sel, { list, form: 'f', role: 'listbox', 'aria-label': 'L' }).data
      expect(d.props, sel).toEqual({ list })
      expect(d.attrs, sel).toEqual({ form: 'f', role: 'listbox', 'aria-label': 'L' })
    }
  })

  it('built-in elements still take them as attributes (also with a hyphenated class)', () => {
    expect(h('input', { list: 'dl', form: 'f' }).data.attrs).toEqual({ list: 'dl', form: 'f' })
    expect(h('input.my-field', { list: 'dl' }).data.attrs).toEqual({ list: 'dl' })
  })

  it('renderToString writes no list attribute for a custom element (form: G-519)', () => {
    function App() { return h('div', null, h('my-list', { list: [1, 2], form: 'f' }), h('input', { list: 'dl' })) }
    App.initialState = {}
    const html = renderToString(App)
    expect(html).not.toContain('list="1,2"')
    expect(html).toContain('<my-list form="f">')
    expect(html).toContain('<input list="dl">')
  })
})
