// PLAN-5 3-M G-492: the pragma routes `form` and `list` to attrs on built-in elements (G-463:
// getter-only DOM properties there), but on a custom element (a hyphenated tag) they are its own
// properties (Lit, Stencil, sygnal/element), so they stay props, on the client and in SSR.
import { describe, it, expect } from 'vitest'
import { renderToString } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

describe('G-492: form / list on custom elements', () => {
  it('a custom element keeps form and list as props (any selector form)', () => {
    const list = [1, 2], form = { a: 1 }
    for (const sel of ['my-list', 'my-list.c', 'my-list#i']) {
      const d = h(sel, { list, form, role: 'listbox', 'aria-label': 'L' }).data
      expect(d.props, sel).toEqual({ list, form })
      expect(d.attrs, sel).toEqual({ role: 'listbox', 'aria-label': 'L' })
    }
  })

  it('built-in elements still take them as attributes (also with a hyphenated class)', () => {
    expect(h('input', { list: 'dl', form: 'f' }).data.attrs).toEqual({ list: 'dl', form: 'f' })
    expect(h('input.my-field', { list: 'dl' }).data.attrs).toEqual({ list: 'dl' })
  })

  it('renderToString writes no list / form attribute for a custom element', () => {
    function App() { return h('div', null, h('my-list', { list: [1, 2], form: { a: 1 } }), h('input', { list: 'dl' })) }
    App.initialState = {}
    const html = renderToString(App)
    expect(html).not.toContain('list="1,2"')
    expect(html).not.toContain('form=')
    expect(html).toContain('<input list="dl">')
  })
})
