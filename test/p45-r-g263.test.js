// @vitest-environment jsdom
// P45-R G-263 (supersedes G-253): non-bubbling event records (one per type + scope, shared by the
// streams on it).
// - A record was added when the stream was made, so `events('focus')` never subscribed kept its
//   record (and its ElementFinder) forever. It is added when the first stream starts now.
// - A stream that restarted after its record was removed re-added that stale record although a
//   newer one existed for the same type and scope, so the streams of one of them got no events.
//   A start looks the live record up again.
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
    expect(del.nonBubblingListenersToAdd.size).toBe(0)
  })

  it('a stream restarted after its record was removed shares the live record and gets events', async () => {
    const { DOM, del } = setup()
    await tick()
    const a$ = DOM.select('.inp').events('focus')
    const a = [], b = []
    let offA = on(a$, a)
    await tick()
    offA()
    await tick() // a$ stopped: its record is removed
    const b$ = DOM.select('.inp').events('focus')
    const offB = on(b$, b) // a new record for the same type and scope
    offA = on(a$, a) // a$ restarts
    await tick()
    expect(del.nonBubblingListenersToAdd.size).toBe(1)
    focus()
    expect([a.length, b.length]).toEqual([1, 1])
    offA(); offB()
    await tick()
    expect(del.nonBubblingListenersToAdd.size).toBe(0)
  })
})
