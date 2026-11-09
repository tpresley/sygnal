// @vitest-environment jsdom
// P45-R G-263 (supersedes G-253): non-bubbling event records (one per started stream).
// - A record was added when the stream was made, so `events('focus')` never subscribed kept its
//   record forever. It is added when the stream starts now.
// - A stream that restarted after its record was removed got no events while another stream had
//   a record for the same type and scope.
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'
import { makeDOMDriver } from '../src/cycle/dom/index.js'
import { h } from '../src/cycle/dom/snabbdom.js'

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))
let cleanup = []
afterEach(() => { cleanup.forEach(f => f()); cleanup = []; document.body.innerHTML = '' })

function setup() {
  document.body.innerHTML = '<div id="app"></div>'
  const vnode$ = xs.of(h('div', {}, [h('input.inp', {})])).remember()
  const DOM = makeDOMDriver('#app')(vnode$)
  const sub = DOM.elements().subscribe({})
  cleanup.push(() => sub.unsubscribe())
  return { DOM, del: DOM._eventDelegator }
}
const on = (s$, log) => { const l = { next: e => log.push(e.type) }; s$.addListener(l); return () => s$.removeListener(l) }
const focus = () => document.querySelector('.inp').dispatchEvent(new Event('focus'))

describe('P45-R G-263: non-bubbling records', () => {
  it('a stream that is never started leaves no record', async () => {
    const { DOM, del } = setup()
    await tick()
    for (let i = 0; i < 5; i++) DOM.select('.inp').events('focus')
    expect(del.records.size).toBe(0)
  })

  it('a stream restarted after its record was removed gets events', async () => {
    const { DOM, del } = setup()
    await tick()
    const a$ = DOM.select('.inp').events('focus')
    const a = [], b = []
    let offA = on(a$, a)
    await tick()
    offA()
    await tick() // a$ stopped: its record is removed
    const b$ = DOM.select('.inp').events('focus')
    const offB = on(b$, b) // a record for the same type and scope
    offA = on(a$, a) // a$ restarts
    await tick()
    expect(del.records.size).toBe(2) // one per started stream
    focus()
    expect([a.length, b.length]).toEqual([1, 1])
    offA(); offB()
    await tick()
    expect(del.records.size).toBe(0)
  })
})
