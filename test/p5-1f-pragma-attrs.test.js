// PLAN-5 1-F item 1 (D196): aria-* booleans render as "true"/"false" (ARIA reads the
// attribute's value: aria-invalid="" is not "true"), and the popover / invoker / anchor
// attributes (popovertarget, popovertargetaction, commandfor, command, closedby, interestfor,
// anchor) go to attrs (as props they set an expando the browser ignores).
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { jsx } from '../src/jsx-runtime.js'
import { init, attributesModule, propsModule } from 'snabbdom'

describe('aria-* booleans', () => {
  it('true and false become "true" and "false" in attrs', () => {
    const v = h('input', { 'aria-invalid': true, 'aria-hidden': false, 'aria-label': 'L', 'aria-level': 2 })
    expect(v.data.attrs).toEqual({ 'aria-invalid': 'true', 'aria-hidden': 'false', 'aria-label': 'L', 'aria-level': 2 })
    expect(v.data.props).toBeUndefined()
  })
  it('the JSX runtime path does the same', () => {
    const v = jsx('div', { 'aria-expanded': false, 'aria-busy': true })
    expect(v.data.attrs).toEqual({ 'aria-expanded': 'false', 'aria-busy': 'true' })
  })
  it('an undefined aria value is still skipped; attrs-aria-* and attrs={} are passed as written', () => {
    expect(h('div', { 'aria-invalid': undefined }).data.attrs).toBeUndefined()
    expect(h('div', { attrs: { 'aria-pressed': true } }).data.attrs).toEqual({ 'aria-pressed': true })
  })
  it('renders aria-invalid="true" / aria-expanded="false" in the DOM', () => {
    const patch = init([attributesModule, propsModule])
    const root = document.createElement('div')
    document.body.appendChild(root)
    const v = patch(root, h('input', { 'aria-invalid': true, 'aria-expanded': false }))
    expect(v.elm.getAttribute('aria-invalid')).toBe('true')
    expect(v.elm.getAttribute('aria-expanded')).toBe('false')
    const v2 = patch(v, h('input', { 'aria-invalid': false, 'aria-expanded': true }))
    expect(v2.elm.getAttribute('aria-invalid')).toBe('false')
    expect(v2.elm.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('popover / invoker / anchor attributes', () => {
  const NAMES = ['popovertarget', 'popovertargetaction', 'commandfor', 'command', 'closedby', 'interestfor', 'anchor']
  for (const name of NAMES) {
    it(`${name} goes to attrs`, () => {
      const v = h('button', { [name]: 'x' })
      expect(v.data.attrs).toEqual({ [name]: 'x' })
      expect(v.data.props).toBeUndefined()
      expect(jsx('button', { [name]: 'x' }).data.attrs).toEqual({ [name]: 'x' })
    })
  }
  it('renders as attributes in the DOM', () => {
    const patch = init([attributesModule, propsModule])
    const root = document.createElement('div')
    document.body.appendChild(root)
    const v = patch(root, h('button', { popovertarget: 'menu', popovertargetaction: 'show', commandfor: 'dlg', command: 'show-modal' }))
    expect(v.elm.getAttribute('popovertarget')).toBe('menu')
    expect(v.elm.getAttribute('popovertargetaction')).toBe('show')
    expect(v.elm.getAttribute('commandfor')).toBe('dlg')
    expect(v.elm.getAttribute('command')).toBe('show-modal')
  })
  it('the props they share a prefix with stay props', () => {
    expect(h('div', { popover: 'manual' }).data.props).toEqual({ popover: 'manual' })
    expect(h('a', { anchorName: 'x' }).data.props).toEqual({ anchorName: 'x' })
  })
})
