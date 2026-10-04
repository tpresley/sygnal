// @vitest-environment jsdom
// P45-R2 G-281: the root flag (`_r`: the component whose view goes to the DOM driver at the
// patch stage, held while a new component waits) came from `!sources.__k`, which the first root
// writes into the sources object it was given. In a hand-written main, `A(sources); B(sources)`
// with component() factories (no isolation) share that object, so B was taken for a child. It is
// a root too; a peer (given its root's sources while the root is being made) is still a child.
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { component, makeDOMDriver } from '../src/index.js'
import { setup } from '../src/cycle/run/index.ts'
import { withState } from '../src/cycle/state/index.ts'
import { createElement as h } from '../src/pragma/index.js'
import { configureDiagnostics, registerCheck, _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
let cleanup = []
afterEach(() => { cleanup.forEach(f => f()); cleanup = []; document.body.innerHTML = ''; _resetDiagnostics() })

/** each component's root flag, by name, as the instance has it when its intent is set up */
function recordRoots() {
  const roots = {}
  configureDiagnostics({ mode: 'collect' })
  cleanup.push(registerCheck({ id: 'p45-r2-roots', onIntent: (c) => { roots[c.name] = !!c._r } }))
  return roots
}

describe('P45-R2 G-281: roots given the same sources', () => {
  it('a hand-written main: A(sources); B(sources) are both roots, and both render', async () => {
    const roots = recordRoots()
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const A = component({ name: 'A', view: ({ state }) => h('p', { className: 'pa' }, 'a' + state.n), model: { INC: (s) => ({ n: s.n + 1 }) }, initialState: { n: 1 } })
    const B = component({ name: 'B', view: ({ state }) => h('p', { className: 'pb' }, 'b' + state.n), model: {}, DOMSourceName: 'DOM2' })
    function main(sources) {
      const a = A(sources), b = B(sources)
      return { DOM: a.DOM, DOM2: b.DOM2, STATE: xs.merge(a.STATE, b.STATE) }
    }
    const { run } = setup(withState(main, 'STATE'), { DOM: makeDOMDriver('#a'), DOM2: makeDOMDriver('#b') })
    cleanup.push(run())
    await until(() => expect(document.querySelector('.pb')?.textContent).toBe('b1'))
    expect(document.querySelector('.pa').textContent).toBe('a1')
    expect(roots).toEqual({ A: true, B: true })
  })

  it('a peer of the root is still a child', async () => {
    const roots = recordRoots()
    document.body.innerHTML = '<div id="root"></div>'
    const Side = component({ name: 'Side', view: () => h('aside', null, 'side') })
    const App = component({ name: 'App', view: ({ peers }) => h('div', null, peers.side), peers: { side: Side }, initialState: {} })
    const { run } = setup(withState(App, 'STATE'), { DOM: makeDOMDriver('#root') })
    cleanup.push(run())
    await until(() => expect(document.querySelector('aside')).toBeTruthy())
    expect(roots).toEqual({ App: true, Side: false })
  })
})
