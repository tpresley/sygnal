/**
 * PLAN-4 GS-3 (2-D): the 7xx "a11y" lane.
 *
 *   SYG701  click listener on a non-interactive element without role + tabIndex
 *   SYG702  form field without an accessible label
 *   SYG703  <img> without alt
 *   SYG704  <a> without href listened for clicks
 *   SYG705  <button> without an accessible name (literal children only)
 *   SYG706  positive tabIndex
 *   SYG707  unknown aria-* attribute or invalid role
 *   SYG708  label for / aria-describedby / aria-labelledby pointing at an id that isn't rendered
 *
 * Every rule: warn by default, error with { strict: true }, suppressed by
 * `// sygnal-ignore SYG70x`. Each rule has positive (finding) and negative
 * (clean) cases; when unsure (spreads, dynamic values, components that might
 * render a label) the lane says nothing.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, a11yRules, coreRules } from '../src/index.js'
import { CODES } from '../src/codes.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function project(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-a11y-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const root = tmp
  const sources = Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(root, f))
  return (opts = {}) => checkFiles(sources, { cwd: root, ...opts })
}

/** a11y findings only, as 'CODE line' strings */
const a11y = (diags) => diags.filter(d => /^SYG7/.test(d.code)).map(d => `${d.code} ${d.line}`)
const one = (src, opts) => a11y(project({ 'App.jsx': src })(opts))

/** A component around a view body (line 2 is the first JSX line). */
const view = (jsx, extra = '') => `export function App({ state, uid }) {
  return ${jsx}
}
App.initialState = {}
${extra}`

describe('a11y lane plumbing', () => {
  it('registers SYG701-708 as warn in the package table', () => {
    for (let n = 701; n <= 708; n++) expect(CODES[`SYG${n}`]?.severity, `SYG${n}`).toBe('warn')
  })

  it('a11y rules are core rules (on by default)', () => {
    expect(a11yRules.length).toBeGreaterThan(0)
    for (const r of a11yRules) expect(coreRules).toContain(r)
    expect(a11yRules.flatMap(r => r.codes).sort()).toEqual(['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708'])
  })

  it('warn by default, error under strict', () => {
    const check = project({ 'App.jsx': view('<img src="a.png" />') })
    expect(check().filter(d => d.code === 'SYG703').map(d => d.severity)).toEqual(['warn'])
    expect(check({ strict: true }).filter(d => d.code === 'SYG703').map(d => d.severity)).toEqual(['error'])
  })

  it('// sygnal-ignore SYG70x suppresses one finding', () => {
    expect(one(view(`<div>
    {/* sygnal-ignore SYG703 */}
    <img src="a.png" />
    <img src="b.png" />
  </div>`))).toEqual(['SYG703 5'])
  })
})

describe('SYG701 click on a non-interactive element', () => {
  const comp = (jsx, intent) => view(jsx, `App.intent = ({ DOM }) => ({ OPEN: ${intent} })
App.model = { OPEN: (s) => s }`)

  it('flags DOM.click on a <div> class', () => {
    expect(one(comp('<div className="card">Open</div>', "DOM.click('.card')"))).toEqual(['SYG701 5'])
  })

  it('flags select().events("click") on <li> and <span>', () => {
    expect(one(comp('<ul><li className="item">x</li></ul>', "DOM.select('.item').events('click')"))).toEqual(['SYG701 5'])
    expect(one(comp('<p><span className="x">x</span></p>', "DOM.select('.x').events('click')"))).toEqual(['SYG701 5'])
  })

  it('flags a controls() div listened for click', () => {
    expect(one(`import { controls } from 'sygnal'
const { Card } = controls({ Card: 'div' })
export function App({ state }) {
  return <section><Card>Open</Card></section>
}
App.intent = ({ DOM }) => ({ OPEN: DOM.click(Card) })
App.model = { OPEN: (s) => s }`)).toEqual(['SYG701 6'])
  })

  it('does not flag buttons, role + tabIndex, or an interactive descendant', () => {
    expect(one(comp('<button className="card">Open</button>', "DOM.click('.card')"))).toEqual([])
    expect(one(comp('<div className="card" role="button" tabIndex={0}>Open</div>', "DOM.click('.card')"))).toEqual([])
    expect(one(comp('<li className="item"><button>Remove</button></li>', "DOM.click('.item')"))).toEqual([])
    expect(one(comp('<li className="item"><input type="checkbox" aria-label="done" /></li>', "DOM.click('.item')"))).toEqual([])
  })

  it('says nothing when unsure: spread props, a child component inside, dynamic selector, other events', () => {
    expect(one(comp('<div className="card" {...state.attrs}>Open</div>', "DOM.click('.card')"))).toEqual([])
    expect(one(comp('<div className="card"><Child /></div>', "DOM.click('.card')"))).toEqual([])
    expect(one(comp('<div className="card">{props.children}</div>', "DOM.click('.card')"))).toEqual([])
    expect(one(comp('<div className="card">Open</div>', "DOM.click('[data-x] .card')"))).toEqual([])
    expect(one(comp('<div className="card">Open</div>', "DOM.mouseenter('.card')"))).toEqual([])
    expect(one(comp('<div className="card">Open</div>', "DOM.click('document')"))).toEqual([])
  })

  it('a role without tabIndex is still flagged', () => {
    expect(one(comp('<div className="card" role="button">Open</div>', "DOM.click('.card')"))).toEqual(['SYG701 5'])
  })
})

describe('SYG702 form field without a label', () => {
  it('flags inputs, selects and textareas with no label', () => {
    expect(one(view(`<form>
    <input className="email" />
    <select><option>a</option></select>
    <textarea />
  </form>`))).toEqual(['SYG702 3', 'SYG702 4', 'SYG702 5'])
  })

  it('accepts a wrapping label, label for (literal and uid), aria-label, aria-labelledby, title and placeholder', () => {
    expect(one(view(`<form>
    <label>Email <input /></label>
    <label htmlFor="name">Name</label><input id="name" />
    <label for="age">Age</label><input id="age" />
    <label for={uid('city')}>City</label><input id={uid('city')} />
    <input aria-label="Search" />
    <span id="l">Zip</span><input aria-labelledby="l" />
    <input title="Phone" />
    <input placeholder="What needs to be done?" />
    <input type="hidden" />
    <input type="submit" />
  </form>`))).toEqual([])
  })

  it('names an unlinked sibling <label> in the message', () => {
    const diags = project({ 'App.jsx': view(`<div>
    <label>Email</label>
    <input type="email" />
  </div>`) })().filter(d => d.code === 'SYG702')
    expect(diags.map(d => d.line)).toEqual([4])
    expect(diags[0].message).toContain("the <label> next to it (line 3) isn't linked to it")
  })

  it('a uid() id needs a label with the same uid() key', () => {
    expect(one(view(`<form>
    <label for={uid('a')}>A</label><input id={uid('b')} />
  </form>`))).toEqual(['SYG708 3', 'SYG702 3']) // and the label points nowhere
  })

  it('says nothing when unsure: spread, dynamic type or id, inside a component, a helper used inside a label', () => {
    expect(one(view('<form><input {...state.field} /></form>'))).toEqual([])
    expect(one(view('<form><input type={state.type} /></form>'))).toEqual([])
    expect(one(view('<form><input id={state.id} /></form>'))).toEqual([])
    expect(one(view('<Field label="Email"><input /></Field>'))).toEqual([])
    expect(one(`const field = () => <input />
export function App({ state }) {
  return <label>Name {field()}</label>
}
App.initialState = {}`)).toEqual([])
  })

  it('flags a component\'s field when the component is never rendered inside a label', () => {
    expect(one(`export function Search({ state }) {
  return <div><input className="q" /></div>
}
Search.initialState = {}`)).toEqual(['SYG702 2'])
  })

  it('does not flag a component whose usage is wrapped in a label', () => {
    expect(a11y(project({
      'Search.jsx': `export function Search({ state }) {
  return <input className="q" />
}
Search.initialState = {}`,
      'App.jsx': `import { Search } from './Search.jsx'
export function App({ state }) {
  return <label>Find <Search /></label>
}
App.initialState = {}`,
    })())).toEqual([])
  })
})

describe('SYG703 img without alt', () => {
  it('flags <img> with no alt', () => {
    expect(one(view('<img src="a.png" />'))).toEqual(['SYG703 2'])
  })
  it('accepts alt="", any alt, aria-label, role="presentation", spread', () => {
    expect(one(view(`<div>
    <img src="a.png" alt="" />
    <img src="a.png" alt={state.name} />
    <img src="a.png" aria-label="logo" />
    <img src="a.png" role="presentation" />
    <img {...state.img} />
  </div>`))).toEqual([])
  })
})

describe('SYG704 <a> without href listened for clicks', () => {
  const comp = (jsx, intent) => view(jsx, `App.intent = ({ DOM }) => ({ GO: ${intent} })
App.model = { GO: (s) => s }`)
  it('flags it', () => {
    expect(one(comp('<a className="more">More</a>', "DOM.click('.more')"))).toEqual(['SYG704 5'])
  })
  it('accepts an href, role + tabIndex, or no click listener', () => {
    expect(one(comp('<a className="more" href="#more">More</a>', "DOM.click('.more')"))).toEqual([])
    expect(one(comp('<a className="more" role="button" tabIndex={0}>More</a>', "DOM.click('.more')"))).toEqual([])
    expect(one(comp('<a className="more">More</a>', "DOM.mouseenter('.more')"))).toEqual([])
  })
})

describe('SYG705 button without an accessible name', () => {
  it('flags an empty or icon-only button', () => {
    expect(one(view(`<div>
    <button className="close" />
    <button className="x"><i className="icon-x" /></button>
    <button><svg viewBox="0 0 1 1"><path d="M0 0" /></svg></button>
    <button><img src="x.png" alt="" /></button>
  </div>`))).toEqual(['SYG705 3', 'SYG705 4', 'SYG705 5', 'SYG705 6'])
  })
  it('accepts text, aria-label, title, aria-labelledby, img alt, svg title, and dynamic children', () => {
    expect(one(view(`<div>
    <button>Save</button>
    <button aria-label="Close"><i className="icon-x" /></button>
    <button title="Close"><i className="icon-x" /></button>
    <button aria-labelledby="t"><i /></button><span id="t">Close</span>
    <button><img src="x.png" alt="Close" /></button>
    <button><svg><title>Close</title></svg></button>
    <button><span>{'Add'}</span></button>
    <button>{state.label}</button>
    <button><Icon /></button>
    <button {...state.btn} />
  </div>`))).toEqual([])
  })
})

describe('SYG706 positive tabIndex', () => {
  it('flags tabIndex > 0', () => {
    expect(one(view(`<div>
    <div tabIndex={2}>a</div>
    <div tabindex="1">b</div>
  </div>`))).toEqual(['SYG706 3', 'SYG706 4'])
  })
  it('accepts 0, -1 and dynamic values', () => {
    expect(one(view(`<div>
    <div tabIndex={0}>a</div>
    <div tabIndex={-1}>b</div>
    <div tabIndex={state.i}>c</div>
  </div>`))).toEqual([])
  })
})

describe('SYG707 unknown aria-* attribute or invalid role', () => {
  it('flags misspelled aria attributes and invalid or abstract roles', () => {
    expect(one(view(`<div>
    <div aria-lable="x">a</div>
    <div role="buton">b</div>
    <div role="widget">c</div>
    <div role="button tabz">d</div>
  </div>`))).toEqual(['SYG707 3', 'SYG707 4', 'SYG707 5', 'SYG707 6'])
  })
  it('accepts ARIA 1.2 attributes and roles, DPUB / graphics roles, and dynamic roles', () => {
    expect(one(view(`<div>
    <div aria-live="polite" aria-describedby="h" aria-errormessage="h">a</div><p id="h">h</p>
    <div role="tablist"><div role="tab" tabIndex={0}>b</div></div>
    <div role="doc-chapter">c</div>
    <div role={state.role}>d</div>
    <div role="switch" aria-checked="true" tabIndex={0}>e</div>
  </div>`))).toEqual([])
  })
})

describe('SYG708 id reference to an id that is not rendered', () => {
  it('flags label for, aria-describedby and aria-labelledby that point nowhere', () => {
    expect(one(view(`<form>
    <label htmlFor="emial">Email</label><input id="email" aria-label="Email" />
    <input aria-label="Name" aria-describedby="name-help" />
    <input aria-labelledby="nope" />
  </form>`))).toEqual(['SYG708 3', 'SYG708 4', 'SYG708 5'])
  })
  it('flags a uid() reference with no element rendering the same uid() id', () => {
    expect(one(view(`<form>
    <input id={uid('email')} aria-label="Email" aria-describedby={uid('email-err')} />
  </form>`))).toEqual(['SYG708 3'])
  })
  it('accepts literal and uid() ids rendered anywhere in the component, and dynamic references', () => {
    expect(one(view(`<form>
    <input id={uid('email')} aria-label="Email" aria-describedby={uid('err')} />
    {state.error && <p id={uid('err')}>{state.error}</p>}
    <input aria-label="Name" aria-describedby="help one" /><p id="help">h</p><p id="one">o</p>
    <input aria-label="Zip" aria-describedby={state.ref} />
  </form>`))).toEqual([])
  })
  it('says nothing when some id in the project is dynamic (it might be the target)', () => {
    expect(one(view(`<form>
    <label htmlFor="email">Email</label>
    <input id={state.fieldId} />
  </form>`))).toEqual([])
  })
  it('accepts an id rendered by another scanned file', () => {
    expect(a11y(project({
      'Help.jsx': `export function Help({ state }) { return <p id="help">h</p> }
Help.initialState = {}`,
      'App.jsx': view('<input aria-label="Name" aria-describedby="help" />'),
    })())).toEqual([])
  })
})
