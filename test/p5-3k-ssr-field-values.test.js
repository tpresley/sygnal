// PLAN-5 3-K G-465: renderToString wrote `value` as an attribute on <textarea> and <select>,
// which HTML ignores: the server page showed an empty textarea and the first option until
// hydration. A textarea's value is its text; a select's marks the matching <option> selected.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderToString } from '../src/extra/ssr.js'

const html = (view, state = {}) => {
  function C(p) { return view(p) }
  C.initialState = state
  return renderToString(C, { state })
}

describe('G-465: <textarea value>', () => {
  it('the value is the text content, escaped, with no value attribute', () => {
    const out = html(({ state }) => h('textarea', { className: 'n', value: state.text }), { text: 'a <b> & "c"' })
    expect(out).toContain('>a &lt;b&gt; &amp; &quot;c&quot;</textarea>')
    expect(out).not.toMatch(/value=/)
  })
  it('the value replaces children; a leading newline is kept; null / undefined leave the children', () => {
    expect(html(() => h('textarea', { value: 'x' }, 'old'))).toContain('>x</textarea>')
    expect(html(() => h('textarea', { value: '\nline' }))).toContain('>\n\nline</textarea>')
    expect(html(() => h('textarea', { value: null }, 'kept'))).toContain('>kept</textarea>')
    expect(html(() => h('textarea', { value: 0 }))).toContain('>0</textarea>')
  })
})

describe('G-465: <select value>', () => {
  it('marks the option whose value matches as selected; no value attribute on the select', () => {
    const out = html(({ state }) => h('select', { value: state.v },
      h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')), { v: 'b' })
    expect(out).toContain('<option value="a">A</option><option value="b" selected>B</option>')
    expect(out).not.toMatch(/<select[^>]*value=/)
  })
  it('an option without value matches by its text; options in optgroups and fragments too', () => {
    expect(html(() => h('select', { value: 'Two' }, h('option', null, 'One'), h('option', null, 'Two'))))
      .toContain('<option>One</option><option selected>Two</option>')
    const out = html(() => h('select', { value: 2 },
      h('optgroup', { label: 'g' }, [h('option', { value: '1' }, '1'), h('option', { value: '2' }, '2')])))
    expect(out).toContain('<option value="2" selected>2</option>')
  })
  it('multiple: every option whose value is in the array', () => {
    const out = html(() => h('select', { multiple: true, value: ['a', 'c'] },
      h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'), h('option', { value: 'c' }, 'C')))
    expect(out).toContain('<option value="a" selected>A</option><option value="b">B</option><option value="c" selected>C</option>')
  })
  it('a select without value leaves the options as written; an option outside a select is unchanged', () => {
    expect(html(() => h('select', null, h('option', { value: 'a', selected: true }, 'A'), h('option', { value: 'b' }, 'B'))))
      .toContain('<option value="a" selected>A</option><option value="b">B</option>')
    expect(html(() => h('datalist', null, h('option', { value: 'a' })))).toContain('<option value="a"></option>')
  })
  it('an <input value> keeps its attribute', () => {
    expect(html(() => h('input', { value: 'v' }))).toMatch(/<input[^>]* value="v"/)
  })
})
