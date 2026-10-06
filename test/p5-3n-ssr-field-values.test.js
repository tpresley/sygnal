// @vitest-environment jsdom
// PLAN-5 3-N G-495: renderToString's <select value> / <textarea value> (G-465) as the browser
// does it: an option without a value matches by its text with ASCII whitespace stripped and
// collapsed (option.value's fallback), a single select marks only the first matching option, an
// explicit `selected: false` stays, and a textarea value starting with CR / CRLF keeps its line.
// G-496: t.html() (innerHTML mode) shows no textarea value as text and marks no option (the value
// is a property; innerHTML never shows it). Checked against jsdom's parser.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderToString } from '../src/extra/ssr.js'
import { renderComponent } from '../src/extra/testing.js'

const html = (view, state = {}) => {
  function C(p) { return view(p) }
  C.initialState = state
  return renderToString(C, { state })
}
// the HTML parsed as the browser parses the server's page
const parse = (out) => { const d = document.createElement('div'); d.innerHTML = out; return d }

describe('G-495: <select value>', () => {
  it('an option without a value matches by its text, whitespace stripped and collapsed', () => {
    const out = html(() => h('select', { value: 'New York' },
      h('option', null, 'Paris'), h('option', null, '\n  New \t York  \n')))
    const s = parse(out).querySelector('select')
    expect(s.value).toBe('New York')
    expect(s.selectedIndex).toBe(1)
  })
  it('a single select marks only the first matching option', () => {
    const out = html(() => h('select', { value: 'a' },
      h('option', { value: 'a' }, 'first'), h('option', { value: 'a' }, 'second')))
    expect(out.match(/ selected/g)).toHaveLength(1)
    expect(parse(out).querySelector('select').selectedIndex).toBe(0)
  })
  it('multiple: every option whose value is in the array (as before)', () => {
    const out = html(() => h('select', { multiple: true, value: ['a'] },
      h('option', { value: 'a' }, '1'), h('option', { value: 'a' }, '2')))
    expect(out.match(/ selected/g)).toHaveLength(2)
  })
  it('an explicit selected: false is kept', () => {
    const out = html(() => h('select', { value: 'b' },
      h('option', { value: 'a' }, 'A'), h('option', { value: 'b', selected: false }, 'B')))
    expect(out).not.toMatch(/ selected/)
  })
})

describe('G-495: <textarea value> with a leading CR / CRLF', () => {
  for (const [name, v] of [['CRLF', '\r\nline'], ['CR', '\rline'], ['LF', '\nline']]) {
    it(`${name}: the parsed textarea keeps the first line break`, () => {
      const out = html(() => h('textarea', { value: v }))
      expect(parse(out).querySelector('textarea').value).toBe('\nline')
    })
  }
})

describe('G-496: t.html() (innerHTML mode)', () => {
  let t
  afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
  it('a textarea value is not its text; no option is marked', async () => {
    function C({ state }) {
      return h('div', null,
        h('textarea', { className: 'n', value: state.text }),
        h('select', { value: 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')))
    }
    C.initialState = { text: 'typed' }
    t = renderComponent(C)
    await t.ready()
    const out = t.html()
    expect(out).not.toMatch(/>typed<\/textarea>/)
    expect(out).not.toMatch(/ selected/)
  })
})
