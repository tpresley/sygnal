// @vitest-environment jsdom
// PLAN-4.6 parity: .context, and D168 (context read-tracking: a context change re-renders only the
// components that read a changed key).
import { it, expect } from 'vitest'
import { parity, mount, h, click, until, sleep } from './harness.js'

function make(views) {
  function ReadsA({ state, context }) { views.a++; return h('i', { className: 'ra' }, `${state.t}:${context.a}`) }
  function ReadsB({ state, context }) { views.b++; return h('i', { className: 'rb' }, `${state.t}:${context.b}`) }
  function ReadsNone({ state }) { views.none++; return h('i', { className: 'rn' }, state.t) }
  function P({ state }) {
    return h('div', null, h('button', { className: 'bump-b' }), h('button', { className: 'bump-a' }),
      h(ReadsA, { state: 'ca' }), h(ReadsB, { state: 'cb' }), h(ReadsNone, { state: 'cn' }))
  }
  P.initialState = { a: 1, b: 1, ca: { t: 'A' }, cb: { t: 'B' }, cn: { t: 'N' } }
  P.context = { a: (s) => s.a, b: (s) => s.b }
  P.intent = ({ DOM }) => ({ B: DOM.click('.bump-b'), A: DOM.click('.bump-a') })
  P.model = { B: (s) => ({ ...s, b: s.b + 1 }), A: (s) => ({ ...s, a: s.a + 1 }) }
  return P
}

parity('parity: context', () => {
  it('a context value reaches deep readers and updates with the state it is computed from', async () => {
    const views = { a: 0, b: 0, none: 0 }
    const m = mount(make(views))
    await until(() => expect(m.text('.ra') + m.text('.rb')).toBe('A:1B:1'))
    click(m.$('.bump-b'))
    await until(() => expect(m.text('.rb')).toBe('B:2'))
    click(m.$('.bump-a'))
    await until(() => expect(m.text('.ra')).toBe('A:2'))
    expect(m.text('.rn')).toBe('N')
  })

  it('a context change re-renders only the components that read the changed key [D168 context read-tracking]', async () => {
    const views = { a: 0, b: 0, none: 0 }
    const m = mount(make(views))
    await until(() => expect(m.text('.ra') + m.text('.rb')).toBe('A:1B:1'))
    await sleep(20)
    const v = { ...views }
    click(m.$('.bump-b'))
    await until(() => expect(m.text('.rb')).toBe('B:2'))
    await sleep(20)
    expect(views.b).toBeGreaterThan(v.b)
    expect(views.a).toBe(v.a)
    expect(views.none).toBe(v.none)
  })
})
