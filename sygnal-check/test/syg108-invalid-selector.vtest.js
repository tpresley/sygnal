/**
 * SYG108: an intent selector that is not valid CSS (rules/syg108-invalid-selector.js). SYG110
 * leaves it alone: the class it would read isn't what was meant.
 */
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'
import { selectorProblem } from '../src/selectors.js'

const ROOT = path.join(os.tmpdir(), 'sygnal-check-syg108-virtual-does-not-exist')
const FILE = path.join(ROOT, 'App.jsx')
const app = (selector, cls = 'save') => `import { run } from 'sygnal'
function App({ state }) { return <button className="${cls}">x</button> }
App.initialState = {}
App.intent = ({ DOM }) => ({ SAVE: DOM.click(${JSON.stringify(selector)}) })
App.model = { SAVE: (s) => s }
run(App)
`
const check = (selector, cls) => checkFiles([FILE], { cwd: ROOT, sources: { [FILE]: app(selector, cls) } })
const only = (ds, code) => ds.filter(d => d.code === code)

describe('SYG108: an invalid intent selector', () => {
  it("reports a utility class's selector as invalid, an error naming the reason, and never suggests the class 'hover'", () => {
    const ds = check('.hover:bg-red-500', 'hover:bg-red-500')
    const [d] = only(ds, 'SYG108')
    expect(only(ds, 'SYG108')).toHaveLength(1)
    expect(d.severity).toBe('error')
    expect(d.message).toContain(':bg-red-500 is not a CSS pseudo-class')
    expect(d.message).toContain('SyntaxError')
    expect(d.fix).toContain('className="save hover:bg-red-500"')
    expect(d.fix).toContain("DOM.click('.save')")
    expect(d.fix).not.toMatch(/className="hover"/)
    expect(only(ds, 'SYG110')).toEqual([])
  })

  it.each([
    ['.w-1/2', "'/'"],
    ['.w-[10px]', '[10px] is not a valid attribute selector'],
    ['.bg-[#fff]', '[#fff] is not a valid attribute selector'],
    ['.a[', "the '[' is never closed"],
    ['.a]', "']'"],
    ['.a)', "unexpected ')'"],
    ['.1a', "a class can't start with a digit"],
    ['#2x', "an id can't start with a digit"],
    ['.-1a', 'digit'],
    ['.', "'.' must be followed by a name"],
    ['.a:', "':' must be followed"],
    [':not(.1a)', 'digit'],
    [':not', 'needs arguments'],
    ['.a::foo', '::foo is not a CSS pseudo-element'],
    ['.a:unknown', ':unknown is not a CSS pseudo-class'],
    ['.a!b', "'!'"],
    ['.w-50%', "'%'"],
    ['[data-x=1]', 'not a valid attribute selector'],
    ['div, .sm:p-2', ':p-2 is not a CSS pseudo-class'],
  ])('%s is invalid', (selector, reason) => {
    expect(selectorProblem(selector)).toContain(reason)
    expect(only(check(selector), 'SYG108')).toHaveLength(1)
  })

  it.each([
    '.a:hover', ':not(.b)', 'input:checked', '.x::before', '.x:before', '[data-x="1"]', "[data-x='a b']", '[data-x=abc]',
    '[data-x="a]b"]', 'a[href^="http" i]', '[foo|="bar"]', '.hover\\:x', '.w-1\\/2', '.\\31 a', '.\\33', 'li:nth-child(2n+1)',
    'li:nth-child(2n+1 of .a)', '.a > .b + .c ~ .d', '.a, .b', ':root', '*', 'document', 'body', '.a:is(.b, .1c)',
    ':has(> .x)', ':where(.a)', '::-webkit-scrollbar', ':-moz-focusring', ':focus-visible', ':popover-open', 'custom-el',
    '.--x', '._a', '.-a', '#x', '.é', 'svg|rect', '*|a', '[svg|href]', '&.x', '.a:not(.b):hover', '.A:HOVER',
    '[data-control="Save"]', ':not(.a', '.a[foo', ':lang(en)', ':dir(rtl)', '::part(label)', '::highlight(x)', ':host(.a)',
  ])('%s is valid', (selector) => {
    expect(selectorProblem(selector)).toBe(null)
  })

  it('a valid selector with a real pseudo-class is not reported, and SYG110 still checks its class', () => {
    expect(only(check('.save:hover'), 'SYG108')).toEqual([])
    expect(only(check('.save:hover'), 'SYG110')).toEqual([])
    expect(only(check('.other:hover'), 'SYG110')).toHaveLength(1)
  })

  it('reports a selector built from a static const, and not a dynamic one', () => {
    const src = (decl, arg) => `import { run } from 'sygnal'
${decl}
function App() { return <button className="a">x</button> }
App.initialState = {}
App.intent = ({ DOM, props }) => ({ SAVE: DOM.click(${arg}) })
App.model = { SAVE: (s) => s }
run(App)
`
    const run = (s) => only(checkFiles([FILE], { cwd: ROOT, sources: { [FILE]: s } }), 'SYG108')
    expect(run(src("const S = '.a:p-1'", 'S'))).toHaveLength(1)
    expect(run(src('', '`.${props.x}:p-1`'))).toEqual([])
  })
})
