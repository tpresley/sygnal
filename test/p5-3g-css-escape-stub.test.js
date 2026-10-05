// @vitest-environment jsdom
// PLAN-5 3-G, G-440: renderComponent({ dom: 'real' })'s CSS.escape stub didn't escape a leading
// digit, so a selector for an id such as '1' was invalid. It follows CSSOM's
// serialize-an-identifier now.
import { it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

it('the CSS.escape stub follows the CSSOM algorithm', async () => {
  t = renderComponent(() => h('p', null, 'x'), { dom: 'real' })
  await t.ready()
  const cases = {
    '1a': '\\31 a',
    '-1': '-\\31 ',
    '-': '\\-',
    '--x': '--x',
    'a b': 'a\\ b',
    '#id.c': '\\#id\\.c',
    '\0': '�',
    '\x01x': '\\1 x',
    '\x7f': '\\7f ',
    'é_ü-9': 'é_ü-9',
    'a1': 'a1',
  }
  for (const [input, out] of Object.entries(cases)) expect(CSS.escape(input), JSON.stringify(input)).toBe(out)
  // an escaped leading digit is a valid selector
  document.body.innerHTML = '<p id="1">one</p>'
  expect(document.querySelector('#' + CSS.escape('1')).textContent).toBe('one')
  document.body.innerHTML = ''
})
