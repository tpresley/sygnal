// PLAN-13 N-1: SYG117, a literal next('X') with no model entry X in the same component
import { describe, expect, it } from 'vitest'
import { checkFiles } from '../src/index.js'

function check(source) {
  const file = '/virtual/app/App.jsx'
  return checkFiles([file], { cwd: '/virtual/app', sources: { [file]: source } }).filter(d => d.code === 'SYG117' || d.code === 'SYG900')
}

const card = (model) => `import { run, defineBehavior } from 'sygnal'
function Card() { return <button className="go">go</button> }
Card.intent = ({ DOM }) => ({ CLICK: DOM.click('.go') })
Card.model = ${model}
function App({ state }) { return <main><Card state="card" /><p>{String(state.entered)}</p></main> }
App.initialState = { entered: false, card: {} }
App.model = { ENTER: (s) => ({ ...s, entered: true }), INCREMENT: (s) => s }
run(App)
`

describe('SYG117', () => {
  it("a child's next() for an action only its parent handles: names the parent, PARENT fix", () => {
    const [d, ...rest] = check(card(`{ CLICK: { EFFECT: (s, d, next) => next('ENTER') } }`))
    expect(rest).toEqual([])
    expect(d).toMatchObject({ code: 'SYG117', severity: 'warn', component: 'Card', data: { action: 'ENTER', handledBy: 'App' } })
    expect(d.message).toContain("next() never reaches App")
    expect(d.fix).toContain('CHILD.select(Card)')
    expect(d.fixes).toBeUndefined()
  })

  it('a typo of the component\'s own entry: did you mean, with a rename fix', () => {
    const [d] = check(card(`{ CLICK: (s, d, next) => { next('MOVED'); return s }, MOVE: (s) => s }`))
    expect(d).toMatchObject({ code: 'SYG117', component: 'Card', data: { action: 'MOVED', suggestion: 'MOVE' } })
    expect(d.message).toContain("did you mean 'MOVE'")
    expect(d.fixes?.[0]?.title).toBe("Change 'MOVED' to 'MOVE'")
  })

  it('a renamed third parameter and a module-level reducer count too', () => {
    const src = card(`{ CLICK: { EFFECT: onClick } }`).replace('Card.model', `function onClick(s, d, go) { go('LATER') }\nCard.model`)
    const [d] = check(src)
    expect(d).toMatchObject({ code: 'SYG117', data: { action: 'LATER' } })
    expect(d.fix).toContain('Card.model')
  })

  it('not reported: own entries, behavior actions, a model with a spread', () => {
    expect(check(card(`{ CLICK: { EFFECT: (s, d, next) => next('DONE') }, DONE: (s) => s }`))).toEqual([])
    expect(check(card(`{ ...base, CLICK: { EFFECT: (s, d, next) => next('ENTER') } }`).replace('Card.model', 'const base = {}\nCard.model'))).toEqual([])
    const withBehavior = card(`{ CLICK: { EFFECT: (s, d, next) => next('pager.NEXT') } }`).replace('Card.model', `const pager = defineBehavior({ initialState: { page: 0 }, model: { NEXT: (s) => ({ ...s, page: s.page + 1 }) } })
Card.uses = { pager: pager() }
Card.model`)
    expect(check(withBehavior)).toEqual([])
  })
})
