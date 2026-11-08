// @vitest-environment jsdom
// SYG109: a number for a style property that needs a unit (checks/numericStyle.ts; sygnal-check
// rules/syg109-numeric-style.js has the same table)
import { describe, it, expect } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { View } from '../src/primitives.ts'
import { UNITLESS, numericStyleCheck } from '../src/extra/diagnostics/checks/numericStyle.ts'
import { HostSource } from '../src/host/driver.ts'
import { UNITLESS as STATIC } from '../sygnal-check/src/rules/syg109-numeric-style.js'

function Quiet() { return h('div') }
Quiet.initialState = {}

const found = (t) => t.diagnostics.filter((x) => x.code === 'SYG109')

describe('SYG109 (dev entry)', () => {
  it('reports a dynamic number under the browser DOM driver, once per component and property', async () => {
    function Box({ state }) {
      return h('div', { style: { width: state.w, height: state.w } }, h('p', { style: { width: state.w + 1 } }))
    }
    Box.initialState = { w: 10 }
    Box.intent = ({ DOM }) => ({ GROW: DOM.click('div') })
    Box.model = { GROW: (s) => ({ ...s, w: s.w + 1 }) }
    using t = renderComponent(Box, { dom: 'real' })
    await t.ready()
    await t.simulateAction('GROW')
    await t.settle()
    const d = found(t)
    expect(d.map((x) => [x.component, x.data.property])).toEqual([['Box', 'width'], ['Box', 'height']])
    expect(d[0].severity).toBe('warn')
    expect(d[0].data).toMatchObject({ value: 10, tag: 'div' })
    expect(d[0].message).toContain('does not append px')
  })

  it('reports another property of the same component, and the same property of another one', async () => {
    function Child({ state }) { return h('span', { style: { width: state.n } }) }
    function Parent({ state }) { return h('div', { style: { width: state.a, left: state.a } }, h(Child, { state: 'child' })) }
    Parent.initialState = { a: 2, child: { n: 3 } }
    using t = renderComponent(Parent, { dom: 'real' })
    await t.ready()
    await t.settle()
    expect(found(t).map((x) => [x.component, x.data.property]).sort()).toEqual([['Child', 'width'], ['Parent', 'left'], ['Parent', 'width']])
  })

  it('looks inside delayed, remove and destroy', async () => {
    function T({ state }) { return h('div', { style: { delayed: { top: state.n }, remove: { left: state.n }, destroy: { right: state.n } } }) }
    T.initialState = { n: 1 }
    using t = renderComponent(T, { dom: 'real' })
    await t.ready()
    expect(found(t).map((x) => x.data.property)).toEqual(['top', 'left', 'right'])
  })

  it('leaves zero, strings, custom properties, unitless properties and primitives alone', async () => {
    function Ok({ state }) {
      return h('div', {
        style: { width: 0, height: '10px', '--gap': state.n, opacity: state.n / 2, zIndex: state.n, lineHeight: state.n, 'flex-grow': state.n, strokeWidth: state.n },
      }, h(View, { style: { width: state.n } }))
    }
    Ok.initialState = { n: 2 }
    using t = renderComponent(Ok, { dom: 'real' })
    await t.ready()
    await t.settle()
    expect(found(t)).toEqual([])
  })

  it('does not report under the mock DOM', async () => {
    function Box({ state }) { return h('div', { style: { width: state.w } }) }
    Box.initialState = { w: 10 }
    using t = renderComponent(Box)
    await t.ready()
    expect(found(t)).toEqual([])
  })

  it('does not report on a sygnal/host tree, where numbers are cells', async () => {
    // (the check reads the source the driver made: a HostSource has no EventDelegator)
    const vnode = { sel: 'div', data: { style: { width: 10 } }, children: [] }
    const render = (source, name) => {
      using t = renderComponent(Quiet)
      numericStyleCheck.onRender({ name, sources: { DOM: source } }, vnode)
      return t.diagnostics.filter((x) => x.code === 'SYG109' && x.component === name)
    }
    expect(render(new HostSource({}, null, [], [], 'DOM'), 'OnHost')).toEqual([])
    // the same call with a browser source reports
    expect(render({ _eventDelegator: { addEventListener() {} } }, 'OnBrowser')).toHaveLength(1)
  })

  it("the static rule's table is the dev entry's", () => {
    expect(STATIC).toEqual(UNITLESS)
  })
})
