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

// PLAN-5 1-S G-370: the attribute routing (D196's popover / invoker / anchor names and the older
// for / role / tabindex / aria-*) applies to element tags only. A component placeholder keeps
// every prop (before: they went to the placeholder's attrs, which the component never reads; for
// role / for / tabindex / aria-* that was so since 5.x and on the PLAN-4.6 core: the component
// got undefined)
describe('1-S G-370: component props named like attributes', () => {
  const NAMES = ['popovertarget', 'popovertargetaction', 'commandfor', 'command', 'closedby', 'interestfor', 'anchor', 'role', 'for', 'tabindex', 'aria-label', 'aria-expanded']
  function Child() { return h('div') }
  for (const name of NAMES) {
    it(`${name} stays a prop on a component placeholder (createElement and the JSX runtime)`, () => {
      const v = h(Child, { [name]: 'x' })
      expect(v.data.props).toEqual({ [name]: 'x' })
      expect(v.data.attrs).toBeUndefined()
      expect(jsx(Child, { [name]: 'x' }).data.props).toEqual({ [name]: 'x' })
    })
  }
  it('an aria-* boolean reaches a component as the boolean', () => {
    expect(h(Child, { 'aria-expanded': false, 'aria-label': false }).data.props).toEqual({ 'aria-expanded': false, 'aria-label': false })
  })
  it('the same keys on an element still go to attrs (the route cache is per kind)', () => {
    h(Child, { role: 'r', command: 'c' })
    expect(h('div', { role: 'r', command: 'c' }).data.attrs).toEqual({ role: 'r', command: 'c' })
    expect(h(Child, { role: 'r', command: 'c' }).data.props).toEqual({ role: 'r', command: 'c' })
  })
  it('a component receives them (renderComponent)', async () => {
    const { renderComponent } = await import('../src/index.js')
    function Shown(props) { return h('p', { className: 'c' }, JSON.stringify([props.command, props.anchor, props.closedby, props.role, props['aria-label'], props.commandfor, props.tabindex, props.for])) }
    function P() { return h('div', null, h(Shown, { command: 'save', anchor: 'top', closedby: 'any', role: 'r', 'aria-label': 'L', commandfor: 'x', tabindex: 0, for: 'f' })) }
    const t = renderComponent(P)
    await t.ready()
    expect(JSON.parse(t.query('.c').textContent)).toEqual(['save', 'top', 'any', 'r', 'L', 'x', 0, 'f'])
    t.dispose()
  })
})

// PLAN-5 1-S G-372: aria-* values. true is "true"; false is "false" only for the ARIA states
// whose value set has false (true/false, tristate, and the tokens with false: aria-current,
// aria-invalid, aria-haspopup); on any other aria-* (strings, IDREFs, numbers) false removes the
// attribute, as null does (`aria-describedby={hasError && 'err'}`)
describe('1-S G-372: aria-* false and null', () => {
  const STATES = ['atomic', 'busy', 'checked', 'current', 'disabled', 'expanded', 'grabbed', 'haspopup', 'hidden', 'invalid', 'modal', 'multiline', 'multiselectable', 'pressed', 'readonly', 'required', 'selected']
  for (const s of STATES) it(`aria-${s}={false} is "false"`, () => {
    expect(h('div', { [`aria-${s}`]: false }).data.attrs).toEqual({ [`aria-${s}`]: 'false' })
  })
  for (const s of ['label', 'describedby', 'labelledby', 'controls', 'level', 'valuenow', 'live', 'errormessage', 'placeholder']) it(`aria-${s}={false} and ={null} are removed`, () => {
    const patch = init([attributesModule, propsModule])
    const root = document.createElement('div')
    document.body.appendChild(root)
    let v = patch(root, h('input', { [`aria-${s}`]: 'x' }))
    expect(v.elm.getAttribute(`aria-${s}`)).toBe('x')
    v = patch(v, h('input', { [`aria-${s}`]: false }))
    expect(v.elm.hasAttribute(`aria-${s}`)).toBe(false)
    v = patch(v, h('input', { [`aria-${s}`]: 'y' }))
    v = patch(v, h('input', { [`aria-${s}`]: null }))
    expect(v.elm.hasAttribute(`aria-${s}`)).toBe(false)
    expect(h('div', { [`aria-${s}`]: true }).data.attrs).toEqual({ [`aria-${s}`]: 'true' })
  })
  it('every other WAI-ARIA 1.3 attribute: false is not "false"', () => {
    const OTHERS = ['activedescendant', 'autocomplete', 'braillelabel', 'brailleroledescription', 'colcount', 'colindex', 'colindextext', 'colspan', 'controls', 'describedby', 'description', 'details', 'dropeffect', 'errormessage', 'flowto', 'keyshortcuts', 'label', 'labelledby', 'level', 'live', 'orientation', 'owns', 'placeholder', 'posinset', 'relevant', 'roledescription', 'rowcount', 'rowindex', 'rowindextext', 'rowspan', 'setsize', 'sort', 'valuemax', 'valuemin', 'valuenow', 'valuetext']
    for (const s of OTHERS) expect(h('div', { [`aria-${s}`]: false }).data.attrs[`aria-${s}`]).toBe(false)
  })
  it('null on a boolean state removes it too', () => {
    const patch = init([attributesModule, propsModule])
    const root = document.createElement('div')
    document.body.appendChild(root)
    let v = patch(root, h('button', { 'aria-pressed': true }))
    v = patch(v, h('button', { 'aria-pressed': null }))
    expect(v.elm.hasAttribute('aria-pressed')).toBe(false)
  })
})
