// @vitest-environment jsdom
// The delegator's walk (one path per event, delivered in two phases): the order across isolation
// scopes, `currentTarget` while an event is delivered and what it reads afterwards.
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'
import { makeDOMDriver } from '../src/cycle/dom/index.js'
import { h } from '../src/cycle/dom/snabbdom.js'

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))
let cleanup = []
afterEach(() => { cleanup.forEach(f => f()); cleanup = []; document.body.innerHTML = '' })

async function setup() {
  document.body.innerHTML = '<div id="app"></div>'
  const child = h('section.child', { isolate: [{ type: 'total', scope: 'c' }] }, [h('button.btn', {}), h('input.inp', {})])
  const DOM = makeDOMDriver('#app')(xs.of(h('div.outer', {}, [child])).remember())
  const sub = DOM.elements().subscribe({})
  cleanup.push(() => sub.unsubscribe())
  await tick()
  return { DOM, kid: DOM.isolateSource(DOM, 'c') }
}
const on = (s$, f) => { const l = { next: f }; s$.addListener(l); cleanup.push(() => s$.removeListener(l)) }
const name = (e) => e.currentTarget.className

describe('the event path', () => {
  it('capture from the outside in, then bubbling from the inside out, across a total scope', async () => {
    const { DOM, kid } = await setup()
    const log = []
    on(kid.select('.btn').events('click'), e => log.push('btn ' + name(e)))
    on(kid.select('.btn').events('click', { useCapture: true }), e => log.push('btn capture ' + name(e)))
    on(DOM.select('.outer').events('click'), e => log.push('outer ' + name(e)))
    on(DOM.select('.outer').events('click', { useCapture: true }), e => log.push('outer capture ' + name(e)))
    await tick()
    document.querySelector('.btn').click()
    expect(log).toEqual(['outer capture outer', 'btn capture btn', 'btn btn', 'outer outer'])
  })

  it('after delivery an event reads the last element it reached; stopped, the one that stopped it', async () => {
    const { DOM, kid } = await setup()
    const seen = []
    on(kid.select('.btn').events('click'), e => seen.push(e))
    await tick()
    document.querySelector('.btn').click()
    expect(seen[0].currentTarget.id).toBe('app')
    expect(seen[0].ownerTarget.id).toBe('app')

    const stopped = []
    on(kid.select('.btn').events('dblclick'), e => { e.stopPropagation(); stopped.push(e) })
    on(DOM.select('.outer').events('dblclick'), e => stopped.push(e))
    await tick()
    document.querySelector('.btn').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(stopped.length).toBe(1)
    expect(stopped[0].currentTarget.className).toBe('btn')
  })

  it('the top of the walk gets the bubbling phase only', async () => {
    const { DOM } = await setup()
    const log = []
    on(DOM.select(':root').events('click'), e => log.push('bubble ' + e.currentTarget.id))
    on(DOM.select(':root').events('click', { useCapture: true }), e => log.push('capture ' + e.currentTarget.id))
    await tick()
    document.querySelector('.outer').click()
    expect(log).toEqual(['bubble app'])
  })

  it('a non-bubbling event is delivered at its element, in both phases, and stops there', async () => {
    const { kid } = await setup()
    const log = []
    on(kid.select('.inp').events('focus'), e => log.push('bubble ' + name(e)))
    on(kid.select('.inp').events('focus', { useCapture: true }), e => log.push('capture ' + name(e)))
    await tick()
    document.querySelector('.inp').dispatchEvent(new Event('focus'))
    expect(log).toEqual(['capture inp', 'bubble inp'])
  })
})
