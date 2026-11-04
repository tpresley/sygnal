// Sift (preview.5 #2/#3): SYG107, a DOM property name in the wrong case on an HTML element
// (checks/domProps.ts; sygnal-check rules/syg107-dom-prop-case.js has the same table)
import { describe, it, expect } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { DOM_PROPS } from '../src/extra/diagnostics/checks/domProps.ts'
import { DOM_PROPS as STATIC } from '../sygnal-check/src/rules/syg107-dom-prop-case.js'

describe('SYG107 (dev entry)', () => {
  it('reports a name in the wrong case on an HTML element once, naming the property', async () => {
    function Pin({ state }) {
      return h('form', null,
        h('input', { autoComplete: 'one-time-code', inputmode: 'numeric', maxLength: 4, value: state.pin }),
        h('input', { autoComplete: 'off' }))
    }
    Pin.initialState = { pin: '' }
    using t = renderComponent(Pin)
    await t.ready()
    const d = t.diagnostics.filter((x) => x.code === 'SYG107')
    expect(d.map((x) => [x.data.name, x.data.property, x.data.tag])).toEqual([['autoComplete', 'autocomplete', 'input'], ['inputmode', 'inputMode', 'input']])
    expect(d[0].severity).toBe('warn')
    expect(d[0].message).toContain('The DOM property is autocomplete')
  })

  it('leaves right names, attributes, SVG and custom elements alone', async () => {
    function Ok() {
      return h('div', null,
        h('input', { autocomplete: 'off', inputMode: 'numeric', readOnly: true, 'attrs-inputmode': 'x', tabindex: 0, 'aria-readonly': 'true' }),
        h('svg', { viewBox: '0 0 1 1' }, h('text', { textLength: 4 }, 'x')),
        h('my-field', { maxlength: 4 }))
    }
    Ok.initialState = {}
    using t = renderComponent(Ok)
    await t.ready()
    expect(t.diagnostics.filter((x) => x.code === 'SYG107')).toEqual([])
  })

  it("the static rule's table is the dev entry's", () => {
    expect(STATIC).toEqual(DOM_PROPS)
  })
})
